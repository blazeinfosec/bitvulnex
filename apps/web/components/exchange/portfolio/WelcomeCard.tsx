"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface WelcomeStep {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  done: boolean;
}

const DISMISS_KEY = "bvbe.ui.portfolio.welcomeDismissed";

export interface WelcomeCardProps {
  steps: WelcomeStep[];
  className?: string;
}

export function WelcomeCard({ steps, className }: WelcomeCardProps) {
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const allDone = steps.every((s) => s.done);
  if (!hydrated) return null;
  if (dismissed || allDone) return null;

  const doneCount = steps.filter((s) => s.done).length;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-accent/30 bg-accent/5 p-5 mb-6",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-base font-semibold text-text">
            Get started on BVBE
          </h2>
          <p className="text-xs text-text-dim mt-1">
            {doneCount} of {steps.length} complete — finish onboarding to
            unlock all features.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss welcome checklist"
          className="text-text-mute hover:text-text text-xl leading-none px-2 py-1 rounded hover:bg-bg-hover transition-colors"
        >
          ×
        </button>
      </div>
      <ol className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              "rounded-md border border-border bg-bg-elevated p-3 flex flex-col gap-2",
              s.done && "opacity-60",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0",
                  s.done
                    ? "bg-buy text-bg"
                    : "bg-bg border border-border text-text-dim",
                )}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  s.done ? "text-text-dim line-through" : "text-text",
                )}
              >
                {s.title}
              </span>
            </div>
            <p
              className={cn(
                "text-xs",
                s.done ? "text-text-mute line-through" : "text-text-dim",
              )}
            >
              {s.description}
            </p>
            {!s.done ? (
              <Link
                href={s.ctaHref}
                className="text-xs font-semibold text-accent hover:underline mt-auto"
              >
                {s.ctaLabel} →
              </Link>
            ) : (
              <span className="text-xs text-buy font-medium mt-auto">Done</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
