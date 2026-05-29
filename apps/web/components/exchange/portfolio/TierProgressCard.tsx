import Link from "next/link";
import { cn } from "@/lib/utils";

export interface TierProgressCardProps {
  current: number;
  next: number | null;
  requirements: string[];
  className?: string;
}

const TIER_LABEL: Record<number, string> = {
  0: "Unverified",
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
};

export function TierProgressCard({
  current,
  next,
  requirements,
  className,
}: TierProgressCardProps) {
  const pct = next === null ? 100 : Math.min(100, (current / 3) * 100);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-bg-elevated p-5 flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Account tier
        </span>
        <span className="text-xs text-text-dim">
          {next === null ? "Max tier" : `${current}/3`}
        </span>
      </div>
      <div className="text-2xl font-semibold text-text leading-tight">
        {TIER_LABEL[current] ?? `Tier ${current}`}
        {next !== null ? (
          <span className="text-text-mute font-normal text-base">
            {" "}
            → {TIER_LABEL[next] ?? `Tier ${next}`}
          </span>
        ) : null}
      </div>
      <div className="w-full h-1.5 rounded-full bg-bg overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            next === null ? "bg-buy" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      {requirements.length > 0 && next !== null ? (
        <>
          <ul className="text-xs text-text-dim space-y-1">
            {requirements.slice(0, 2).map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-text-mute">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/account/kyc"
            className="inline-flex items-center text-xs font-semibold text-accent hover:underline"
          >
            Continue verification →
          </Link>
        </>
      ) : (
        <p className="text-xs text-text-mute">
          You&apos;ve unlocked the highest tier and all platform features.
        </p>
      )}
    </div>
  );
}
