"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type LiqRow = {
  id: number;
  triggerPrice: string;
  keeperRebate: string;
  flaggedAt: string;
  position: {
    id: number;
    pair: string;
    side: string;
    size: string;
    entryPrice: string;
    collateral: string;
    liquidationPrice: string;
  };
};

export default function KeeperPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<LiqRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch("/api/v2/keeper/liquidations");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (res.ok) {
      const b = (await res.json()) as { liquidations: LiqRow[] };
      setQueue(b.liquidations);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function claim(id: number) {
    const res = await authedFetch(
      `/api/v2/keeper/liquidations/${id}/claim`,
      { method: "POST" },
    );
    const b = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      rebate?: string;
      error?: { message?: string };
    };
    setMessage(
      b.ok
        ? `claimed; rebate ${b.rebate}`
        : `claim failed: ${b.error?.message ?? "?"}`,
    );
    load();
  }

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Liquidation keeper
      </h1>
      <p className="text-sm text-navy-700">
        Anyone can claim a flagged liquidation. Rebate is paid from
        the closed position&apos;s collateral.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Open queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {queue.length === 0 ? (
            <p className="text-navy-700">No flagged positions.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th>Pos</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Liq @</th>
                  <th>Trigger</th>
                  <th>Rebate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="font-tabular">
                {queue.map((l) => (
                  <tr key={l.id} className="border-t border-navy-200">
                    <td className="py-2">{l.position.id}</td>
                    <td>{l.position.pair}</td>
                    <td>{l.position.side}</td>
                    <td>{l.position.entryPrice}</td>
                    <td>{l.position.liquidationPrice}</td>
                    <td>{l.triggerPrice}</td>
                    <td>{l.keeperRebate}</td>
                    <td>
                      <Button size="sm" onClick={() => claim(l.id)}>
                        Claim
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {message && <p className="text-navy-700 mt-2">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
