"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "./NumberCell";

export interface PriceCellProps {
  value: string;
  prevValue?: string;
  dp?: number;
  className?: string;
}

/**
 * Monospace price display that briefly flashes buy/sell color when the value
 * changes relative to prevValue. Settles to neutral after 250ms.
 * Respects prefers-reduced-motion.
 */
export function PriceCell({ value, prevValue, dp, className }: PriceCellProps) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const lastSeen = useRef<string | undefined>(prevValue);

  useEffect(() => {
    const ref = prevValue ?? lastSeen.current;
    if (ref === undefined || ref === value) {
      lastSeen.current = value;
      return;
    }
    const cur = Number(value);
    const prev = Number(ref);
    if (Number.isFinite(cur) && Number.isFinite(prev) && cur !== prev) {
      setFlash(cur > prev ? "up" : "down");
      const id = window.setTimeout(() => setFlash(null), 250);
      lastSeen.current = value;
      return () => window.clearTimeout(id);
    }
    lastSeen.current = value;
  }, [value, prevValue]);

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block px-1 rounded-sm transition-colors",
        flash === "up" && "text-buy animate-flash-buy",
        flash === "down" && "text-sell animate-flash-sell",
        !flash && "text-text",
        className,
      )}
    >
      {formatNumber(value, dp)}
    </span>
  );
}
