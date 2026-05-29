"use client";

import { useEffect, useState } from "react";
import { TickerChyron, type TickerMarket } from "./TickerChyron";

// Fallback static rows shown while the WS connection is establishing
// or unreachable. Keeps the chyron from flickering between paint cycles.
const FALLBACK: TickerMarket[] = [
  { pair: "BTC/USDT", last: "67000.00", changePct: 0 },
  { pair: "ETH/USDT", last: "3400.00", changePct: 0 },
  { pair: "LTC/USDT", last: "78.00", changePct: 0 },
  { pair: "DOGE/USDT", last: "0.12", changePct: 0 },
  { pair: "USDC/USDT", last: "1.0001", changePct: 0 },
];

type TickerRow = {
  pair: string;
  last: string;
  change24h: number;
  vol24h: string;
};

type TickerMessage = { kind: "ticker"; rows: TickerRow[] };

export interface TickerHostProps {
  /** Max number of pairs to display in the chyron (default 8). */
  limit?: number;
}

/**
 * Client component that subscribes to `ticker:all` over the WS gateway
 * and feeds the visual TickerChyron with the rolling list. While the
 * WS connection is establishing, a sparse fallback is shown so the
 * chyron always renders something.
 *
 * Reconnects with exponential backoff (1s → 10s max).
 */
export function TickerHost({ limit = 8 }: TickerHostProps) {
  const [markets, setMarkets] = useState<TickerMarket[]>(FALLBACK);

  useEffect(() => {
    // Bootstrap with one HTTP fetch so the chyron has real data even
    // before the first WS message lands.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v2/public/markets");
        if (!res.ok) return;
        const body = (await res.json()) as { markets: TickerRow[] };
        if (cancelled) return;
        if (body.markets?.length) {
          setMarkets(toMarkets(body.markets, limit));
        }
      } catch {
        /* ignore — fallback stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws`;
      ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        backoff = 1000;
        ws?.send(JSON.stringify({ kind: "subscribe", channel: "ticker:all" }));
      });
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data) as TickerMessage;
          if (msg.kind === "ticker" && Array.isArray(msg.rows)) {
            setMarkets(toMarkets(msg.rows, limit));
          }
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener("close", () => {
        if (closed) return;
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
    };
  }, [limit]);

  return <TickerChyron markets={markets} />;
}

function toMarkets(rows: TickerRow[], limit: number): TickerMarket[] {
  return rows
    .filter((r) => r.last !== null)
    .slice(0, limit)
    .map((r) => ({
      pair: r.pair,
      last: r.last,
      changePct: r.change24h,
    }));
}
