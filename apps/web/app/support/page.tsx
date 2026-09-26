"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { authedFetch, loadFailure } from "@/lib/token-storage";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  category: string;
  updatedAt: string;
};

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm no-underline";

function statusClass(s: string) {
  switch (s) {
    case "open":
    case "awaiting_user":
      return "text-warn";
    case "awaiting_agent":
      return "text-info";
    case "resolved":
      return "text-buy";
    case "closed":
      return "text-text-mute";
    default:
      return "text-text-dim";
  }
}

export default function SupportInbox() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me/tickets").catch(() => null);
      const fail = await loadFailure(res, "Could not load your tickets.");
      if (fail) {
        if (fail.redirect) router.replace("/login");
        else setLoadError(fail.message);
        return;
      }
      const body = (await res!.json()) as { tickets: TicketRow[] };
      setTickets(body.tickets);
    })();
  }, [router]);

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Support
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Your tickets and replies from the agent team.
          </p>
        </div>
        <Link href="/support/new" className={primaryBtn}>
          + New ticket
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
        {!tickets && loadError ? (
          <p className="px-4 py-10 text-center text-sell text-sm">
            {loadError}
          </p>
        ) : !tickets ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            Loading…
          </p>
        ) : tickets.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <h3 className="text-base font-semibold text-text">
              No tickets yet
            </h3>
            <p className="text-sm text-text-dim mt-1 mb-4">
              Open a ticket and an agent will get back to you.
            </p>
            <Link href="/support/new" className={primaryBtn}>
              + Open your first ticket
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Subject
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Updated
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover transition-colors"
                >
                  <td className="px-4 py-3 text-text">{t.subject}</td>
                  <td
                    className={`px-4 py-3 text-xs uppercase tracking-wider font-medium ${statusClass(t.status)}`}
                  >
                    {t.status}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">
                    {new Date(t.updatedAt)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}{" "}
                    UTC
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/support/tickets/${t.id}`}
                      className="text-accent text-sm hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Container>
  );
}
