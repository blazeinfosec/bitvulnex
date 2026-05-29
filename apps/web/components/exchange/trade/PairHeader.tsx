"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { NumberCell } from "../NumberCell";
import { PercentChangeCell } from "../PercentChangeCell";
import { PriceCell } from "../PriceCell";
import { quoteDp } from "@/lib/trade/pair";

export interface PairHeaderProps {
  base: string;
  quote: string;
  last: string | null;
  change24h: number;
  high24h: string | null;
  low24h: string | null;
  vol24h: string;
  className?: string;
}

/**
 * Top strip on the trading page: pair name, last price (with flash),
 * 24h percent change, 24h high/low, 24h volume.
 */
export function PairHeader({
  base,
  quote,
  last,
  change24h,
  high24h,
  low24h,
  vol24h,
  className,
}: PairHeaderProps) {
  const prev = useRef<string | null>(last);
  const lastSeen = prev.current;
  if (last) queueMicrotask(() => (prev.current = last));
  const dp = quoteDp(quote);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 border border-border rounded-lg bg-bg-elevated",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-text">{base}</span>
        <span className="text-text-mute">/{quote}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-2xs uppercase tracking-wider text-text-mute">
          Last
        </span>
        <PriceCell
          value={last ?? "0"}
          prevValue={lastSeen ?? undefined}
          dp={dp}
          className="text-base"
        />
      </div>
      <div className="flex flex-col">
        <span className="text-2xs uppercase tracking-wider text-text-mute">
          24h change
        </span>
        <PercentChangeCell value={change24h} />
      </div>
      <div className="flex flex-col">
        <span className="text-2xs uppercase tracking-wider text-text-mute">
          24h high
        </span>
        {high24h ? (
          <NumberCell value={high24h} dp={dp} />
        ) : (
          <span className="text-text-mute">—</span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-2xs uppercase tracking-wider text-text-mute">
          24h low
        </span>
        {low24h ? (
          <NumberCell value={low24h} dp={dp} />
        ) : (
          <span className="text-text-mute">—</span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-2xs uppercase tracking-wider text-text-mute">
          24h volume
        </span>
        <NumberCell value={vol24h} dp={2} suffix={quote} />
      </div>
    </div>
  );
}
