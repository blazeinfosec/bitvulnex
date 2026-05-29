"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/container";
import {
  DataTable,
  type Column,
  NumberCell,
  PercentChangeCell,
  PriceCell,
  Skeleton,
  WsStatusPill,
  type WsStatus,
} from "@/components/exchange";
import { cn } from "@/lib/utils";

type MarketRow = {
  pair: string;
  base: string;
  quote: string;
  last: string | null;
  change24h: number;
  vol24h: string;
  high24h: string | null;
  low24h: string | null;
};

type TickerRow = {
  pair: string;
  last: string;
  change24h: number;
  vol24h: string;
};

function pairSlug(pair: string): string {
  return pair.replace("/", "-");
}

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsFallback />}>
      <MarketsPageInner />
    </Suspense>
  );
}

function MarketsFallback() {
  return (
    <Container className="py-8 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight text-text">
        Markets
      </h1>
      <p className="text-sm text-text-dim mt-1 mb-4">
        Real-time spot prices across all listed pairs.
      </p>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Container>
  );
}

function MarketsPageInner() {
  const searchParams = useSearchParams();
  const sortKey = (searchParams.get("sort") ?? "volume") as
    | "last"
    | "change"
    | "volume";

  const [rows, setRows] = useState<MarketRow[] | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const prevRef = useRef<Map<string, string>>(new Map());

  // Initial fetch + 10s polling fallback (in case WS is unavailable).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v2/public/markets");
        if (!res.ok) return;
        const body = (await res.json()) as { markets: MarketRow[] };
        if (cancelled) return;
        setRows(body.markets);
      } catch {
        /* ignore — WS will catch up */
      }
    }
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  // WS subscription for live ticker updates.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      setStatus((s) => (s === "live" ? "reconnecting" : "connecting"));
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws`;
      ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        backoff = 1000;
        setStatus("live");
        ws?.send(JSON.stringify({ kind: "subscribe", channel: "ticker:all" }));
      });
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            kind?: string;
            rows?: TickerRow[];
          };
          if (msg.kind === "ticker" && Array.isArray(msg.rows)) {
            setRows((prev) => {
              if (!prev) return prev;
              const byPair = new Map(msg.rows!.map((r) => [r.pair, r] as const));
              return prev.map((r) => {
                const next = byPair.get(r.pair);
                if (!next) return r;
                return {
                  ...r,
                  last: next.last,
                  change24h: next.change24h,
                  vol24h: next.vol24h,
                };
              });
            });
          }
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener("close", () => {
        if (closed) return;
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10_000);
      });
      ws.addEventListener("error", () => {
        ws?.close();
      });
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      setStatus("disconnected");
    };
  }, []);

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "last":
          return Number(b.last ?? 0) - Number(a.last ?? 0);
        case "change":
          return b.change24h - a.change24h;
        case "volume":
        default:
          return Number(b.vol24h) - Number(a.vol24h);
      }
    });
    return sorted;
  }, [rows, sortKey]);

  const columns: Column<MarketRow>[] = useMemo(
    () => [
      {
        key: "pair",
        header: "Pair",
        align: "left",
        render: (r) => (
          <span className="font-medium text-text">
            {r.base}
            <span className="text-text-mute">/{r.quote}</span>
          </span>
        ),
      },
      {
        key: "last",
        header: "Last",
        align: "right",
        render: (r) => {
          const prev = prevRef.current.get(r.pair);
          const cell = (
            <PriceCell
              value={r.last ?? "0"}
              prevValue={prev}
              dp={smartDp(r.quote)}
            />
          );
          // Update the ref after render. Using a microtask keeps the
          // prevValue stable for the current PriceCell render.
          if (r.last) {
            queueMicrotask(() => prevRef.current.set(r.pair, r.last as string));
          }
          return cell;
        },
      },
      {
        key: "change",
        header: "24h %",
        align: "right",
        render: (r) => <PercentChangeCell value={r.change24h} />,
      },
      {
        key: "high",
        header: "24h High",
        align: "right",
        render: (r) =>
          r.high24h ? (
            <NumberCell value={r.high24h} dp={smartDp(r.quote)} />
          ) : (
            <span className="text-text-mute">—</span>
          ),
      },
      {
        key: "low",
        header: "24h Low",
        align: "right",
        render: (r) =>
          r.low24h ? (
            <NumberCell value={r.low24h} dp={smartDp(r.quote)} />
          ) : (
            <span className="text-text-mute">—</span>
          ),
      },
      {
        key: "vol",
        header: "24h Volume",
        align: "right",
        render: (r) => (
          <NumberCell value={r.vol24h} dp={2} suffix={r.quote} />
        ),
      },
      {
        key: "action",
        header: "",
        align: "right",
        render: (r) => (
          <Link
            href={`/trade/${pairSlug(r.pair)}`}
            className="inline-flex items-center gap-1 text-accent hover:text-accent-hover text-sm font-medium no-underline"
          >
            Trade →
          </Link>
        ),
      },
    ],
    [],
  );

  return (
    <Container className="py-8 max-w-7xl">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Markets
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Real-time spot prices across all listed pairs.
          </p>
        </div>
        <div className="shrink-0">
          <WsStatusPill status={status} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-mute">Sort:</span>
        {(["volume", "change", "last"] as const).map((k) => (
          <Link
            key={k}
            href={`/markets?sort=${k}`}
            scroll={false}
            className={cn(
              "px-2 py-1 rounded-md border border-border no-underline transition-colors",
              sortKey === k
                ? "bg-bg-elevated text-text"
                : "text-text-dim hover:bg-bg-hover",
            )}
          >
            {k === "volume"
              ? "24h Volume"
              : k === "change"
                ? "24h %"
                : "Last price"}
          </Link>
        ))}
      </div>

      {sortedRows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={sortedRows}
          rowKey={(r) => r.pair}
          empty="No markets available"
        />
      )}
    </Container>
  );
}

// Smart precision rules for the quote currency: stablecoins to 2dp,
// BTC quotes to 8dp, anything else 4dp. The numeric component already
// trims trailing zeros so this is just an upper bound.
function smartDp(quote: string): number {
  if (quote === "USDT" || quote === "USDC") return 2;
  if (quote === "BTC") return 8;
  return 4;
}
