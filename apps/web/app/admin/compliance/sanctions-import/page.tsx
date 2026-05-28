"use client";

import { useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Entry = { name: string; source?: string; notes?: string };

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
        setError(
          "error" in body ? body.error.message : `HTTP ${res.status}`,
        );
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
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Sanctions list import (beta)
      </h1>
      <p className="text-sm text-navy-700">
        Paste an OFAC SDN XML export below. Parsed entries are previewed
        so you can review before pushing to the sanctions table.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Source XML</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <textarea
              className="w-full h-48 font-mono text-xs border border-navy-200 rounded p-2"
              value={xml}
              onChange={(e) => setXml(e.target.value)}
              placeholder={`<sanctions>\n  <entry>\n    <name>Synthetic Subject</name>\n    <source>OFAC SDN</source>\n  </entry>\n</sanctions>`}
            />
            <Button type="submit" disabled={busy || !xml}>
              {busy ? "Parsing…" : "Preview entries"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error ? (
        <Card>
          <CardContent className="text-sm text-red-700">{error}</CardContent>
        </Card>
      ) : null}
      {entries ? (
        <Card>
          <CardHeader>
            <CardTitle>{entries.length} entries</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-navy-700">No entries parsed.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {entries.map((e, i) => (
                  <li key={i} className="border-t border-navy-100 py-1">
                    <span className="font-medium">{e.name}</span>
                    {e.source ? (
                      <span className="text-navy-500"> · {e.source}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </Container>
  );
}
