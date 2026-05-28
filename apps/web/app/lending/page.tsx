"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Pool = {
  asset: string;
  supplied: string;
  borrowed: string;
  utilization: string;
  effectiveApyBps: number;
};

type Position = {
  id: string;
  pool: string;
  side: "supply" | "borrow";
  principal: string;
  accrued: string;
};

export default function LendingPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v2/public/lending/pools");
    if (res.ok) {
      const b = (await res.json()) as { pools: Pool[] };
      setPools(b.pools);
    }
    const p = await authedFetch("/api/v2/me/lending/positions");
    if (p.ok) {
      const b = (await p.json()) as { positions: Position[] };
      setPositions(b.positions);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function supply() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/lending/supply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset, amount }),
    });
    setMessage(res.ok ? "supplied" : `error: ${res.status}`);
    if (res.ok) await load();
  }

  async function withdrawPosition(id: string) {
    const res = await authedFetch("/api/v2/me/lending/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId: id }),
    });
    if (res.ok) await load();
  }

  return (
    <Container className="py-10 max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Lending
      </h1>
      <p className="text-sm text-navy-600 mb-6">
        Supply assets to a pool to earn variable APY. Interest accrues every 60
        seconds against borrowed liquidity.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Pools</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="text-left py-2">Asset</th>
                <th className="text-right">Supplied</th>
                <th className="text-right">Borrowed</th>
                <th className="text-right">Utilization</th>
                <th className="text-right">APY</th>
              </tr>
            </thead>
            <tbody className="font-tabular">
              {pools.map((p) => (
                <tr key={p.asset} className="border-t border-navy-100">
                  <td className="py-2">{p.asset}</td>
                  <td className="text-right">{p.supplied}</td>
                  <td className="text-right">{p.borrowed}</td>
                  <td className="text-right">
                    {(Number(p.utilization) * 100).toFixed(2)}%
                  </td>
                  <td className="text-right">
                    {(p.effectiveApyBps / 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Supply</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select
              className="border border-navy-200 rounded px-2 py-1"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            >
              {pools.map((p) => (
                <option key={p.asset}>{p.asset}</option>
              ))}
            </select>
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              placeholder="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button onClick={supply}>Supply</Button>
          </div>
          {message && <p className="text-sm text-navy-700">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-navy-600">No open positions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="text-left py-2">Pool</th>
                  <th>Side</th>
                  <th className="text-right">Principal</th>
                  <th className="text-right">Accrued</th>
                  <th />
                </tr>
              </thead>
              <tbody className="font-tabular">
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-navy-100">
                    <td className="py-2">{p.pool}</td>
                    <td className="text-center">{p.side}</td>
                    <td className="text-right">{p.principal}</td>
                    <td className="text-right">{p.accrued}</td>
                    <td className="text-right">
                      {p.side === "supply" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => withdrawPosition(p.id)}
                        >
                          Withdraw
                        </Button>
                      ) : null}
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
