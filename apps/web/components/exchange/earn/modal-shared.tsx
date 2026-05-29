"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function pctOf(value: string, fraction: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const result = (n * fraction).toFixed(8);
  // Trim trailing zeros
  return result.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export interface PercentPillsProps {
  available: string;
  onPick: (amount: string) => void;
  disabled?: boolean;
}

export function PercentPills({ available, onPick, disabled }: PercentPillsProps) {
  const avail = Number(available);
  const noBalance = !Number.isFinite(avail) || avail <= 0;
  return (
    <div className="flex gap-1">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <button
          key={f}
          type="button"
          className={cn(
            "text-xs px-2 py-1 rounded border border-border text-text-dim",
            "hover:bg-bg-hover hover:text-text transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
          disabled={disabled || noBalance}
          onClick={() => onPick(pctOf(available, f))}
        >
          {f === 1 ? "MAX" : `${Math.round(f * 100)}%`}
        </button>
      ))}
    </div>
  );
}

export interface ModalFieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}

export function ModalField({ label, children, hint }: ModalFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs uppercase tracking-wider text-text-mute font-medium">
          {label}
        </label>
        {hint}
      </div>
      {children}
    </div>
  );
}

export const amountInputClass = cn(
  "w-full px-3 py-2 rounded-md font-mono tabular-nums",
  "bg-bg border border-border text-text",
  "placeholder:text-text-mute",
  "focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

export interface InlineMessageProps {
  kind: "ok" | "err";
  text: string;
}

export function InlineMessage({ kind, text }: InlineMessageProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        kind === "ok"
          ? "border-buy/30 bg-buy/10 text-buy"
          : "border-sell/30 bg-sell/10 text-sell",
      )}
    >
      {text}
    </div>
  );
}

export function formatDecimal(value: string | number, dp = 8): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  const result = n.toFixed(dp);
  return result.replace(/0+$/, "").replace(/\.$/, "") || "0";
}
