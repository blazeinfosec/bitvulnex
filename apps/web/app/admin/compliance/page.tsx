"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type CaseRow = {
  id: string;
  subjectUserId: string;
  status: string;
  createdAt: string;
  subject: { id: string; email: string; displayName: string | null };
};

export default function AdminCompliancePage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/compliance/cases");
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      const body = (await res.json()) as { cases: CaseRow[] };
      setCases(body.cases);
    })();
  }, [router]);

  return (
    <Container className="py-12 max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Compliance queue
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{cases?.length ?? 0} cases</CardTitle>
        </CardHeader>
        <CardContent>
          {!cases ? (
            <p className="text-sm text-navy-700">Loading…</p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-navy-700">No open cases.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Subject</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-t border-navy-100">
                    <td className="py-1">{c.subject.email}</td>
                    <td>{c.status}</td>
                    <td>{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="text-right">
                      <Link
                        href={`/admin/compliance/cases/${c.id}`}
                        className="text-sm text-navy-700 underline"
                      >
                        Open →
                      </Link>
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
