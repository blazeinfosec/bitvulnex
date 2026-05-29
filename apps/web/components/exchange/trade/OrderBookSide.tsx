"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "../NumberCell";

export type BookSide = "bid" | "ask";

export interface OrderBookRow {
  price: number;
  size: number;
  cumSize: number;
}

export interface OrderBookSideProps {
  side: BookSide;
  rows: OrderBookRow[];
  maxCum: number;
  priceDp: number;
  sizeDp: number;
  /** Bids are stacked top-down (best first), asks bottom-up (best last). */
  direction: "top-down" | "bottom-up";
  /** Click on a row populates the order-form price input. */
  onPickPrice?: (price: number) => void;
  rowCount?: number;
}

/**
 * One half of the order book. Each row has a depth-bar background
 * whose width is scaled to `cumSize / maxCum`. Bid rows fill from the
 * right with `buy-dim`; ask rows fill from the right with `sell-dim`.
 */
export function OrderBookSide({
  side,
  rows,
  maxCum,
  priceDp,
  sizeDp,
  direction,
  onPickPrice,
  rowCount = 15,
}: OrderBookSideProps) {
  const padded: (OrderBookRow | null)[] = [];
  for (let i = 0; i < rowCount; i++) {
    padded.push(rows[i] ?? null);
  }
  // Asks render bottom-up: best ask sits closest to the spread row.
  // We do that by reversing the array; the visual list still reads
  // top-to-bottom with smallest price at the bottom.
  const ordered = direction === "bottom-up" ? padded.slice().reverse() : padded;

  const colorPrice = side === "bid" ? "text-buy" : "text-sell";
  const depthBg = side === "bid" ? "bg-buy-dim/40" : "bg-sell-dim/40";

  return (
    <ul
      role="list"
      aria-label={side === "bid" ? "Bids" : "Asks"}
      className="text-2xs font-mono tabular-nums"
    >
      {ordered.map((r, i) => {
        const width = r && maxCum > 0 ? Math.min(100, (r.cumSize / maxCum) * 100) : 0;
        return (
          <li
            key={i}
            className={cn(
              "relative h-5 px-2 grid grid-cols-[1fr_1fr_1fr] items-center",
              "border-b border-border-subtle last:border-0",
              r && onPickPrice ? "cursor-pointer hover:bg-bg-hover" : "",
            )}
            onClick={r && onPickPrice ? () => onPickPrice(r.price) : undefined}
          >
            <span
              aria-hidden
              className={cn("absolute inset-y-0 right-0", depthBg)}
              style={{ width: `${width}%` }}
            />
            <span className={cn("relative z-10 text-left", colorPrice)}>
              {r ? formatNumber(r.price, priceDp) : ""}
            </span>
            <span className="relative z-10 text-right text-text">
              {r ? formatNumber(r.size, sizeDp) : ""}
            </span>
            <span className="relative z-10 text-right text-text-dim">
              {r ? formatNumber(r.cumSize, sizeDp) : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
