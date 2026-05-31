"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "../DataTable";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "../Skeleton";
import { NumberCell } from "../NumberCell";
import { authedFetch, getAccessToken } from "@/lib/token-storage";
import { baseDp, quoteDp } from "@/lib/trade/pair";

type TabKey = "open" | "history" | "trades" | "positions";

type OrderRow = {
  id: number;
  pair: string;
  side: "buy" | "sell";
  type: string;
  price: string | null;
  amount: string;
  filled: string;
  status: string;
  stopTrigger: string | null;
  createdAt: string;
};

type TradeRow = {
  id: number;
  pair: string;
  price: string;
  amount: string;
  fee: string;
  feeAsset: string;
  side: "buy" | "sell";
  executedAt: string;
};

type PositionRow = {
  id: number;
  pair: string;
  side: "long" | "short";
  size: string;
  entryPrice: string;
  collateral: string;
  liquidationPrice: string;
  leverage: number;
  status: "open" | "closed" | "liquidated";
  openedAt: string;
  closedPrice: string | null;
  realizedPnl: string | null;
};

export interface MyOrdersTableProps {
  /** Constrain the rows to a specific pair (the trading page). */
  pair: string;
  base: string;
  quote: string;
  /** Bumping this forces a refresh — used when the parent knows an
   *  order was placed/cancelled. */
  refreshKey?: number;
  /** Optional callback so the parent can invalidate other state too. */
  onChange?: () => void;
  className?: string;
}

const TAB_LABEL: Record<TabKey, string> = {
  open: "Open orders",
  history: "Order history",
  trades: "Trade history",
  positions: "Positions",
};

/**
 * Bottom-area tabs on the trading page: open orders, order history,
 * trade history, positions. Each tab uses DataTable. Open orders has a
 * cancel button per row that calls DELETE /api/v2/me/orders/:id.
 */
export function MyOrdersTable({
  pair,
  base,
  quote,
  refreshKey = 0,
  onChange,
  className,
}: MyOrdersTableProps) {
  const [tab, setTab] = useState<TabKey>("open");
  const [open, setOpen] = useState<OrderRow[] | null>(null);
  const [history, setHistory] = useState<OrderRow[] | null>(null);
  const [trades, setTrades] = useState<TradeRow[] | null>(null);
  const [positions, setPositions] = useState<PositionRow[] | null>(null);
  const [bumpKey, setBumpKey] = useState(0);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  // Tracked in state so a sign-in flow flips this without a reload.
  // Initialise to `false` on both server and client so the first
  // (hydration) render matches; the effect below reads the real token
  // after mount. Reading localStorage in the initializer would desync
  // SSR vs client and trip a hydration mismatch.
  const [authed, setAuthed] = useState<boolean>(false);
  useEffect(() => {
    const update = () => setAuthed(Boolean(getAccessToken()));
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  const localRefresh = useCallback(() => setBumpKey((k) => k + 1), []);

  // Lazy load per active tab. Gate on auth state — calling authed
  // endpoints anonymously produces 401 noise we'd rather avoid.
  useEffect(() => {
    let cancelled = false;
    if (!authed) {
      setOpen([]);
      setHistory([]);
      setTrades([]);
      setPositions([]);
      return;
    }
    async function load() {
      try {
        if (tab === "open") {
          const r = await authedFetch("/api/v2/me/orders?status=open");
          if (!cancelled && r.ok) {
            const b = (await r.json()) as { orders: OrderRow[] };
            setOpen(b.orders.filter((o) => o.pair === pair));
          }
          // Also load partials — they belong in "open" too.
          const r2 = await authedFetch("/api/v2/me/orders?status=partial");
          if (!cancelled && r2.ok) {
            const b2 = (await r2.json()) as { orders: OrderRow[] };
            setOpen((prev) => {
              const partials = b2.orders.filter((o) => o.pair === pair);
              const map = new Map<number, OrderRow>();
              for (const o of [...(prev ?? []), ...partials]) {
                map.set(o.id, o);
              }
              return Array.from(map.values()).sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              );
            });
          }
        } else if (tab === "history") {
          const r = await authedFetch("/api/v2/me/orders");
          if (!cancelled && r.ok) {
            const b = (await r.json()) as { orders: OrderRow[] };
            setHistory(
              b.orders.filter(
                (o) =>
                  o.pair === pair &&
                  (o.status === "filled" || o.status === "cancelled"),
              ),
            );
          }
        } else if (tab === "trades") {
          // No dedicated /me/trades endpoint in this slice; derive from
          // orders' filled portion. A future slice can replace this.
          const r = await authedFetch("/api/v2/me/orders");
          if (!cancelled && r.ok) {
            const b = (await r.json()) as { orders: OrderRow[] };
            const synthetic: TradeRow[] = b.orders
              .filter(
                (o) =>
                  o.pair === pair && Number(o.filled) > 0 && o.price !== null,
              )
              .map((o) => ({
                id: o.id,
                pair: o.pair,
                price: o.price as string,
                amount: o.filled,
                fee: "0",
                feeAsset: o.side === "buy" ? base : quote,
                side: o.side,
                executedAt: o.createdAt,
              }));
            setTrades(synthetic);
          }
        } else if (tab === "positions") {
          const r = await authedFetch("/api/v2/me/margin/positions");
          if (!cancelled && r.ok) {
            const b = (await r.json()) as { positions: PositionRow[] };
            setPositions(b.positions.filter((p) => p.pair === pair));
          }
        }
      } catch {
        /* ignore */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, pair, base, quote, refreshKey, bumpKey, authed]);

  async function cancel(id: number) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await authedFetch(`/api/v2/me/orders/${id}`, { method: "DELETE" });
      localRefresh();
      onChange?.();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const priceDp = quoteDp(quote);
  const sizeDp = baseDp(base);

  const openCols: Column<OrderRow>[] = useMemo(
    () => [
      {
        key: "side",
        header: "Side",
        align: "left",
        render: (r) => (
          <span
            className={cn(
              "uppercase font-semibold text-xs",
              r.side === "buy" ? "text-buy" : "text-sell",
            )}
          >
            {r.side}
          </span>
        ),
      },
      {
        key: "type",
        header: "Type",
        align: "left",
        render: (r) => <span className="text-text-dim text-xs">{r.type}</span>,
      },
      {
        key: "price",
        header: `Price (${quote})`,
        align: "right",
        render: (r) =>
          r.price ? (
            <NumberCell value={r.price} dp={priceDp} />
          ) : (
            <span className="text-text-mute">market</span>
          ),
      },
      {
        key: "amount",
        header: `Amount (${base})`,
        align: "right",
        render: (r) => <NumberCell value={r.amount} dp={sizeDp} />,
      },
      {
        key: "filled",
        header: "Filled",
        align: "right",
        render: (r) => (
          <span className="text-text-dim font-mono tabular-nums text-xs">
            {Number(r.amount) > 0
              ? `${((Number(r.filled) / Number(r.amount)) * 100).toFixed(1)}%`
              : "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        align: "left",
        render: (r) => (
          <span className="text-text-dim text-xs">{r.status}</span>
        ),
      },
      {
        key: "action",
        header: "",
        align: "right",
        render: (r) => (
          <button
            type="button"
            onClick={() => cancel(r.id)}
            disabled={busyIds.has(r.id)}
            className="text-xs px-2 py-1 rounded border border-border text-text-dim hover:bg-bg-hover hover:text-sell disabled:opacity-50"
          >
            {busyIds.has(r.id) ? "Cancelling…" : "Cancel"}
          </button>
        ),
      },
    ],
    [quote, base, priceDp, sizeDp, busyIds],
  );

  const historyCols: Column<OrderRow>[] = useMemo(
    () => [
      {
        key: "side",
        header: "Side",
        align: "left",
        render: (r) => (
          <span
            className={cn(
              "uppercase font-semibold text-xs",
              r.side === "buy" ? "text-buy" : "text-sell",
            )}
          >
            {r.side}
          </span>
        ),
      },
      {
        key: "type",
        header: "Type",
        align: "left",
        render: (r) => <span className="text-text-dim text-xs">{r.type}</span>,
      },
      {
        key: "price",
        header: `Price (${quote})`,
        align: "right",
        render: (r) =>
          r.price ? (
            <NumberCell value={r.price} dp={priceDp} />
          ) : (
            <span className="text-text-mute">market</span>
          ),
      },
      {
        key: "amount",
        header: `Amount (${base})`,
        align: "right",
        render: (r) => <NumberCell value={r.amount} dp={sizeDp} />,
      },
      {
        key: "status",
        header: "Status",
        align: "left",
        render: (r) => (
          <span className="text-text-dim text-xs">{r.status}</span>
        ),
      },
      {
        key: "createdAt",
        header: "When (UTC)",
        align: "right",
        render: (r) => (
          <span className="text-2xs text-text-mute font-mono">
            {new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}
          </span>
        ),
      },
    ],
    [quote, base, priceDp, sizeDp],
  );

  const tradeCols: Column<TradeRow>[] = useMemo(
    () => [
      {
        key: "side",
        header: "Side",
        align: "left",
        render: (r) => (
          <span
            className={cn(
              "uppercase font-semibold text-xs",
              r.side === "buy" ? "text-buy" : "text-sell",
            )}
          >
            {r.side}
          </span>
        ),
      },
      {
        key: "price",
        header: `Price (${quote})`,
        align: "right",
        render: (r) => <NumberCell value={r.price} dp={priceDp} />,
      },
      {
        key: "amount",
        header: `Filled (${base})`,
        align: "right",
        render: (r) => <NumberCell value={r.amount} dp={sizeDp} />,
      },
      {
        key: "executedAt",
        header: "When (UTC)",
        align: "right",
        render: (r) => (
          <span className="text-2xs text-text-mute font-mono">
            {new Date(r.executedAt).toISOString().replace("T", " ").slice(0, 19)}
          </span>
        ),
      },
    ],
    [quote, base, priceDp, sizeDp],
  );

  const positionCols: Column<PositionRow>[] = useMemo(
    () => [
      {
        key: "side",
        header: "Side",
        align: "left",
        render: (r) => (
          <span
            className={cn(
              "uppercase font-semibold text-xs",
              r.side === "long" ? "text-buy" : "text-sell",
            )}
          >
            {r.side}
          </span>
        ),
      },
      {
        key: "size",
        header: `Size (${base})`,
        align: "right",
        render: (r) => <NumberCell value={r.size} dp={sizeDp} />,
      },
      {
        key: "entry",
        header: "Entry",
        align: "right",
        render: (r) => <NumberCell value={r.entryPrice} dp={priceDp} />,
      },
      {
        key: "liq",
        header: "Liq.",
        align: "right",
        render: (r) => (
          <NumberCell
            value={r.liquidationPrice}
            dp={priceDp}
            className="text-warn"
          />
        ),
      },
      {
        key: "lev",
        header: "Lev",
        align: "right",
        render: (r) => (
          <span className="text-text-dim font-mono">×{r.leverage}</span>
        ),
      },
      {
        key: "status",
        header: "Status",
        align: "left",
        render: (r) => (
          <span className="text-text-dim text-xs">{r.status}</span>
        ),
      },
    ],
    [base, sizeDp, priceDp],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border border-border rounded-lg bg-bg-elevated p-4",
        className,
      )}
    >
      <div role="tablist" aria-label="My orders" className="flex gap-1 flex-wrap">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`my-orders-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`my-orders-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={cn(
              "text-xs px-3 h-8 rounded-md border border-border",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              tab === k
                ? "bg-bg-hover text-text"
                : "text-text-dim hover:bg-bg-hover hover:text-text",
            )}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`my-orders-panel-${tab}`}
        aria-labelledby={`my-orders-tab-${tab}`}
      >
      {!authed ? (
        <EmptyState
          title="Sign in to see your orders"
          description="Your open orders, history, and positions appear here once you sign in."
          action={{ label: "Sign in", href: "/login" }}
        />
      ) : null}

      {authed && tab === "open" &&
        (open === null ? (
          <Skeleton className="h-32 w-full" />
        ) : open.length === 0 ? (
          <EmptyState
            title="You have no open orders."
            description={`Place your first ${base}/${quote} order using the form above.`}
          />
        ) : (
          <DataTable
            columns={openCols}
            rows={open}
            rowKey={(r) => String(r.id)}
          />
        ))}

      {authed && tab === "history" &&
        (history === null ? (
          <Skeleton className="h-32 w-full" />
        ) : history.length === 0 ? (
          <EmptyState
            title="No filled or cancelled orders yet."
            description="Closed orders for this pair will appear here."
          />
        ) : (
          <DataTable
            columns={historyCols}
            rows={history}
            rowKey={(r) => String(r.id)}
          />
        ))}

      {authed && tab === "trades" &&
        (trades === null ? (
          <Skeleton className="h-32 w-full" />
        ) : trades.length === 0 ? (
          <EmptyState
            title="No trades yet."
            description="Your filled orders will show up here as trades."
          />
        ) : (
          <DataTable
            columns={tradeCols}
            rows={trades}
            rowKey={(r) => String(r.id)}
          />
        ))}

      {authed && tab === "positions" &&
        (positions === null ? (
          <Skeleton className="h-32 w-full" />
        ) : positions.length === 0 ? (
          <EmptyState
            title="You have no open positions on this pair."
            description="Margin positions opened on this market will appear here."
          />
        ) : (
          <DataTable
            columns={positionCols}
            rows={positions}
            rowKey={(r) => String(r.id)}
          />
        ))}
      </div>
    </div>
  );
}
