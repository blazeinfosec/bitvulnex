"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type WithdrawalRow = {
  id: string;
  asset: string;
  amount: string;
  fee: string;
  destAddress: string;
  status: string;
  txid: string | null;
  requestedAt: string;
};

type BalanceRow = { asset: string; amount: string };

export default function WithdrawPage() {
  const router = useRouter();
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    const [wRes, bRes] = await Promise.all([
      authedFetch("/api/v2/me/withdrawals"),
      authedFetch("/api/v2/me/balance"),
    ]);
    if (wRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (wRes.ok) {
      const body = (await wRes.json()) as { withdrawals: WithdrawalRow[] };
      setWithdrawals(body.withdrawals);
    }
    if (bRes.ok) {
      const body = (await bRes.json()) as { balances: BalanceRow[] };
      setBalances(body.balances);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setError(null);
    setMessage(null);
    const res = await authedFetch("/api/v2/me/withdrawals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset, amount, destAddress }),
    });
    const body = (await res.json()) as
      | { withdrawalId: string }
      | { error: { message: string } };
    if (!res.ok) {
      setError(
        "error" in body ? body.error.message : "withdrawal failed",
      );
    } else {
      setMessage("withdrawal submitted");
      setAmount("");
      setDestAddress("");
      loadAll();
    }
  }

  async function cancel(id: string) {
    const res = await authedFetch(
      `/api/v2/me/withdrawals/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
    if (res.ok) {
      setMessage("withdrawal cancelled");
      loadAll();
    } else {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message: string };
      };
      setError(body.error?.message ?? "cancel failed");
    }
  }

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Withdraw
      </h1>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" asChild>
          <a href="/withdraw">External</a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="/transfer">Internal transfer</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit a withdrawal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-24 text-navy-500">Asset</label>
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
            <label className="w-24 text-navy-500">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.10000000"
              className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-24 text-navy-500">Destination</label>
            <input
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
              placeholder="bcrt1q…"
              className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono text-xs"
            />
          </div>
          <Button onClick={submit} variant="primary">
            Submit withdrawal
          </Button>
          {error && <p className="text-danger">{error}</p>}
          {message && <p className="text-navy-700">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {balances.length === 0 ? (
            <p className="text-navy-700">No balances yet.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Asset</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.asset} className="border-t border-navy-200">
                    <td className="py-2">{b.asset}</td>
                    <td className="font-tabular">{b.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent withdrawals</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {withdrawals.length === 0 ? (
            <p className="text-navy-700">No withdrawals yet.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">When</th>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id} className="border-t border-navy-200">
                    <td className="py-2 font-tabular">
                      {new Date(w.requestedAt).toLocaleString()}
                    </td>
                    <td>{w.asset}</td>
                    <td className="font-tabular">{w.amount}</td>
                    <td className="font-mono text-xs">
                      {w.destAddress.slice(0, 16)}…
                    </td>
                    <td>{w.status}</td>
                    <td>
                      {(w.status === "pending" || w.status === "approved") && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => cancel(w.id)}
                        >
                          Cancel
                        </Button>
                      )}
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
