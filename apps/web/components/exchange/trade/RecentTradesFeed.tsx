"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "../NumberCell";

export interface RecentTrade {
  id: string | number;
  price: number;
  size: number;
  /** ISO8601 timestamp string or epoch ms */
  executedAt: string | number;
  /** Optional taker side; not all sources include it. */
  takerSide?: "buy" | "sell";
}

export interface RecentTradesFeedProps {
  trades: RecentTrade[];
  priceDp: number;
  sizeDp: number;
  className?: string;
}

function formatTime(t: string | number): string {
  const d = typeof t === "string" ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Tape feed of recent trades, newest at the top, color-coded by taker
 * side when known. When the taker side isn't reported we fall back to
 * an up/down comparison against the previous trade's price.
 */
export function RecentTradesFeed({
  trades,
  priceDp,
  sizeDp,
  className,
}: RecentTradesFeedProps) {
  const rows = useMemo(() => {
    // Determine implied side when not provided
    const out: Array<RecentTrade & { side: "buy" | "sell" | "flat" }> = [];
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      let side: "buy" | "sell" | "flat" = "flat";
      if (t.takerSide) side = t.takerSide;
      else {
        const next = trades[i + 1];
        if (next) {
          if (t.price > next.price) side = "buy";
          else if (t.price < next.price) side = "sell";
        }
      }
      out.push({ ...t, side });
    }
    return out;
  }, [trades]);

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border rounded-lg bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Recent trades
        </h3>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 py-1 text-2xs uppercase tracking-wider text-text-mute border-b border-border-subtle">
        <span className="text-left">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      <ul
        role="list"
        className="overflow-y-auto max-h-[300px] text-2xs font-mono tabular-nums"
      >
        {rows.length === 0 ? (
          <li className="px-2 py-6 text-center text-text-mute text-xs">
            Recent trades will appear here when the market is active.
          </li>
        ) : (
          rows.map((r) => {
            const priceColor =
              r.side === "buy"
                ? "text-buy"
                : r.side === "sell"
                  ? "text-sell"
                  : "text-text";
            return (
              <li
                key={r.id}
                className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 h-5 items-center border-b border-border-subtle last:border-0"
              >
                <span className={cn("text-left", priceColor)}>
                  {formatNumber(r.price, priceDp)}
                </span>
                <span className="text-right text-text">
                  {formatNumber(r.size, sizeDp)}
                </span>
                <span className="text-right text-text-mute">
                  {formatTime(r.executedAt)}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
