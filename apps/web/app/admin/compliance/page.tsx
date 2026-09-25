"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, loadFailure } from "@/lib/token-storage";

type CaseRow = {
  id: string;
  subjectUserId: string;
  status: string;
  createdAt: string;
  subject: { id: string; email: string; displayName: string | null };
};

function statusClass(s: string) {
  switch (s) {
    case "open":
      return "text-warn";
    case "in_review":
      return "text-info";
    case "escalated":
      return "text-sell";
    case "resolved":
      return "text-buy";
    case "dismissed":
      return "text-text-mute";
    default:
      return "text-text-dim";
  }
}

export default function AdminCompliancePage() {
  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/compliance/cases");
      const fail = await loadFailure(res);
      if (fail) {
        if (fail.redirect) router.replace("/login");
        else setLoadError(fail.message);
        return;
      }
      setLoadError(null);
      const body = (await res.json()) as { cases: CaseRow[] };
      setCases(body.cases);
    })();
  }, [router]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Compliance queue
          </h1>
          <p className="text-sm text-text-dim mt-1">
            Open investigations, sanctions screening, regulatory reporting.
          </p>
        </div>
        <Link
          href="/admin/compliance/sanctions-import"
          className="inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm"
        >
          Import sanctions list
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated overflow-x-auto">
        {!cases && loadError ? (
          <p className="px-4 py-10 text-center text-sell text-sm">
            {loadError}
          </p>
        ) : !cases ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            Loading…
          </p>
        ) : cases.length === 0 ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            No open cases.
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
                  Opened
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-text">
                    {c.subject.email}
                  </td>
                  <td
                    className={`px-4 py-3 text-xs uppercase tracking-wider font-medium ${statusClass(c.status)}`}
                  >
                    {c.status}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">
                    {new Date(c.createdAt)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}{" "}
                    UTC
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/compliance/cases/${c.id}`}
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
