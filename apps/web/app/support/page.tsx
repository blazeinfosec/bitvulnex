"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  category: string;
  updatedAt: string;
};

export default function SupportInbox() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me/tickets");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const body = (await res.json()) as { tickets: TicketRow[] };
      setTickets(body.tickets);
    })();
  }, [router]);

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-navy-900">
          Support
        </h1>
        <Button size="sm" asChild>
          <Link href="/support/new">New ticket</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{tickets?.length ?? 0} tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {!tickets ? (
            <p className="text-sm text-navy-700">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-navy-700">No tickets yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Subject</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-t border-navy-100">
                    <td className="py-1">{t.subject}</td>
                    <td>{t.status}</td>
                    <td>{new Date(t.updatedAt).toLocaleString()}</td>
                    <td className="text-right">
                      <Link
                        href={`/support/tickets/${t.id}`}
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
