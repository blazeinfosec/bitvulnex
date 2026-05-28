"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Program = {
  id: string;
  asset: string;
  rewardAsset: string;
  apyBps: number;
  windowSeconds: number;
};

export default function StakingPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [asset, setAsset] = useState("ETH");
  const [amount, setAmount] = useState("");
  const [positionId, setPositionId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v2/public/staking/programs");
      if (res.ok) {
        const b = (await res.json()) as { programs: Program[] };
        setPrograms(b.programs);
      }
    })();
  }, []);

  async function stake() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/staking/stake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset, amount }),
    });
    if (res.ok) {
      const b = (await res.json()) as { positionId: string };
      setPositionId(b.positionId);
      setMessage(`staked, position ${b.positionId}`);
    } else {
      setMessage(`error: ${res.status}`);
    }
  }

  async function claim() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/staking/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId }),
    });
    if (res.ok) {
      const b = (await res.json()) as { credited: string; rows: number };
      setMessage(`credited ${b.credited} (${b.rows} window(s))`);
    } else {
      setMessage(`error: ${res.status}`);
    }
  }

  return (
    <Container className="py-10 max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Staking
      </h1>
      <p className="text-sm text-navy-600 mb-6">
        Earn fixed APY by staking PoS-style assets. Rewards materialize every
        program window.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Programs</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="text-left py-2">Asset</th>
                <th>Reward</th>
                <th className="text-right">APY</th>
                <th className="text-right">Window</th>
              </tr>
            </thead>
            <tbody className="font-tabular">
              {programs.map((p) => (
                <tr key={p.asset} className="border-t border-navy-100">
                  <td className="py-2">{p.asset}</td>
                  <td className="text-center">{p.rewardAsset}</td>
                  <td className="text-right">{(p.apyBps / 100).toFixed(2)}%</td>
                  <td className="text-right">{p.windowSeconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Stake</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select
              className="border border-navy-200 rounded px-2 py-1"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            >
              {programs.map((p) => (
                <option key={p.asset}>{p.asset}</option>
              ))}
            </select>
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              placeholder="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button onClick={stake}>Stake</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claim rewards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular flex-1"
              placeholder="position id"
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
            />
            <Button onClick={claim} variant="secondary">
              Claim
            </Button>
          </div>
          {message && <p className="text-sm text-navy-700">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
