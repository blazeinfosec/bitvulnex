"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authedFetch, loadFailure, responseError } from "@/lib/token-storage";

type Message = {
  id: string;
  authorId: string;
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
    user: { id: string; email: string; displayName: string | null };
  };
  messages: Message[];
};

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";
const dangerBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-sell/20 border border-sell/40 text-sell hover:bg-sell/30 transition-colors text-sm";

export default function AdminTicketDetail() {
  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function load() {
    const res = await authedFetch(`/api/v2/admin/tickets/${params.id}`);
    const fail = await loadFailure(res);
    if (fail) {
      if (fail.redirect) router.replace("/login");
      else setLoadError(fail.message);
      return;
    }
    setLoadError(null);
    setData((await res.json()) as Detail);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function send() {
    setActionError(null);
    setSending(true);
    try {
      const res = await authedFetch(`/api/v2/admin/tickets/${params.id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (!res.ok) {
        // Keep the draft so the agent doesn't lose their reply.
        setActionError(await responseError(res, "Reply failed."));
        return;
      }
      setReply("");
      await load();
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(status: string) {
    setActionError(null);
    const res = await authedFetch(`/api/v2/admin/tickets/${params.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setActionError(await responseError(res, "Status change failed."));
      return;
    }
    await load();
  }

  if (!data && loadError) return <p className="text-sell text-sm">{loadError}</p>;
  if (!data) return <p className="text-text-dim">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {data.ticket.subject}
        </h1>
        <div className="text-sm text-text-dim mt-1 flex items-center gap-3">
          <span className="font-mono">{data.ticket.user.email}</span>
          <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-mono">
            {data.ticket.category}
          </span>
          <span className="text-text">{data.ticket.status}</span>
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
                {m.isAgent ? "Agent" : "User"}
              </span>
              <span className="text-xs text-text-mute font-mono">
                {new Date(m.createdAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)}{" "}
                UTC
              </span>
            </header>
            {/* bodyHtml is the server-rendered markdown output for the
                agent renderer. Rendered verbatim to preserve the
                markdown formatting the user authored. */}
            <div
              className="prose prose-sm prose-invert max-w-none text-text"
              dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
            />
          </article>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text">Agent reply</h2>
        {actionError && <p className="text-sell text-sm">{actionError}</p>}
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={5}
          placeholder="Markdown supported."
          className="w-full rounded-md bg-bg border border-border text-text placeholder:text-text-mute p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryBtn}
            onClick={send}
            disabled={sending || !reply.trim()}
          >
            {sending ? "Sending…" : "Send reply"}
          </button>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => changeStatus("resolved")}
          >
            Mark resolved
          </button>
          <button
            type="button"
            className={dangerBtn}
            onClick={() => changeStatus("closed")}
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
