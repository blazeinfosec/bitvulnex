"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type QueueRow = {
  userId: string;
  submittedAt: string;
  legalName: string | null;
  country: string | null;
  user: { id: string; email: string; displayName: string | null };
};

export default function AdminKycQueue() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/kyc/queue");
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      const body = (await res.json()) as { queue: QueueRow[] };
      setQueue(body.queue);
    })();
  }, [router]);

  if (!queue) return <Container className="py-12">Loading…</Container>;

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        KYC review queue
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{queue.length} pending</CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-navy-700">No pending reviews.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Email</th>
                  <th>Legal name</th>
                  <th>Country</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.userId} className="border-t border-navy-200">
                    <td className="py-2 font-mono">{q.user.email}</td>
                    <td>{q.legalName ?? "—"}</td>
                    <td>{q.country ?? "—"}</td>
                    <td className="font-tabular">
                      {new Date(q.submittedAt).toLocaleString()}
                    </td>
                    <td>
                      <Link href={`/admin/kyc/${q.userId}`}>review →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
