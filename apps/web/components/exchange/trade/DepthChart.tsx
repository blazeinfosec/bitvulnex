"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  cumulative,
  depthAreaPath,
  depthBounds,
} from "@/lib/trade/depth";
import type { RawLevel } from "./OrderBook";

export interface DepthChartProps {
  bids: RawLevel[];
  asks: RawLevel[];
  height?: number;
  className?: string;
}

/**
 * Tiny SVG cumulative bid+ask area chart. The component is intended to
 * sit under the candle chart; height is ~80px by default. Renders a
 * placeholder when the book is empty.
 */
export function DepthChart({
  bids,
  asks,
  height = 80,
  className,
}: DepthChartProps) {
  const width = 600;

  const { bidPath, askPath } = useMemo(() => {
    // Bids: iterate from best (top of array) accumulating; for the
    // SVG path we want ascending price, so reverse after accumulation.
    const bidCum = cumulative(
      bids.map((l) => ({ price: l.price, size: l.remaining })),
    );
    const askCum = cumulative(
      asks.map((l) => ({ price: l.price, size: l.remaining })),
    );
    const bounds = depthBounds(bidCum, askCum);
    if (!bounds) return { bidPath: "", askPath: "" };
    return {
      bidPath: depthAreaPath(
        bidCum.slice().reverse(),
        bounds,
        width,
        height,
      ),
      askPath: depthAreaPath(askCum, bounds, width, height),
    };
  }, [bids, asks, height]);

  return (
    <div
      className={cn(
        "border border-border rounded-lg bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Depth
        </h3>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Cumulative depth chart"
      >
        {bidPath ? (
          <path d={bidPath} fill="rgba(14, 203, 129, 0.35)" stroke="#0ECB81" strokeWidth="1" />
        ) : null}
        {askPath ? (
          <path d={askPath} fill="rgba(246, 70, 93, 0.35)" stroke="#F6465D" strokeWidth="1" />
        ) : null}
        {!bidPath && !askPath ? (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="#848E9C"
            fontSize="11"
          >
            no depth
          </text>
        ) : null}
      </svg>
    </div>
  );
}
