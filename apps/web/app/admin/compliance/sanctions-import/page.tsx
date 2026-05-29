"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/token-storage";

type Entry = { name: string; source?: string; notes?: string };

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed";

export default function SanctionsImportPage() {
  const [xml, setXml] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setEntries(null);
    try {
      const res = await authedFetch(
        "/api/v2/admin/compliance/sanctions-import",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ xml }),
        },
      );
      const body = (await res.json()) as
        | { entries: Entry[] }
        | { error: { message: string } };
      if (!res.ok) {
        setError("error" in body ? body.error.message : `HTTP ${res.status}`);
      } else if ("entries" in body) {
        setEntries(body.entries);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Sanctions list import
          <span className="ml-2 inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-warn/20 text-warn font-semibold align-middle">
            Beta
          </span>
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Paste an OFAC SDN XML export. Parsed entries are previewed so you can
          review before pushing.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3"
      >
        <label className="block text-xs uppercase tracking-wider text-text-mute font-medium">
          Source XML
        </label>
        <textarea
          className="w-full h-64 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono text-xs p-3 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          placeholder={`<sanctions>\n  <entry>\n    <name>Synthetic Subject</name>\n    <source>OFAC SDN</source>\n  </entry>\n</sanctions>`}
        />
        <button type="submit" className={primaryBtn} disabled={busy || !xml}>
          {busy ? "Parsing…" : "Preview entries"}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {entries && (
        <div className="rounded-lg border border-border bg-bg-elevated p-5">
          <h2 className="text-sm font-semibold text-text mb-3">
            {entries.length} entries
          </h2>
          {entries.length === 0 ? (
            <p className="text-sm text-text-mute">No entries parsed.</p>
          ) : (
            <ul className="text-sm divide-y divide-border-subtle">
              {entries.map((e, i) => (
                <li key={i} className="py-2 flex items-center justify-between">
                  <span className="text-text font-medium">{e.name}</span>
                  {e.source && (
                    <span className="text-text-mute text-xs font-mono">
                      {e.source}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
