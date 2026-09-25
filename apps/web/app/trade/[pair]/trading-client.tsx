"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import {
  OrderBook,
  OrderForm,
  PairHeader,
  RecentTradesFeed,
  DepthChart,
  MyOrdersTable,
  BottomSheet,
  WsStatusPill,
  type RawLevel,
  type RecentTrade,
  type WsStatus,
} from "@/components/exchange";
import { aggregationPresets, baseDp, pairFromString, quoteDp } from "@/lib/trade/pair";
import { authedFetch, getAccessToken } from "@/lib/token-storage";
import { cn } from "@/lib/utils";

// Lazy-load lightweight-charts: it's ~50KB and only needed on this
// surface. SSR is disabled because the chart constructor touches the
// DOM and uses canvas.
const CandleChart = dynamic(
  () => import("@/components/exchange/trade/CandleChart").then((m) => m.CandleChart),
  { ssr: false, loading: () => <div className="h-[400px] bg-bg-elevated rounded-lg border border-border animate-pulse" /> },
);

interface Book {
  pair: string;
  bids: RawLevel[];
  asks: RawLevel[];
}

interface MarketRow {
  pair: string;
  base: string;
  quote: string;
  last: string | null;
  change24h: number;
  vol24h: string;
  high24h: string | null;
  low24h: string | null;
}

interface Balance {
  asset: string;
  available: string;
}

interface Me {
  id: string;
  email: string;
  kycTier: number;
}

const LAST_PAIR_KEY = "bvbe.ui.trade.lastpair";
function aggKey(pair: string): string {
  return `bvbe.ui.book.agg.${pair}`;
}

function normalizeTrade(input: unknown): RecentTrade | null {
  if (!input || typeof input !== "object") return null;
  const t = input as Record<string, unknown>;
  const price = Number(t.price);
  const size = Number(t.size ?? t.amount ?? t.qty);
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
  const executedAt =
    typeof t.executedAt === "string" || typeof t.executedAt === "number"
      ? t.executedAt
      : typeof t.at === "string" || typeof t.at === "number"
        ? t.at
        : Date.now();
  const side = t.takerSide ?? t.side;
  return {
    id:
      typeof t.id === "string" || typeof t.id === "number"
        ? t.id
        : `${executedAt}-${price}-${size}`,
    price,
    size,
    executedAt,
    takerSide: side === "buy" || side === "sell" ? side : undefined,
  };
}

export interface TradingClientProps {
  base: string;
  quote: string;
}

export function TradingClient({ base, quote }: TradingClientProps) {
  const router = useRouter();
  const pair = `${base}/${quote}`;
  const info = useMemo(() => pairFromString(pair)!, [pair]);
  const presets = useMemo(() => aggregationPresets(info), [info]);

  // Initial aggregation: middle preset on first render (matches SSR), then
  // apply any localStorage override after mount.
  const [aggregation, setAggregation] = useState<number>(() => presets[1]!);
  const aggLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    let next = presets[1]!;
    try {
      const raw = window.localStorage.getItem(aggKey(pair));
      const v = raw ? Number(raw) : NaN;
      if (Number.isFinite(v) && presets.includes(v)) next = v;
    } catch {
      /* ignore */
    }
    aggLoadedFor.current = pair;
    setAggregation(next);
  }, [pair, presets]);
  useEffect(() => {
    // Don't persist until the stored value for this pair has been read,
    // otherwise the default would overwrite the saved preference.
    if (aggLoadedFor.current !== pair) return;
    try {
      window.localStorage.setItem(aggKey(pair), String(aggregation));
    } catch {
      /* ignore */
    }
  }, [aggregation, pair]);

  // Remember the last visited pair for back-to-trading affordances
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_PAIR_KEY, info.slug);
    } catch {
      /* ignore */
    }
  }, [info.slug]);

  const [book, setBook] = useState<Book | null>(null);
  const [recent, setRecent] = useState<RecentTrade[]>([]);
  const [market, setMarket] = useState<MarketRow | null>(null);
  const [allMarkets, setAllMarkets] = useState<MarketRow[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [priceInput, setPriceInput] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const refreshBalances = useCallback(async () => {
    const res = await authedFetch("/api/v2/me/balance");
    if (res.ok) {
      const b = (await res.json()) as { balances: Balance[] };
      setBalances(b.balances);
    }
  }, []);

  const loadAll = useCallback(async () => {
    // Public — no auth needed
    const [bookRes, marketsRes, tradeRes] = await Promise.all([
      fetch(`/api/v2/public/book/${encodeURIComponent(pair)}`, { cache: "no-store" }),
      fetch("/api/v2/public/markets", { cache: "no-store" }),
      // Initial recent trades: derive from the last 50 candles via chart endpoint?
      // No — we have no /public/trades endpoint in slice 4. Trade tape is
      // populated entirely by the `trades:<pair>` WS channel after subscribe.
      Promise.resolve(null),
    ]);
    if (bookRes.ok) setBook(await bookRes.json());
    if (marketsRes.ok) {
      const b = (await marketsRes.json()) as { markets: MarketRow[] };
      setAllMarkets(b.markets);
      const m = b.markets.find((m) => m.pair === pair);
      if (m) setMarket(m);
    }
    void tradeRes; // placeholder

    // Authed — may 401
    const meRes = await authedFetch("/api/v2/me");
    if (meRes.ok) {
      setMe((await meRes.json()) as Me);
      await refreshBalances();
    } else {
      setMe(null);
      setBalances([]);
    }
  }, [pair, refreshBalances]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Periodic book/markets refresh as a fallback when WS misses or is
  // unavailable; cheap (~1 request every 6s).
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadAll();
    }, 6_000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  // WS subscription: book, trades, ticker, and (if authed) private
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let statusDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const token = getAccessToken();

    function setStatusDebounced(next: WsStatus, delayMs = 0) {
      if (statusDebounceTimer) {
        clearTimeout(statusDebounceTimer);
        statusDebounceTimer = null;
      }
      if (delayMs <= 0) {
        setWsStatus(next);
        return;
      }
      statusDebounceTimer = setTimeout(() => {
        if (!closed) setWsStatus(next);
      }, delayMs);
    }

    const connect = () => {
      if (closed) return;
      setStatusDebounced("connecting");
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws${token ? `?token=${token}` : ""}`;
      ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        backoff = 1000;
        setStatusDebounced("live");
        ws?.send(JSON.stringify({ kind: "subscribe", channel: `book:${pair}` }));
        ws?.send(JSON.stringify({ kind: "subscribe", channel: `trades:${pair}` }));
        ws?.send(JSON.stringify({ kind: "subscribe", channel: "ticker:all" }));
        if (me?.id) {
          ws?.send(JSON.stringify({ kind: "subscribe", channel: `private:${me.id}` }));
        }
      });
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            kind?: string;
            channel?: string;
            book?: Book;
            bids?: RawLevel[];
            asks?: RawLevel[];
            trades?: unknown[];
            trade?: unknown;
            price?: unknown;
            amount?: unknown;
            size?: unknown;
            rows?: MarketRow[];
          };
          // The gateway publishes a few message shapes — handle both
          // a full book snapshot and incremental updates conservatively.
          if (msg.kind === "book" || msg.kind === "book_update") {
            if (msg.book) setBook(msg.book);
            else if (msg.bids && msg.asks) {
              setBook({ pair, bids: msg.bids, asks: msg.asks });
            } else {
              // Snapshot not embedded — refetch the book.
              void fetch(`/api/v2/public/book/${encodeURIComponent(pair)}`, {
                cache: "no-store",
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((b: Book | null) => {
                  if (b) setBook(b);
                });
            }
          } else if (msg.kind === "trade" || msg.kind === "trades") {
            // Accept `{trade: {...}}`, `{trades: [...]}` and the older flat
            // `{price, amount}` shape.
            const raw: unknown[] = Array.isArray(msg.trades)
              ? msg.trades
              : msg.trade && typeof msg.trade === "object"
                ? [msg.trade]
                : msg.price !== undefined
                  ? [msg]
                  : [];
            const incoming = raw
              .map(normalizeTrade)
              .filter((t): t is RecentTrade => t !== null);
            if (incoming.length > 0) {
              setRecent((prev) => [...incoming, ...prev].slice(0, 50));
            }
          } else if (msg.kind === "ticker" && Array.isArray(msg.rows)) {
            // Update the pair header live
            const currentPairRow = msg.rows.find((r) => r.pair === pair);
            if (currentPairRow) {
              setMarket((prev) =>
                prev
                  ? {
                      ...prev,
                      last: currentPairRow.last,
                      change24h: currentPairRow.change24h,
                      vol24h: currentPairRow.vol24h,
                    }
                  : prev,
              );
            }
            setAllMarkets((prev) => {
              const byPair = new Map(msg.rows!.map((r) => [r.pair, r] as const));
              return prev.map((m) => {
                const next = byPair.get(m.pair);
                if (!next) return m;
                return {
                  ...m,
                  last: next.last,
                  change24h: next.change24h,
                  vol24h: next.vol24h,
                };
              });
            });
          } else if (
            msg.kind === "user_update" ||
            msg.kind === "private" ||
            (me?.id && msg.channel === `private:${me.id}`)
          ) {
            // Own-order events → trigger refresh of orders + balances
            setRefreshKey((k) => k + 1);
            void refreshBalances();
          }
        } catch {
          /* ignore parse errors */
        }
      });
      ws.addEventListener("close", () => {
        if (closed) return;
        // Debounce the "reconnecting" badge so a fast bounce doesn't
        // flicker live → reconnecting → connecting → live in the UI.
        setStatusDebounced("reconnecting", 500);
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
      if (statusDebounceTimer) clearTimeout(statusDebounceTimer);
      ws?.close();
      setWsStatus("disconnected");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, me?.id]);

  const baseAvail = useMemo(
    () => balances.find((b) => b.asset === base)?.available ?? "0",
    [balances, base],
  );
  const quoteAvail = useMemo(
    () => balances.find((b) => b.asset === quote)?.available ?? "0",
    [balances, quote],
  );

  // For the $1000 market-notional check on non-USD-stable quotes,
  // pass the quote/USDT rate when known.
  const quoteToUsdRate = useMemo(() => {
    if (quote === "USDT" || quote === "USDC") return 1;
    const r = allMarkets.find((m) => m.base === quote && m.quote === "USDT");
    return r?.last ? Number(r.last) : null;
  }, [allMarkets, quote]);

  function onPickPrice(p: number) {
    setPriceInput(String(p));
  }
  function onPlaced() {
    setRefreshKey((k) => k + 1);
    void refreshBalances();
  }

  // Single OrderForm instance, positioned by layout. We render it once
  // per breakpoint group to avoid duplicate stateful copies in the DOM.
  function renderOrderForm() {
    return (
      <OrderForm
        base={base}
        quote={quote}
        pair={pair}
        lastPrice={market?.last ? Number(market.last) : null}
        baseAvailable={baseAvail}
        quoteAvailable={quoteAvail}
        kycTier={me?.kycTier ?? null}
        quoteToUsdRate={quoteToUsdRate}
        onPlaced={() => {
          onPlaced();
          setMobileSheetOpen(false);
        }}
        priceInput={priceInput}
        onPriceInputChange={setPriceInput}
      />
    );
  }

  const priceDp = quoteDp(quote);
  const sizeDp = baseDp(base);

  return (
    <Container className="py-4 max-w-[1600px] space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PairHeader
          base={base}
          quote={quote}
          last={market?.last ?? null}
          change24h={market?.change24h ?? 0}
          high24h={market?.high24h ?? null}
          low24h={market?.low24h ?? null}
          vol24h={market?.vol24h ?? "0"}
          className="flex-1 min-w-0 w-full md:w-auto"
        />
        <div className="shrink-0">
          <WsStatusPill status={wsStatus} />
        </div>
      </div>

      {/* md+: book + chart + form in a 3-col grid (xl) or 2-col grid
          (md-lg) where the form lives in the right column. */}
      <div className="hidden md:grid md:grid-cols-[280px_1fr_320px] gap-3">
        <div className="flex flex-col gap-3 min-w-0">
          <OrderBook
            bids={book?.bids ?? []}
            asks={book?.asks ?? []}
            last={market?.last ? Number(market.last) : null}
            priceDp={priceDp}
            sizeDp={sizeDp}
            aggPresets={presets}
            aggregation={aggregation}
            onAggregationChange={setAggregation}
            onPickPrice={onPickPrice}
          />
          <RecentTradesFeed
            trades={recent}
            priceDp={priceDp}
            sizeDp={sizeDp}
          />
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          <CandleChart pair={pair} />
          <DepthChart bids={book?.bids ?? []} asks={book?.asks ?? []} />
        </div>
        <div className="min-w-0">{renderOrderForm()}</div>
      </div>

      {/* Mobile: stacked, with tab-bar between book/trades, and a
          fixed-bottom CTA that opens the bottom-sheet order form. */}
      <div className="md:hidden flex flex-col gap-3 pb-20">
        <CandleChart pair={pair} className="h-[320px]" />
        <MobileSecondary
          book={book}
          recent={recent}
          allMarkets={allMarkets}
          presets={presets}
          aggregation={aggregation}
          setAggregation={setAggregation}
          onPickPrice={(p) => {
            onPickPrice(p);
            setMobileSheetOpen(true);
          }}
          priceDp={priceDp}
          sizeDp={sizeDp}
          last={market?.last ? Number(market.last) : null}
        />
      </div>

      <MyOrdersTable
        pair={pair}
        base={base}
        quote={quote}
        refreshKey={refreshKey}
      />

      {/* Mobile bottom CTA + sheet. The BottomSheet returns null when
          closed, so the order-form instance there is created only when
          actually used. */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-30 p-3 bg-bg border-t border-border">
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          className={cn(
            "w-full h-11 rounded-md text-sm font-semibold",
            "bg-accent text-accent-fg hover:bg-accent-hover",
          )}
        >
          Trade {base}
        </button>
      </div>
      <BottomSheet
        open={mobileSheetOpen}
        onClose={() => setMobileSheetOpen(false)}
        title={`Trade ${base}/${quote}`}
      >
        {renderOrderForm()}
      </BottomSheet>
    </Container>
  );
}

interface MobileSecondaryProps {
  book: Book | null;
  recent: RecentTrade[];
  allMarkets: MarketRow[];
  presets: number[];
  aggregation: number;
  setAggregation: (v: number) => void;
  onPickPrice: (p: number) => void;
  priceDp: number;
  sizeDp: number;
  last: number | null;
}

function MobileSecondary({
  book,
  recent,
  presets,
  aggregation,
  setAggregation,
  onPickPrice,
  priceDp,
  sizeDp,
  last,
}: MobileSecondaryProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="Order book or recent trades" className="flex gap-1">
        {(["book", "trades"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`mobile-secondary-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`mobile-secondary-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 text-xs h-8 rounded-md border border-border",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              tab === k
                ? "bg-bg-hover text-text"
                : "text-text-dim hover:bg-bg-hover hover:text-text",
            )}
          >
            {k === "book" ? "Order book" : "Recent trades"}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`mobile-secondary-panel-${tab}`}
        aria-labelledby={`mobile-secondary-tab-${tab}`}
      >
        {tab === "book" ? (
          <OrderBook
            bids={book?.bids ?? []}
            asks={book?.asks ?? []}
            last={last}
            priceDp={priceDp}
            sizeDp={sizeDp}
            aggPresets={presets}
            aggregation={aggregation}
            onAggregationChange={setAggregation}
            onPickPrice={onPickPrice}
            rowCount={10}
          />
        ) : (
          <RecentTradesFeed trades={recent} priceDp={priceDp} sizeDp={sizeDp} />
        )}
      </div>
    </div>
  );
}
