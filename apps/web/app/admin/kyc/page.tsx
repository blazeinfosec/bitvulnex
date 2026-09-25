"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authedFetch, loadFailure } from "@/lib/token-storage";

type QueueRow = {
  userId: string;
  submittedAt: string;
  legalName: string | null;
  country: string | null;
  user: { id: string; email: string; displayName: string | null };
};

export default function AdminKycQueue() {
  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/kyc/queue");
      const fail = await loadFailure(res);
      if (fail) {
        if (fail.redirect) router.replace("/login");
        else setLoadError(fail.message);
        return;
      }
      setLoadError(null);
      const body = (await res.json()) as { queue: QueueRow[] };
      setQueue(body.queue);
    })();
  }, [router]);

  if (!queue && loadError) return <p className="text-sell text-sm">{loadError}</p>;
  if (!queue) return <p className="text-text-dim">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          KYC review queue
        </h1>
        <p className="text-sm text-text-dim mt-1">
          {queue.length} submission{queue.length === 1 ? "" : "s"} pending
          review.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated overflow-x-auto">
        {queue.length === 0 ? (
          <p className="px-4 py-10 text-center text-text-mute text-sm">
            No pending reviews.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Legal name
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Country
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Submitted
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr
                  key={q.userId}
                  className="border-b border-border-subtle last:border-0 hover:bg-bg-hover transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-text">
                    {q.user.email}
                  </td>
                  <td className="px-4 py-3 text-text">
                    {q.legalName ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-dim">
                    {q.country ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">
                    {new Date(q.submittedAt)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 19)}{" "}
                    UTC
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/kyc/${q.userId}`}
                      className="text-accent text-sm hover:underline"
                    >
                      Review →
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
