import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PercentChangeCell } from "./PercentChangeCell";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  delta?: { value: number; label?: string };
  hint?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, delta, hint, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated p-5 flex flex-col gap-2",
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wider text-text-mute font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold text-text font-mono tabular-nums leading-tight">
        {value}
      </div>
      <div className="flex items-center gap-2 text-xs text-text-dim">
        {delta ? (
          <>
            <PercentChangeCell value={delta.value} />
            {delta.label ? <span>{delta.label}</span> : null}
          </>
        ) : null}
        {hint}
      </div>
    </div>
  );
}
