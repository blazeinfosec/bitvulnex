"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/token-storage";
import { cn } from "@/lib/utils";

type Cohort = {
  id: string;
  name: string;
  saltFingerprint: string;
  hintsDefault: boolean;
  verboseUnlockSeconds: number;
  startedAt: string;
  archivedAt: string | null;
  _count: { members: number; submissions: number; hintReveals: number };
};

type ScoreboardRow = {
  userId: string;
  email: string;
  displayName: string | null;
  hintsOverride: string;
  plantFlags: number;
  chainFlags: number;
  score: number;
  basicReveals: number;
  verboseReveals: number;
};

type HeatRow = {
  targetKey: string;
  kind: "plant" | "chain";
  pattern: string;
  category: string;
  difficulty: string;
  basicReveals: number;
  verboseReveals: number;
};

export default function AdminCtfPage() {
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scoreboard, setScoreboard] = useState<{
    rows: ScoreboardRow[];
    heatMap: HeatRow[];
  } | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const r = await authedFetch("/api/v2/admin/ctf/cohorts");
    if (r.status === 404) {
      setErr(
        "CTF mode is disabled on this deployment. Set CTF_MODE=true to enable.",
      );
      return;
    }
    if (r.status === 403) {
      setErr("Admin role required.");
      return;
    }
    if (!r.ok) {
      setErr(`Unexpected error (${r.status}).`);
      return;
    }
    const body = (await r.json()) as { cohorts: Cohort[] };
    setCohorts(body.cohorts);
    if (!selectedId && body.cohorts[0]) setSelectedId(body.cohorts[0].id);
  }, [selectedId]);

  const loadScoreboard = useCallback(async (id: string) => {
    const r = await authedFetch(
      `/api/v2/admin/ctf/cohorts/${id}/scoreboard`,
    );
    if (r.ok) setScoreboard(await r.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (selectedId) void loadScoreboard(selectedId);
  }, [selectedId, loadScoreboard]);

  async function createCohort() {
    const name = prompt("Cohort name (e.g. spring-2026-b)");
    if (!name) return;
    await authedFetch("/api/v2/admin/ctf/cohorts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refresh();
  }
  async function patchCohort(id: string, body: Record<string, unknown>) {
    await authedFetch(`/api/v2/admin/ctf/cohorts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
    if (id === selectedId) await loadScoreboard(id);
  }
  async function resetCohort(id: string) {
    if (!confirm("Drop all submissions, interactions, and reveals?")) return;
    await authedFetch(`/api/v2/admin/ctf/cohorts/${id}/reset`, {
      method: "POST",
    });
    await refresh();
    if (id === selectedId) await loadScoreboard(id);
  }
  async function reloadHints() {
    const r = await authedFetch("/api/v2/admin/ctf/reload-hints", {
      method: "POST",
    });
    if (r.ok) {
      const body = (await r.json()) as { loaded: number };
      alert(`Hint cache reloaded — ${body.loaded} records.`);
    }
  }
  async function revealFlag(
    id: string,
    userId: string,
    targetKey: string,
  ) {
    const reason = prompt("Reason for the override (audit-logged):");
    if (!reason) return;
    await authedFetch(`/api/v2/admin/ctf/cohorts/${id}/reveal-flag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, targetKey, reason }),
    });
    if (id === selectedId) await loadScoreboard(id);
  }

  if (err)
    return (
      <div className="py-10">
        <h1 className="text-2xl font-semibold text-text mb-2">CTF Admin</h1>
        <p className="text-sm text-text-dim">{err}</p>
      </div>
    );
  if (!cohorts) return <div className="py-10 text-text-mute">Loading…</div>;

  const selected = cohorts.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="py-6">
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            CTF Admin
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Manage cohorts, hint policy, scoreboards, and instructor overrides.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reloadHints}
            className="h-9 px-3 text-sm border border-border rounded-md text-text-dim hover:text-text hover:bg-bg-hover"
          >
            Reload hint cache
          </button>
          <button
            type="button"
            onClick={createCohort}
            className="h-9 px-4 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover"
          >
            + New cohort
          </button>
        </div>
      </div>

      {/* Cohort list */}
      <div className="rounded-lg border border-border bg-bg-elevated mb-6">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-text-mute border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Salt fp</th>
              <th className="text-right px-4 py-2 font-semibold">Members</th>
              <th className="text-right px-4 py-2 font-semibold">Subs</th>
              <th className="text-right px-4 py-2 font-semibold">Reveals</th>
              <th className="text-center px-4 py-2 font-semibold">Hints</th>
              <th className="text-right px-4 py-2 font-semibold">Verbose s</th>
              <th className="text-center px-4 py-2 font-semibold">Status</th>
              <th className="text-right px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "border-b border-border-subtle cursor-pointer",
                  selectedId === c.id ? "bg-bg-hover" : "hover:bg-bg-hover/50",
                )}
              >
                <td className="px-4 py-2 text-text font-medium">{c.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-text-mute">
                  {c.saltFingerprint}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {c._count.members}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {c._count.submissions}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {c._count.hintReveals}
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void patchCohort(c.id, { hintsDefault: !c.hintsDefault });
                    }}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-mono border",
                      c.hintsDefault
                        ? "border-buy/40 bg-buy/10 text-buy"
                        : "border-border text-text-dim",
                    )}
                  >
                    {c.hintsDefault ? "ON" : "OFF"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={c.verboseUnlockSeconds}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v) && v !== c.verboseUnlockSeconds) {
                        void patchCohort(c.id, { verboseUnlockSeconds: v });
                      }
                    }}
                    className="w-16 h-7 text-right px-1 bg-bg border border-border rounded font-mono text-xs"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  {c.archivedAt ? (
                    <span className="text-[10px] text-text-mute uppercase tracking-wider">
                      archived
                    </span>
                  ) : (
                    <span className="text-[10px] text-buy uppercase tracking-wider">
                      active
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void patchCohort(c.id, { archived: !c.archivedAt });
                    }}
                    className="text-text-dim hover:text-accent mr-3"
                  >
                    {c.archivedAt ? "Restore" : "Archive"}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void resetCohort(c.id);
                    }}
                    className="text-sell hover:text-sell/70"
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Selected cohort detail */}
      {selected && scoreboard && (
        <>
          <div className="flex items-end justify-between gap-4 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-mute">
              Scoreboard — {selected.name}
            </h2>
            <a
              href={`/api/v2/admin/ctf/cohorts/${selected.id}/scoreboard?format=csv`}
              className="text-xs text-text-dim hover:text-accent underline"
            >
              CSV export ↓
            </a>
          </div>
          <div className="rounded-lg border border-border bg-bg-elevated mb-6">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-text-mute border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">Trainee</th>
                  <th className="text-center px-4 py-2">Hints</th>
                  <th className="text-right px-4 py-2">Plants</th>
                  <th className="text-right px-4 py-2">Chains</th>
                  <th className="text-right px-4 py-2">Score</th>
                  <th className="text-right px-4 py-2">Basic / Verbose</th>
                  <th className="text-right px-4 py-2">Reveal</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-border-subtle">
                    <td className="px-4 py-2">
                      <div className="text-text">{r.displayName ?? "—"}</div>
                      <div className="text-[11px] text-text-mute font-mono">
                        {r.email}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center text-xs font-mono">
                      {r.hintsOverride}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {r.plantFlags}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {r.chainFlags}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      {r.score}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-dim">
                      {r.basicReveals} / {r.verboseReveals}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          const t = prompt("Target key to reveal (V-NNN or CHAIN-X):");
                          if (t) void revealFlag(selected.id, r.userId, t);
                        }}
                        className="text-xs text-text-dim hover:text-accent underline"
                      >
                        Unlock ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-mute mb-3">
            Per-target heat map
          </h2>
          <div className="rounded-lg border border-border bg-bg-elevated mb-6">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-text-mute border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2">Target</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-center px-4 py-2">Difficulty</th>
                  <th className="text-right px-4 py-2">Basic reveals</th>
                  <th className="text-right px-4 py-2">Verbose reveals</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.heatMap.map((h) => (
                  <tr key={h.targetKey} className="border-b border-border-subtle">
                    <td className="px-4 py-2 font-mono text-text">{h.targetKey}</td>
                    <td className="px-4 py-2 text-text-dim text-xs">{h.category}</td>
                    <td className="px-4 py-2 text-center text-[10px] uppercase tracking-wider text-text-mute">
                      {h.difficulty}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right font-mono",
                        h.basicReveals === 0
                          ? "text-text-mute"
                          : h.basicReveals > 5
                            ? "text-warn"
                            : "text-text",
                      )}
                    >
                      {h.basicReveals}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right font-mono",
                        h.verboseReveals === 0
                          ? "text-text-mute"
                          : h.verboseReveals > 3
                            ? "text-warn"
                            : "text-text",
                      )}
                    >
                      {h.verboseReveals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
