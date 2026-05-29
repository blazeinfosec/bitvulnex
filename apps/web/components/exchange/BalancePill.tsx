import { cn } from "@/lib/utils";
import { NumberCell } from "./NumberCell";

export interface BalancePillProps {
  label?: string;
  value: string | number;
  asset: string;
  dp?: number;
  className?: string;
}

/**
 * Inline `Available: 0.42 BTC` pill. Surfaces the constraint right next to
 * the form so the user knows what they can do before they type. Fixes the
 * "I don't even know how much I can stake" complaint pattern.
 */
export function BalancePill({
  label = "Available",
  value,
  asset,
  dp,
  className,
}: BalancePillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs px-2 py-1 rounded-md border border-border bg-bg",
        className,
      )}
    >
      <span className="text-text-mute uppercase tracking-wider">{label}</span>
      <NumberCell value={value} dp={dp} className="text-text text-sm" />
      <span className="text-text-dim font-medium">{asset}</span>
    </span>
  );
}
