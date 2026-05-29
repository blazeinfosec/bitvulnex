"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { OrderBookSide, type OrderBookRow } from "./OrderBookSide";
import { OrderBookSpread } from "./OrderBookSpread";

export interface RawLevel {
  price: string | null;
  /** remaining size, decimal string */
  remaining: string;
}

export interface OrderBookProps {
  bids: RawLevel[];
  asks: RawLevel[];
  last: number | null;
  priceDp: number;
  sizeDp: number;
  aggPresets: number[];
  aggregation: number;
  onAggregationChange: (v: number) => void;
  onPickPrice?: (price: number) => void;
  rowCount?: number;
  className?: string;
}

/**
 * Aggregate raw `{price, size}` levels into price buckets sized by the
 * aggregation tick. Bids round down to the bucket floor; asks round up
 * to the bucket ceiling. Sizes within a bucket sum together. After
 * bucketing we compute the cumulative depth used for the depth bars.
 */
function bucketize(
  levels: RawLevel[],
  agg: number,
  direction: "buy" | "sell",
  take: number,
): OrderBookRow[] {
  if (!Number.isFinite(agg) || agg <= 0) return [];
  const buckets = new Map<number, number>();
  for (const lvl of levels) {
    if (!lvl.price) continue;
    const price = Number(lvl.price);
    const size = Number(lvl.remaining);
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;
    const k =
      direction === "buy"
        ? Math.floor(price / agg) * agg
        : Math.ceil(price / agg) * agg;
    // Round the bucket key to avoid floating-point key drift
    const key = Number(k.toFixed(8));
    buckets.set(key, (buckets.get(key) ?? 0) + size);
  }
  // Sort: bids high → low; asks low → high
  const sorted = Array.from(buckets.entries()).sort(([a], [b]) =>
    direction === "buy" ? b - a : a - b,
  );
  const out: OrderBookRow[] = [];
  let cum = 0;
  for (const [price, size] of sorted.slice(0, take)) {
    cum += size;
    out.push({ price, size, cumSize: cum });
  }
  return out;
}

export function OrderBook({
  bids,
  asks,
  last,
  priceDp,
  sizeDp,
  aggPresets,
  aggregation,
  onAggregationChange,
  onPickPrice,
  rowCount = 15,
  className,
}: OrderBookProps) {
  const bidRows = useMemo(
    () => bucketize(bids, aggregation, "buy", rowCount),
    [bids, aggregation, rowCount],
  );
  const askRows = useMemo(
    () => bucketize(asks, aggregation, "sell", rowCount),
    [asks, aggregation, rowCount],
  );

  const maxCum = useMemo(() => {
    let m = 0;
    for (const r of bidRows) if (r.cumSize > m) m = r.cumSize;
    for (const r of askRows) if (r.cumSize > m) m = r.cumSize;
    return m;
  }, [bidRows, askRows]);

  const bestBid = bidRows[0]?.price ?? null;
  const bestAsk = askRows[0]?.price ?? null;

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border rounded-lg bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Order book
        </h3>
        <div className="flex items-center gap-1">
          {aggPresets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onAggregationChange(p)}
              className={cn(
                "text-2xs px-1.5 py-0.5 rounded border border-border font-mono",
                aggregation === p
                  ? "bg-bg-hover text-text"
                  : "text-text-dim hover:bg-bg-hover hover:text-text",
              )}
              aria-pressed={aggregation === p}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 py-1 text-2xs uppercase tracking-wider text-text-mute border-b border-border-subtle">
        <span className="text-left">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Sum</span>
      </div>
      <OrderBookSide
        side="ask"
        rows={askRows}
        maxCum={maxCum}
        priceDp={priceDp}
        sizeDp={sizeDp}
        direction="bottom-up"
        onPickPrice={onPickPrice}
        rowCount={rowCount}
      />
      <OrderBookSpread
        last={last}
        bestBid={bestBid}
        bestAsk={bestAsk}
        priceDp={priceDp}
      />
      <OrderBookSide
        side="bid"
        rows={bidRows}
        maxCum={maxCum}
        priceDp={priceDp}
        sizeDp={sizeDp}
        direction="top-down"
        onPickPrice={onPickPrice}
        rowCount={rowCount}
      />
    </div>
  );
}
