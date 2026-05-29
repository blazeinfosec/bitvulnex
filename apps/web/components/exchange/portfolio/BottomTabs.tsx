"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BottomTab {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export interface BottomTabsProps {
  tabs: BottomTab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function BottomTabs({
  tabs,
  active,
  onChange,
  className,
}: BottomTabsProps) {
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated overflow-hidden",
        className,
      )}
    >
      <nav
        role="tablist"
        className="flex items-center gap-1 border-b border-border px-2"
      >
        {tabs.map((t) => {
          const isActive = t.key === current?.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.key)}
              className={cn(
                "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2",
                isActive
                  ? "text-accent border-accent"
                  : "text-text-dim border-transparent hover:text-text",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded text-2xs font-mono",
                    isActive
                      ? "bg-accent/20 text-accent"
                      : "bg-bg text-text-mute",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div role="tabpanel" className="p-0">
        {current?.content}
      </div>
    </div>
  );
}
