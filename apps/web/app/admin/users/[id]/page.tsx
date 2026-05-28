"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/token-storage";

type UserDetail = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    kycTier: number;
    emailVerified: boolean;
    createdAt: string;
  };
  balances: Array<{
    asset: string;
    amount: string;
    available: string;
    locked: string;
  }>;
  kyc: unknown;
  recentOrders: Array<{
    id: number;
    pair: string;
    side: string;
    amount: string;
    status: string;
  }>;
};

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [adjAsset, setAdjAsset] = useState("BTC");
  const [adjDelta, setAdjDelta] = useState("");

  async function load() {
    const res = await authedFetch(`/api/v2/admin/users/${params.id}`);
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    setData((await res.json()) as UserDetail);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!data) return <Container className="py-12">Loading…</Container>;

  const u = data.user;
  const nameHtml =
    u.kycTier >= 1
      ? `<strong>${u.displayName ?? ""}</strong>`
      : (u.displayName ?? "");

  async function freeze(action: "freeze" | "unfreeze") {
    await authedFetch(`/api/v2/admin/users/${params.id}/${action}`, {
      method: "POST",
    });
    await load();
  }

  async function adjust() {
    await authedFetch(`/api/v2/admin/users/${params.id}/balance-adjust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset: adjAsset, delta: adjDelta }),
    });
    setAdjDelta("");
    await load();
  }

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1
        className="text-3xl font-semibold tracking-tight text-navy-900 mb-2"
        dangerouslySetInnerHTML={{ __html: nameHtml }}
      />
      <div className="text-sm text-navy-700">
        {u.email} · {u.role} · tier {u.kycTier}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-navy-500 text-left">
              <tr>
                <th>Asset</th>
                <th>Amount</th>
                <th>Available</th>
                <th>Locked</th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr key={b.asset} className="border-t border-navy-100">
                  <td>{b.asset}</td>
                  <td>{b.amount}</td>
                  <td>{b.available}</td>
                  <td>{b.locked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Internal actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => freeze("freeze")}>
              Freeze withdrawals
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => freeze("unfreeze")}
            >
              Unfreeze
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={adjAsset}
              onChange={(e) => setAdjAsset(e.target.value)}
              className="w-20 border border-navy-200 rounded px-2 py-1"
            />
            <input
              type="text"
              value={adjDelta}
              onChange={(e) => setAdjDelta(e.target.value)}
              placeholder="delta (e.g. -0.001 or 1.0)"
              className="flex-1 border border-navy-200 rounded px-2 py-1"
            />
            <Button size="sm" onClick={adjust}>
              Adjust balance
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
