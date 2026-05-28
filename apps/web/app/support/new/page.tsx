"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";

const CATEGORIES = [
  "general",
  "account",
  "deposit",
  "withdrawal",
  "trading",
  "kyc",
  "security",
] as const;

export default function NewTicketPage() {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("general");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await authedFetch("/api/v2/me/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, subject, body }),
    });
    setBusy(false);
    if (res.ok) {
      const { ticket } = (await res.json()) as { ticket: { id: string } };
      router.replace(`/support/tickets/${ticket.id}`);
    }
  }

  return (
    <Container className="py-12 max-w-2xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        New support ticket
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Tell us what's going on</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs uppercase text-navy-500">Category</span>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as (typeof CATEGORIES)[number])
              }
              className="w-full border border-navy-200 rounded px-2 py-1"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase text-navy-500">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-navy-200 rounded px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase text-navy-500">
              Details (markdown)
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full border border-navy-200 rounded p-2"
            />
          </label>
          <Button size="sm" onClick={submit} disabled={busy || !subject || !body}>
            {busy ? "Sending…" : "Open ticket"}
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}
