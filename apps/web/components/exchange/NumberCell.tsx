import { cn } from "@/lib/utils";

export interface NumberCellProps {
  value: string | number;
  dp?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  align?: "left" | "right";
}

/**
 * Right-aligned monospace number with smart precision.
 * - Integers: untouched
 * - Decimals: trim trailing zeros after the decimal point
 * - Adds locale thousands separators on the integer part
 */
function formatNumber(value: string | number, dp?: number): string {
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    return String(value);
  }

  // Capture sign separately so we don't mangle it
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);

  let str: string;
  if (typeof dp === "number") {
    str = abs.toFixed(dp);
  } else {
    str = String(abs);
  }

  // Split integer/decimal and add thousands separators on the integer part
  const [intPartRaw, decPart] = str.split(".");
  const intPart = intPartRaw ?? "0";
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (!decPart) {
    return sign + withSep;
  }

  // Trim trailing zeros from the decimal portion (smart precision)
  const trimmed = decPart.replace(/0+$/, "");
  if (!trimmed) {
    return sign + withSep;
  }
  return `${sign}${withSep}.${trimmed}`;
}

export function NumberCell({
  value,
  dp,
  prefix,
  suffix,
  className,
  align = "right",
}: NumberCellProps) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        align === "right" ? "text-right" : "text-left",
        "inline-block",
        className,
      )}
    >
      {prefix ? <span className="text-text-mute mr-0.5">{prefix}</span> : null}
      {formatNumber(value, dp)}
      {suffix ? <span className="text-text-mute ml-0.5">{suffix}</span> : null}
    </span>
  );
}

export { formatNumber };
