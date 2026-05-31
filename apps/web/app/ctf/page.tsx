"use client";

import { useCallback, useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import { cn } from "@/lib/utils";

type Cohort = {
  name: string;
  saltFingerprint: string;
  hintsDefault: boolean;
  verboseUnlockSeconds: number;
  archived: boolean;
};

type Override = "follow" | "enable" | "disable";

type Me = {
  cohort: Cohort;
  hints: { userOverride: Override; effective: boolean };
  score: {
    plantFlags: number;
    chainFlags: number;
    plantTotal: number;
    chainTotal: number;
  };
  targets: Array<{ targetKey: string; valid: boolean; attempts: number }>;
  reveals: Array<{ targetKey: string; tier: number; revealedAt: string }>;
  interactions: Array<{ targetKey: string; firstAt: string }>;
};

// PLANT_KEYS and CHAINS are populated from /api/v2/ctf/targets at
// mount; this keeps the trainee surface in sync with the canonical
// catalog (apps/web/lib/ctf/catalog.ts).
type CatalogEntry = {
  key: string;
  kind: "plant" | "chain";
  pattern: "A" | "B" | "C";
  category: string;
  difficulty: "easy" | "medium" | "hard" | "expert";
};

const CHAIN_TITLES: Record<string, string> = {
  "CHAIN-A": "Drain the hot wallet",
  "CHAIN-B": "Become admin and persist",
  "CHAIN-C": "Mass takeover via oracle",
  "CHAIN-D": "Exfiltrate KYC",
};

export default function CtfPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitInput, setSubmitInput] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // One-shot load of the canonical catalog so we don't duplicate the
  // 44-entry list in this file.
  useEffect(() => {
    void (async () => {
      const r = await authedFetch("/api/v2/ctf/targets");
      if (r.ok) {
        const body = (await r.json()) as { targets: CatalogEntry[] };
        setCatalog(body.targets);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    const r = await authedFetch("/api/v2/ctf/me");
    if (r.status === 404) {
      setError(
        "CTF mode is disabled on this deployment. Set CTF_MODE=true to enable.",
      );
      return;
    }
    if (r.status === 401) {
      setError("Sign in to view your CTF state.");
      return;
    }
    if (!r.ok) {
      setError(`Unexpected error (${r.status}).`);
      return;
    }
    setMe((await r.json()) as Me);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitFlag(e: React.FormEvent) {
    e.preventDefault();
    setSubmitMsg(null);
    setSubmitting(true);
    try {
      const r = await authedFetch("/api/v2/ctf/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetKey: targetInput.trim().toUpperCase(),
          flag: submitInput.trim(),
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        setSubmitMsg(
          body?.error?.message ? `Rejected: ${body.error.message}` : "Rejected.",
        );
        return;
      }
      if (body?.valid) {
        setSubmitMsg(`✓ ${body.targetKey} accepted.`);
        setSubmitInput("");
        await refresh();
      } else {
        setSubmitMsg("✗ Not a valid flag for that target.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function changeOverride(override: Override) {
    await authedFetch("/api/v2/ctf/me/hints-override", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ override }),
    });
    await refresh();
  }

  if (error) {
    return (
      <Container className="py-10">
        <h1 className="text-2xl font-semibold text-text mb-2">CTF</h1>
        <p className="text-sm text-text-dim">{error}</p>
      </Container>
    );
  }
  if (!me || !catalog) {
    return (
      <Container className="py-10">
        <h1 className="text-2xl font-semibold text-text mb-2">CTF</h1>
        <p className="text-sm text-text-mute">Loading…</p>
      </Container>
    );
  }

  const plantKeys = catalog.filter((c) => c.kind === "plant").map((c) => c.key);
  const chainKeys = catalog.filter((c) => c.kind === "chain").map((c) => c.key);

  const targetByKey = new Map(me.targets.map((t) => [t.targetKey, t]));
  const revealsByKey = new Map<string, { basic: boolean; verbose: boolean }>();
  for (const r of me.reveals) {
    const cur = revealsByKey.get(r.targetKey) ?? { basic: false, verbose: false };
    if (r.tier === 1) cur.basic = true;
    if (r.tier === 2) cur.verbose = true;
    revealsByKey.set(r.targetKey, cur);
  }

  return (
    <Container className="py-8 max-w-6xl">
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            CTF
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Cohort{" "}
            <span className="font-mono text-text">{me.cohort.name}</span>
            {" · "}
            salt fp{" "}
            <span className="font-mono text-text-dim">
              {me.cohort.saltFingerprint}
            </span>
            {" · "}
            hints{" "}
            <span className="font-mono text-text">
              cohort {me.cohort.hintsDefault ? "ON" : "OFF"}
              {" / "}
              you {me.hints.userOverride}
            </span>
          </p>
        </div>
        <div className="flex gap-4 items-center font-mono text-sm">
          <div>
            <span className="text-text-mute">plants</span>{" "}
            <span className="text-text font-semibold">
              {me.score.plantFlags}
            </span>
            <span className="text-text-mute">/{me.score.plantTotal}</span>
          </div>
          <div>
            <span className="text-text-mute">chains</span>{" "}
            <span className="text-text font-semibold">
              {me.score.chainFlags}
            </span>
            <span className="text-text-mute">/{me.score.chainTotal}</span>
          </div>
        </div>
      </div>

      {/* Submit */}
      <form
        onSubmit={submitFlag}
        className="rounded-lg border border-border bg-bg-elevated p-4 mb-6 flex flex-wrap gap-2 items-end"
      >
        <div className="flex-1 min-w-[140px]">
          <label className="block text-[11px] uppercase tracking-wider text-text-mute mb-1 font-semibold">
            Target
          </label>
          <input
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder="V-4 or CHAIN-A"
            className="w-full h-10 px-3 rounded-md bg-bg border border-border text-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="flex-[3] min-w-[260px]">
          <label className="block text-[11px] uppercase tracking-wider text-text-mute mb-1 font-semibold">
            Flag
          </label>
          <input
            value={submitInput}
            onChange={(e) => setSubmitInput(e.target.value)}
            placeholder="{BLAZE_BITVULNEX_…}"
            className="w-full h-10 px-3 rounded-md bg-bg border border-border text-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || targetInput === "" || submitInput === ""}
          className="h-10 px-5 rounded-md bg-accent text-accent-fg font-semibold text-sm hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "…" : "Submit"}
        </button>
        {submitMsg && (
          <div
            role="status"
            className={cn(
              "basis-full text-xs mt-1 font-mono",
              submitMsg.startsWith("✓")
                ? "text-buy"
                : submitMsg.startsWith("✗")
                  ? "text-sell"
                  : "text-warn",
            )}
          >
            {submitMsg}
          </div>
        )}
      </form>

      {/* Plant targets grid */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-mute mb-3">
          Plant targets ({me.score.plantTotal})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {plantKeys.map((k) => (
            <TargetCard
              key={k}
              targetKey={k}
              status={targetByKey.get(k)}
              reveal={revealsByKey.get(k)}
              hintsAllowed={me.hints.effective}
              verboseUnlockSeconds={me.cohort.verboseUnlockSeconds}
            />
          ))}
        </div>
      </section>

      {/* Killer chains */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-mute mb-3">
          Killer chains ({me.score.chainTotal})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {chainKeys.map((c) => (
            <TargetCard
              key={c}
              targetKey={c}
              status={targetByKey.get(c)}
              reveal={revealsByKey.get(c)}
              hintsAllowed={me.hints.effective}
              verboseUnlockSeconds={me.cohort.verboseUnlockSeconds}
              title={CHAIN_TITLES[c]}
            />
          ))}
        </div>
      </section>

      {/* Hint policy override */}
      <section className="rounded-lg border border-border bg-bg-elevated p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-mute mb-2">
          Hint policy
        </h2>
        <p className="text-sm text-text-dim mb-3">
          Cohort default is{" "}
          <span className="font-mono">
            {me.cohort.hintsDefault ? "ON" : "OFF"}
          </span>
          . You can override below; the choice is logged.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["follow", "enable", "disable"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => changeOverride(opt)}
              className={cn(
                "px-3 h-9 rounded-md text-xs font-medium border transition-colors",
                me.hints.userOverride === opt
                  ? "bg-accent text-accent-fg border-accent"
                  : "border-border text-text-dim hover:bg-bg-hover hover:text-text",
              )}
            >
              {opt === "follow"
                ? `Follow cohort (${me.cohort.hintsDefault ? "ON" : "OFF"})`
                : opt === "enable"
                  ? "Enable for me"
                  : "Disable for me"}
            </button>
          ))}
        </div>
      </section>
    </Container>
  );
}

function TargetCard({
  targetKey,
  status,
  reveal,
  hintsAllowed,
  verboseUnlockSeconds,
  title,
}: {
  targetKey: string;
  status?: { valid: boolean; attempts: number };
  reveal?: { basic: boolean; verbose: boolean };
  hintsAllowed: boolean;
  verboseUnlockSeconds: number;
  title?: string;
}) {
  const [basicHint, setBasicHint] = useState<{
    category: string;
    text: string;
  } | null>(null);
  const [verboseHint, setVerboseHint] = useState<{
    category: string;
    text: string;
  } | null>(null);
  const [verboseMsg, setVerboseMsg] = useState<string | null>(null);

  async function loadBasic() {
    // Fire the interaction record alongside the basic hint so the
    // verbose-unlock countdown starts from the trainee's first read.
    // The endpoint is idempotent — calling it twice is a no-op.
    void authedFetch("/api/v2/ctf/interaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKey }),
    });
    const r = await authedFetch(`/api/v2/ctf/hints/${targetKey}?tier=basic`);
    if (r.ok) setBasicHint(await r.json());
  }
  async function loadVerbose() {
    setVerboseMsg(null);
    const r = await authedFetch(
      `/api/v2/ctf/hints/${targetKey}?tier=verbose`,
    );
    if (r.status === 425) {
      const body = await r.json().catch(() => null);
      const secs = body?.error?.secondsRemaining ?? verboseUnlockSeconds;
      setVerboseMsg(
        `Verbose unlocks in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}.`,
      );
      // Make sure we've recorded interaction so the timer is running.
      await authedFetch("/api/v2/ctf/interaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetKey }),
      });
      return;
    }
    if (r.ok) setVerboseHint(await r.json());
  }

  const valid = status?.valid === true;
  const attempts = status?.attempts ?? 0;

  return (
    <div
      className={cn(
        "rounded-md border bg-bg p-3 text-sm flex flex-col gap-1",
        valid
          ? "border-buy/40 bg-buy/10"
          : attempts > 0
            ? "border-warn/30"
            : "border-border",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono font-semibold text-text">{targetKey}</span>
        <span
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider",
            valid
              ? "text-buy"
              : attempts > 0
                ? "text-warn"
                : "text-text-mute",
          )}
        >
          {valid ? "✓ found" : attempts > 0 ? `${attempts}× tried` : "—"}
        </span>
      </div>
      {title && <div className="text-xs text-text-dim">{title}</div>}
      {hintsAllowed && (
        <div className="flex gap-1.5 mt-1 text-xs">
          <button
            type="button"
            onClick={loadBasic}
            className="text-text-dim hover:text-accent underline"
          >
            {reveal?.basic || basicHint ? "Basic ▾" : "Basic"}
          </button>
          <button
            type="button"
            onClick={loadVerbose}
            className="text-text-dim hover:text-accent underline"
          >
            {reveal?.verbose || verboseHint ? "Verbose ▾" : "Verbose"}
          </button>
        </div>
      )}
      {basicHint && (
        <div className="mt-1 text-[11px] text-text-dim border-l-2 border-border-subtle pl-2">
          <div className="uppercase tracking-wider text-[10px] text-text-mute mb-0.5">
            {basicHint.category}
          </div>
          {basicHint.text}
        </div>
      )}
      {verboseMsg && (
        <div className="mt-1 text-[11px] text-warn font-mono">
          {verboseMsg}
        </div>
      )}
      {verboseHint && (
        <div className="mt-1 text-[11px] text-text-dim border-l-2 border-accent/40 pl-2">
          <div className="uppercase tracking-wider text-[10px] text-text-mute mb-0.5">
            {verboseHint.category} · verbose
          </div>
          {verboseHint.text}
        </div>
      )}
    </div>
  );
}
