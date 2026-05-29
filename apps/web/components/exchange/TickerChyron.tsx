"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PriceCell } from "./PriceCell";
import { PercentChangeCell } from "./PercentChangeCell";

export interface TickerMarket {
  pair: string;
  last: string;
  changePct: number;
}

export interface TickerChyronProps {
  markets: TickerMarket[];
  className?: string;
}

/**
 * Top-of-page horizontal scrolling band. The marquee duplicates the row so the
 * loop is seamless. Slice 2 will swap the static `markets` prop for live WS
 * data; the rendering layer is identical.
 */
export function TickerChyron({ markets, className }: TickerChyronProps) {
  // Duplicate the list so the marquee loop is seamless
  const items = useMemo(() => [...markets, ...markets], [markets]);

  if (markets.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "w-full border-b border-border bg-bg overflow-hidden group",
        className,
      )}
      role="region"
      aria-label="Market ticker"
    >
      <div className="flex whitespace-nowrap animate-marquee group-hover:[animation-play-state:paused] py-2">
        {items.map((m, idx) => (
          <Link
            key={`${m.pair}-${idx}`}
            href={`/account/trading/${m.pair.replace("/", "-")}`}
            className="inline-flex items-center gap-2 px-6 text-sm no-underline hover:text-accent"
          >
            <span className="text-text-dim font-medium">{m.pair}</span>
            <PriceCell value={m.last} />
            <PercentChangeCell value={m.changePct} />
          </Link>
        ))}
      </div>
    </div>
  );
}
