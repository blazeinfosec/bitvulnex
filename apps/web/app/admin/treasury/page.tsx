"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

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

export default function AdminTreasuryPage() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outputAddress, setOutputAddress] = useState("bcrt1qhotwallet");
  const [outputAmountSat, setOutputAmountSat] = useState("5000000");
  const [intentNote, setIntentNote] = useState("cold → hot top-up");

  async function loadDrafts() {
    const res = await authedFetch("/api/v2/admin/treasury/drafts");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? "could not load drafts");
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
    if (res.ok) loadDrafts();
  }

  async function sign(id: string) {
    const res = await authedFetch(
      `/api/v2/admin/treasury/drafts/${encodeURIComponent(id)}/sign`,
      { method: "POST" },
    );
    if (res.ok) loadDrafts();
  }

  async function broadcast(id: string) {
    const res = await authedFetch(
      `/api/v2/admin/treasury/drafts/${encodeURIComponent(id)}/broadcast`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (res.ok) loadDrafts();
  }

  return (
    <Container className="py-12 max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Treasury — multi-sig coordinator
      </h1>
      {error && <p className="text-danger">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>New cold → hot draft</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-32 text-navy-500">Output address</label>
            <input
              value={outputAddress}
              onChange={(e) => setOutputAddress(e.target.value)}
              className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-32 text-navy-500">Amount (sat)</label>
            <input
              value={outputAmountSat}
              onChange={(e) => setOutputAmountSat(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3 font-mono w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-32 text-navy-500">Intent</label>
            <input
              value={intentNote}
              onChange={(e) => setIntentNote(e.target.value)}
              className="flex-1 border border-navy-200 rounded-md h-10 px-3"
            />
          </div>
          <Button onClick={createDraft} variant="primary">
            Create draft
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drafts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {drafts.length === 0 ? (
            <p className="text-navy-700">No drafts yet.</p>
          ) : (
            drafts.map((d) => (
              <div
                key={d.id}
                className="border border-navy-200 rounded-md p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{d.id}</span>
                  <span className="uppercase text-xs tracking-wider">
                    {d.status}
                  </span>
                </div>
                <div className="text-navy-700">{d.intentNote ?? "—"}</div>
                <div className="font-mono text-xs">
                  outputs:{" "}
                  {d.intendedOutputs
                    .map(
                      (o) =>
                        `${o.address.slice(0, 16)}… (${o.amountSat} sat)`,
                    )
                    .join(", ")}
                </div>
                <div className="text-navy-500 text-xs">
                  signatures: {d.signatures?.length ?? 0}
                </div>
                {d.broadcastTxid && (
                  <div className="text-navy-700 font-mono text-xs">
                    broadcast txid: {d.broadcastTxid.slice(0, 24)}…
                  </div>
                )}
                <div className="flex gap-2">
                  {(d.status === "drafted" || d.status === "partial") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => sign(d.id)}
                    >
                      Sign
                    </Button>
                  )}
                  {d.status === "signed" && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => broadcast(d.id)}
                    >
                      Broadcast
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
