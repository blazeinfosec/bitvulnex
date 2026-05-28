"use client";

import { useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Ticket = {
  ticketId: string;
  quotedPrice: string;
  quoteExpiresAt: string;
};

export default function OtcPage() {
  const [pair, setPair] = useState("BTC/USDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function getQuote() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/otc/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair, side, amount }),
    });
    if (res.ok) {
      setTicket((await res.json()) as Ticket);
    } else if (res.status === 403) {
      setMessage("OTC desk requires KYC tier 2 or higher.");
    } else {
      setMessage(`quote error: ${res.status}`);
    }
  }

  async function accept() {
    if (!ticket) return;
    const res = await authedFetch("/api/v2/me/otc/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.ticketId }),
    });
    if (res.ok) {
      setMessage("ticket filled");
      setTicket(null);
    } else {
      setMessage(`accept error: ${res.status}`);
    }
  }

  return (
    <Container className="py-10 max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        OTC desk
      </h1>
      <p className="text-sm text-navy-600 mb-6">
        Request a block-size quote priced against the desk's internal
        inventory. Quotes are valid for 30 seconds.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Request quote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            />
            <select
              className="border border-navy-200 rounded px-2 py-1"
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              placeholder="amount (base)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button onClick={getQuote}>Quote</Button>
          </div>
          {message && <p className="text-sm text-navy-700">{message}</p>}
        </CardContent>
      </Card>

      {ticket && (
        <Card>
          <CardHeader>
            <CardTitle>Ticket {ticket.ticketId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-navy-700 font-tabular">
              Price: {ticket.quotedPrice}
            </p>
            <p className="text-sm text-navy-500">
              Expires {new Date(ticket.quoteExpiresAt).toLocaleString()}
            </p>
            <Button onClick={accept}>Accept</Button>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
