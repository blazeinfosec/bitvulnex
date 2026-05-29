import { cn } from "@/lib/utils";
import { ArrowIndicator } from "./ArrowIndicator";

export interface PercentChangeCellProps {
  value: number;
  decimals?: number;
  className?: string;
}

/**
 * Renders a signed percent like `+1.23%` / `-0.45%` with buy/sell color and
 * a small ▲/▼ icon prefix (color-blind redundancy). Zero gets a dim flat
 * marker.
 */
export function PercentChangeCell({
  value,
  decimals = 2,
  className,
}: PercentChangeCellProps) {
  const direction: "up" | "down" | "flat" =
    value > 0 ? "up" : value < 0 ? "down" : "flat";
  const color =
    direction === "up"
      ? "text-buy"
      : direction === "down"
        ? "text-sell"
        : "text-text-mute";
  const sign = value > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums text-sm",
        color,
        className,
      )}
    >
      <ArrowIndicator direction={direction} />
      <span>
        {sign}
        {value.toFixed(decimals)}%
      </span>
    </span>
  );
}
