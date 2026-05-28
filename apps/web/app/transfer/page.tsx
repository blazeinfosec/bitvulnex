"use client";

import { useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

export default function TransferPage() {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setMessage(null);
    const body: Record<string, unknown> = {
      recipientEmail,
      asset,
      amount,
    };
    if (memo) body.memo = memo;
    const res = await authedFetch("/api/v2/me/internal-transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const respBody = (await res.json()) as
      | { transferId: string }
      | { error: { message: string } };
    if (!res.ok) {
      setError("error" in respBody ? respBody.error.message : "transfer failed");
    } else {
      setMessage("transfer complete");
      setAmount("");
      setRecipientEmail("");
      setMemo("");
    }
  }

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Internal transfer
      </h1>

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" asChild>
          <a href="/withdraw">External</a>
        </Button>
        <Button variant="primary" size="sm" asChild>
          <a href="/transfer">Internal transfer</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send to another BVBE user</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-navy-700">
            Fee-free, instant move within BVBE. Both parties must already
            have a BVBE account.
          </p>
          <div className="flex items-center gap-2">
            <label className="w-28 text-navy-500">Recipient</label>
            <input
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="user@example.com"
              className="flex-1 border border-navy-200 rounded-md h-10 px-3"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-navy-500">Asset</label>
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="border border-navy-200 rounded-md h-10 px-3 font-mono"
            >
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="LTC">LTC</option>
              <option value="USDT">USDT</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-navy-500">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.10000000"
              className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-navy-500">Memo</label>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="optional note"
              className="flex-1 border border-navy-200 rounded-md h-10 px-3"
            />
          </div>
          <Button onClick={submit} variant="primary">
            Send
          </Button>
          {error && <p className="text-danger">{error}</p>}
          {message && <p className="text-navy-700">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
