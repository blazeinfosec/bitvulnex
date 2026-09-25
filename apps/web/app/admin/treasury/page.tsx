"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, responseError } from "@/lib/token-storage";

type DraftRow = {
  id: string;
  authorUserId: string;
  intentNote: string | null;
  intendedOutputs: Array<{ address: string; amountSat: number }>;
  status: string;
  psbtBase64: string;
  broadcastTxid: string | null;
  signatures: Array<{ id: string; signerUserId: string; signedAt: string }>;
};

const inputClass =
  "h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

function statusClass(s: string) {
  switch (s) {
    case "drafted":
    case "partial":
      return "text-warn";
    case "signed":
      return "text-info";
    case "broadcast":
    case "confirmed":
      return "text-buy";
    case "rejected":
      return "text-sell";
    default:
      return "text-text-dim";
  }
}

export default function AdminTreasuryPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outputAddress, setOutputAddress] = useState("bcrt1qhotwallet");
  const [outputAmountSat, setOutputAmountSat] = useState("5000000");
  const [intentNote, setIntentNote] = useState("cold → hot top-up");
  const [overridePsbt, setOverridePsbt] = useState<Record<string, string>>({});

  async function loadDrafts() {
    const res = await authedFetch("/api/v2/admin/treasury/drafts");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (res.status === 403) {
      setError("You don't have access to this page.");
      return;
    }
    if (!res.ok) {
      setError(await responseError(res, "could not load drafts"));
      return;
    }
    const body = (await res.json()) as { drafts: DraftRow[] };
    setDrafts(body.drafts);
    setError(null);
  }

  useEffect(() => {
    loadDrafts();
  }, []);

  async function createDraft() {
    const res = await authedFetch("/api/v2/admin/treasury/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intendedOutputs: [
          {
            address: outputAddress,
            amountSat: Number(outputAmountSat),
          },
        ],
        intentNote,
      }),
    });
    if (!res.ok) {
      setError(await responseError(res, "could not create draft"));
      return;
    }
    await loadDrafts();
  }

  async function sign(id: string) {
    const res = await authedFetch(
      `/api/v2/admin/treasury/drafts/${encodeURIComponent(id)}/sign`,
      { method: "POST" },
    );
    if (!res.ok) {
      setError(await responseError(res, "sign failed"));
      return;
    }
    await loadDrafts();
  }

  async function broadcast(id: string) {
    // Operators can optionally pass an overridePsbt for edge cases
    // where the stored draft can't be re-derived. The broadcast
    // endpoint validates outputs against the canonical intendedOutputs.
    const body: Record<string, string> = {};
    if (overridePsbt[id]) body.overridePsbt = overridePsbt[id];
    const res = await authedFetch(
      `/api/v2/admin/treasury/drafts/${encodeURIComponent(id)}/broadcast`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      setError(await responseError(res, "broadcast failed"));
      return;
    }
    await loadDrafts();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Treasury · multi-sig coordinator
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Create drafts, collect signatures, broadcast to the network.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text">
          New cold → hot draft
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Output address
            </label>
            <input
              value={outputAddress}
              onChange={(e) => setOutputAddress(e.target.value)}
              className={inputClass + " w-full"}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Amount (sat)
            </label>
            <input
              value={outputAmountSat}
              onChange={(e) => setOutputAmountSat(e.target.value)}
              className={inputClass + " w-full"}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Intent note
            </label>
            <input
              value={intentNote}
              onChange={(e) => setIntentNote(e.target.value)}
              className={inputClass + " w-full font-sans"}
            />
          </div>
        </div>
        <button type="button" className={primaryBtn} onClick={createDraft}>
          Create draft
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium">
          Drafts ({drafts.length})
        </h2>
        {drafts.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-elevated p-10 text-center text-text-mute text-sm">
            No drafts yet.
          </div>
        ) : (
          drafts.map((d) => (
            <article
              key={d.id}
              className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3"
            >
              <header className="flex items-center justify-between">
                <code className="font-mono text-xs text-text-dim">{d.id}</code>
                <span
                  className={`text-xs uppercase tracking-wider font-semibold ${statusClass(d.status)}`}
                >
                  {d.status}
                </span>
              </header>

              <p className="text-sm text-text">{d.intentNote ?? "—"}</p>

              <div className="text-xs font-mono text-text-dim space-y-1">
                <div className="text-text-mute uppercase tracking-wider">
                  Outputs
                </div>
                {d.intendedOutputs.map((o, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span>{o.address.slice(0, 24)}…</span>
                    <span className="tabular-nums">{o.amountSat} sat</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs text-text-mute pt-2 border-t border-border-subtle">
                <span>
                  Signatures:{" "}
                  <span className="text-text font-mono">
                    {d.signatures?.length ?? 0}
                  </span>
                </span>
                {d.broadcastTxid && (
                  <span className="font-mono">
                    txid {d.broadcastTxid.slice(0, 16)}…
                  </span>
                )}
              </div>

              {d.status === "signed" && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-dim hover:text-text uppercase tracking-wider font-medium">
                    Advanced: override PSBT
                  </summary>
                  <textarea
                    placeholder="Paste BVBE_PSBT_V1:… payload to override the stored PSBT before broadcast"
                    value={overridePsbt[d.id] ?? ""}
                    onChange={(e) =>
                      setOverridePsbt((curr) => ({
                        ...curr,
                        [d.id]: e.target.value,
                      }))
                    }
                    className="w-full mt-2 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono text-xs p-2 h-20 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
                  />
                </details>
              )}

              <div className="flex gap-2">
                {(d.status === "drafted" || d.status === "partial") && (
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={() => sign(d.id)}
                  >
                    Sign
                  </button>
                )}
                {d.status === "signed" && (
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => broadcast(d.id)}
                  >
                    Broadcast
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
