"use client";

import { cn } from "@/lib/utils";

export interface SideToggleProps {
  value: "buy" | "sell";
  onChange: (side: "buy" | "sell") => void;
  className?: string;
}

/**
 * Large 50/50 buy/sell tab control at the top of an order form. The active
 * side gets the solid color tint; inactive is dim text on the panel bg.
 */
export function SideToggle({ value, onChange, className }: SideToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Order side"
      className={cn(
        "grid grid-cols-2 rounded-md overflow-hidden border border-border bg-bg",
        className,
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "buy"}
        onClick={() => onChange("buy")}
        className={cn(
          "h-10 text-sm font-semibold uppercase tracking-wider transition-colors",
          value === "buy"
            ? "bg-buy text-bg"
            : "bg-transparent text-text-mute hover:text-buy",
        )}
      >
        Buy
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "sell"}
        onClick={() => onChange("sell")}
        className={cn(
          "h-10 text-sm font-semibold uppercase tracking-wider transition-colors",
          value === "sell"
            ? "bg-sell text-bg"
            : "bg-transparent text-text-mute hover:text-sell",
        )}
      >
        Sell
      </button>
    </div>
  );
}
