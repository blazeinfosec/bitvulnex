"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  category: string;
  updatedAt: string;
  user: { id: string; email: string; displayName: string | null };
};

export default function AdminTicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/admin/tickets");
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      const body = (await res.json()) as { tickets: TicketRow[] };
      setTickets(body.tickets);
    })();
  }, [router]);

  return (
    <Container className="py-12 max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Support inbox
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{tickets?.length ?? 0} tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {!tickets ? (
            <p className="text-sm text-navy-700">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-navy-700">Inbox is empty.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Subject</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>User</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-t border-navy-100">
                    <td className="py-1">{t.subject}</td>
                    <td>{t.status}</td>
                    <td>{t.category}</td>
                    <td>{t.user.email}</td>
                    <td>{new Date(t.updatedAt).toLocaleString()}</td>
                    <td className="text-right">
                      <Link
                        href={`/admin/tickets/${t.id}`}
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
