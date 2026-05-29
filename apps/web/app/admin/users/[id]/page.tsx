"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const inputClass =
  "h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";
const dangerBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-sell/20 border border-sell/40 text-sell hover:bg-sell/30 transition-colors text-sm";

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

  if (!data) return <p className="text-text-dim">Loading…</p>;

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
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl font-semibold tracking-tight text-text"
          dangerouslySetInnerHTML={{ __html: nameHtml }}
        />
        <div className="text-sm text-text-dim mt-1 flex items-center gap-3">
          <span className="font-mono">{u.email}</span>
          <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-medium">
            {u.role}
          </span>
          <span className="text-text-mute font-mono">tier {u.kycTier}</span>
          {u.emailVerified ? (
            <span className="text-buy text-xs">verified</span>
          ) : (
            <span className="text-warn text-xs">unverified</span>
          )}
        </div>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          Balances
        </h2>
        <div className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-text-mute font-medium">
                  Asset
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-text-mute font-medium">
                  Amount
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-text-mute font-medium">
                  Available
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-text-mute font-medium">
                  Locked
                </th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr
                  key={b.asset}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-4 py-3 text-text-dim">{b.asset}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-text">
                    {b.amount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-text">
                    {b.available}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-text-dim">
                    {b.locked}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text">Internal actions</h2>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-text-mute font-medium w-32">
            Account state
          </span>
          <button
            type="button"
            className={dangerBtn}
            onClick={() => freeze("freeze")}
          >
            Freeze withdrawals
          </button>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => freeze("unfreeze")}
          >
            Unfreeze
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border-subtle">
          <span className="text-xs uppercase tracking-wider text-text-mute font-medium w-32">
            Adjust balance
          </span>
          <input
            type="text"
            value={adjAsset}
            onChange={(e) => setAdjAsset(e.target.value)}
            className={inputClass + " w-24"}
          />
          <input
            type="text"
            value={adjDelta}
            onChange={(e) => setAdjDelta(e.target.value)}
            placeholder="delta (e.g. -0.001)"
            className={inputClass + " flex-1 min-w-[200px]"}
          />
          <button type="button" className={primaryBtn} onClick={adjust}>
            Adjust
          </button>
        </div>
      </section>
    </div>
  );
}
