"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  if (!data) return <Container className="py-12">Loading…</Container>;

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        {data.ticket.subject}
      </h1>
      <div className="text-sm text-navy-700">
        {data.ticket.category} · {data.ticket.status}
      </div>
      <div className="space-y-3">
        {data.messages.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle className="text-sm">
                {m.isAgent ? "Agent" : "You"} ·{" "}
                {new Date(m.createdAt).toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{m.bodyHtml}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Reply</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            className="w-full border border-navy-200 rounded p-2 text-sm"
          />
          <Button size="sm" onClick={send} disabled={!reply}>
            Send
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}
