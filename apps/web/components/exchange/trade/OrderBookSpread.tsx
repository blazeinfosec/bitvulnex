"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "../NumberCell";

export interface OrderBookSpreadProps {
  last: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  priceDp: number;
  className?: string;
}

/**
 * Middle row of the order book. Shows `last · spread · spread%`.
 */
export function OrderBookSpread({
  last,
  bestBid,
  bestAsk,
  priceDp,
  className,
}: OrderBookSpreadProps) {
  let spread: number | null = null;
  let spreadPct: number | null = null;
  if (bestBid !== null && bestAsk !== null && bestAsk > 0) {
    spread = bestAsk - bestBid;
    spreadPct = (spread / bestAsk) * 100;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-2 py-1.5 border-y border-border bg-bg",
        "font-mono tabular-nums text-xs",
        className,
      )}
    >
      <span className="text-text">
        {last !== null ? formatNumber(last, priceDp) : "—"}
      </span>
      <span className="text-text-mute text-2xs uppercase tracking-wider">
        Spread
      </span>
      <span className="text-text-dim">
        {spread !== null ? formatNumber(spread, priceDp) : "—"}{" "}
        <span className="text-text-mute">
          ({spreadPct !== null ? `${spreadPct.toFixed(3)}%` : "—"})
        </span>
      </span>
    </div>
  );
}
