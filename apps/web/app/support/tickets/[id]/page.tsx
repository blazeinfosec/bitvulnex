"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";

type Message = {
  id: string;
  isAgent: boolean;
  bodyHtml: string;
  createdAt: string;
};

type Detail = {
  ticket: {
    id: string;
    subject: string;
    status: string;
    category: string;
  };
  messages: Message[];
};

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed";

function statusClass(s: string) {
  switch (s) {
    case "open":
      return "text-warn";
    case "resolved":
      return "text-buy";
    case "closed":
      return "text-text-mute";
    default:
      return "text-text-dim";
  }
}

export default function UserTicketDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");

  async function load() {
    const res = await authedFetch(`/api/v2/me/tickets/${params.id}`);
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    setData((await res.json()) as Detail);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function send() {
    await authedFetch(`/api/v2/me/tickets/${params.id}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    setReply("");
    await load();
  }

  if (!data) {
    return (
      <Container className="py-10">
        <p className="text-text-dim">Loading…</p>
      </Container>
    );
  }

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {data.ticket.subject}
        </h1>
        <div className="text-sm text-text-dim mt-1 flex items-center gap-3">
          <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-mono">
            {data.ticket.category}
          </span>
          <span
            className={`text-xs uppercase tracking-wider font-medium ${statusClass(data.ticket.status)}`}
          >
            {data.ticket.status}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {data.messages.map((m) => (
          <article
            key={m.id}
            className={
              m.isAgent
                ? "rounded-lg border border-accent/30 bg-bg-elevated p-4"
                : "rounded-lg border border-border bg-bg-elevated p-4"
            }
          >
            <header className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
              <span
                className={
                  m.isAgent
                    ? "text-xs uppercase tracking-wider text-accent font-semibold"
                    : "text-xs uppercase tracking-wider text-text-dim font-semibold"
                }
              >
                {m.isAgent ? "Agent" : "You"}
              </span>
              <span className="text-xs text-text-mute font-mono">
                {new Date(m.createdAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)}{" "}
                UTC
              </span>
            </header>
            {/* User-side rendered as plain text — the server returns
                a sanitized HTML string but we render it through React's
                default text escaping for the simpler ticket UI. */}
            <p className="text-sm text-text whitespace-pre-wrap">
              {m.bodyHtml}
            </p>
          </article>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text">Reply</h2>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          placeholder="Type your reply…"
          className="w-full rounded-md bg-bg border border-border text-text placeholder:text-text-mute p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
        />
        <button
          type="button"
          className={primaryBtn}
          onClick={send}
          disabled={!reply}
        >
          Send reply
        </button>
      </section>
    </Container>
  );
}
