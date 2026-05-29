import { cn } from "@/lib/utils";

export interface ArrowIndicatorProps {
  direction: "up" | "down" | "flat";
  className?: string;
}

/**
 * Tiny ▲ / ▼ icon for buy/sell direction. Provides color-blind redundancy
 * to red/green text. Rendered as a 10px SVG triangle. The fill is left as
 * `currentColor` so the parent can color it (typically same color as the
 * percentage text — that's the affordance).
 */
export function ArrowIndicator({ direction, className }: ArrowIndicatorProps) {
  if (direction === "flat") {
    return (
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        className={cn("inline-block align-baseline", className)}
      >
        <line
          x1="1"
          y1="5"
          x2="9"
          y2="5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn("inline-block align-baseline", className)}
    >
      {direction === "up" ? (
        <polygon points="5,1 9,8 1,8" fill="currentColor" />
      ) : (
        <polygon points="5,9 9,2 1,2" fill="currentColor" />
      )}
    </svg>
  );
}
