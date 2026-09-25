"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch, responseError } from "@/lib/token-storage";

const CATEGORIES = [
  "general",
  "account",
  "deposit",
  "withdrawal",
  "trading",
  "kyc",
  "security",
] as const;

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed";

export default function NewTicketPage() {
  const router = useRouter();
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]>("general");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch("/api/v2/me/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, subject, body }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(await responseError(res, "Could not open the ticket."));
        return;
      }
      const { ticket } = (await res.json()) as { ticket: { id: string } };
      router.replace(`/support/tickets/${ticket.id}`);
    } catch {
      setError("Could not open the ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="py-10 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          New support ticket
        </h1>
        <p className="text-sm text-text-dim mt-1">
          A clear subject and reproducible details help us help you faster.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Category
          </label>
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as (typeof CATEGORIES)[number])
            }
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Details (markdown)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-md bg-bg border border-border text-text placeholder:text-text-mute p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
            placeholder="What's going on? Steps to reproduce, error messages, screenshots…"
          />
        </div>

        {error && <p className="text-sell text-sm">{error}</p>}
        <button
          type="button"
          className={primaryBtn}
          onClick={submit}
          disabled={busy || !subject || !body}
        >
          {busy ? "Sending…" : "Open ticket"}
        </button>
      </section>
    </Container>
  );
}
