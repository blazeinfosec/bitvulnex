"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Position = {
  id: number;
  pair: string;
  side: "long" | "short";
  size: string;
  entryPrice: string;
  leverage: number;
  collateral: string;
  liquidationPrice: string;
  status: string;
  realizedPnl: string | null;
};

export default function MarginPage() {
  const router = useRouter();
  const [positions, setPositions] = useState<Position[]>([]);
  const [pair, setPair] = useState("BTC/USDT");
  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(2);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch("/api/v2/me/margin/positions");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (res.ok) {
      const b = (await res.json()) as { positions: Position[] };
      setPositions(b.positions);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await authedFetch("/api/v2/me/margin/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair, side, size, leverage }),
    });
    if (res.ok) {
      setMessage("position opened");
      setSize("");
      load();
    } else {
      const b = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setMessage(b.error?.message ?? "open failed");
    }
  }

  async function close(id: number) {
    await authedFetch(`/api/v2/me/margin/positions/${id}`, { method: "DELETE" });
    load();
  }

  const open_positions = positions.filter((p) => p.status === "open");
  const history = positions.filter((p) => p.status !== "open");

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-text mb-2">
        Margin trading
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Open position</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={open} className="grid sm:grid-cols-2 gap-3 text-sm">
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              className="border border-border rounded-md h-10 px-3"
            >
              <option value="BTC/USDT">BTC/USDT</option>
              <option value="ETH/USDT">ETH/USDT</option>
            </select>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={side === "long" ? "primary" : "secondary"}
                onClick={() => setSide("long")}
              >
                Long
              </Button>
              <Button
                type="button"
                size="sm"
                variant={side === "short" ? "primary" : "secondary"}
                onClick={() => setSide("short")}
              >
                Short
              </Button>
            </div>
            <input
              required
              placeholder="size (base units)"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="border border-border rounded-md h-10 px-3 font-mono"
            />
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="border border-border rounded-md h-10 px-3"
            >
              <option value={2}>2× (tier 1+)</option>
              <option value={3}>3× (tier 2+)</option>
              <option value={5}>5× (tier 2+)</option>
              <option value={10}>10× (tier 3+)</option>
            </select>
            <div className="sm:col-span-2">
              <Button type="submit">
                Open {side} {leverage}×
              </Button>
              {message && <p className="text-text-dim mt-2">{message}</p>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open positions ({open_positions.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {open_positions.length === 0 ? (
            <p className="text-text-dim">No open positions.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-text-mute text-xs uppercase">
                <tr>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>Lev</th>
                  <th>Liq @</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="font-tabular">
                {open_positions.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2">{p.pair}</td>
                    <td>{p.side}</td>
                    <td>{p.size}</td>
                    <td>{p.entryPrice}</td>
                    <td>{p.leverage}×</td>
                    <td>{p.liquidationPrice}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => close(p.id)}
                      >
                        Close
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="text-left text-text-mute text-xs uppercase">
                <tr>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Status</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody className="font-tabular">
                {history.slice(0, 20).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2">{p.pair}</td>
                    <td>{p.side}</td>
                    <td>{p.status}</td>
                    <td>{p.realizedPnl ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
