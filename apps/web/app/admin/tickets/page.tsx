"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, loadFailure } from "@/lib/token-storage";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  category: string;
  updatedAt: string;
  user: { id: string; email: string; displayName: string | null };
};

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

export default function AdminTicketsPage() {
  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/tickets");
      const fail = await loadFailure(res);
      if (fail) {
        if (fail.redirect) router.replace("/login");
        else setLoadError(fail.message);
        return;
      }
      setLoadError(null);
      const body = (await res.json()) as { tickets: TicketRow[] };
      setTickets(body.tickets);
    })();
  }, [router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Support inbox
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Agent view of all open user tickets.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated overflow-x-auto">
        {!tickets && loadError ? (
          <p className="px-4 py-10 text-center text-sell text-sm">
            {loadError}
          </p>
        ) : !tickets ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            Loading…
          </p>
        ) : tickets.length === 0 ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            Inbox is empty.
          </p>
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
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  User
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
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-mono">
                      {t.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-dim">
                    {t.user.email}
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
                      href={`/admin/tickets/${t.id}`}
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
    </div>
  );
}
