"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import {
  BalancePill,
  DataTable,
  type Column,
  EmptyState,
  Modal,
} from "@/components/exchange";

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

const ASSETS = ["BTC", "ETH", "LTC", "USDT", "USDC"] as const;

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";
const dangerBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-sell/20 border border-sell/40 text-sell hover:bg-sell/30 transition-colors text-sm";

export default function WalletWithdrawPage() {
  const router = useRouter();
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      setError("error" in body ? body.error.message : "Withdrawal failed");
    } else {
      setMessage("Withdrawal submitted.");
      setAmount("");
      setDestAddress("");
      loadAll();
    }
    setConfirmOpen(false);
  }

  async function cancel(id: string) {
    const res = await authedFetch(
      `/api/v2/me/withdrawals/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
    if (res.ok) {
      setMessage("Withdrawal cancelled.");
      loadAll();
    } else {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message: string };
      };
      setError(body.error?.message ?? "Cancel failed");
    }
  }

  const available = balances.find((b) => b.asset === asset)?.amount ?? "0";

  function setPercent(pct: number) {
    const n = Number(available) * (pct / 100);
    if (!Number.isFinite(n)) return;
    setAmount(String(n));
  }

  const cols: Column<WithdrawalRow>[] = [
    {
      key: "when",
      header: "When",
      render: (w) => (
        <span className="font-mono text-xs text-text-mute">
          {new Date(w.requestedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
        </span>
      ),
    },
    {
      key: "asset",
      header: "Asset",
      render: (w) => <span className="text-text-dim">{w.asset}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (w) => (
        <span className="font-mono tabular-nums">{w.amount}</span>
      ),
    },
    {
      key: "dest",
      header: "Destination",
      render: (w) => (
        <span className="font-mono text-xs text-text-dim">
          {w.destAddress.slice(0, 18)}…
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (w) => (
        <span
          className={
            w.status === "broadcast" || w.status === "confirmed"
              ? "text-buy"
              : w.status === "cancelled" || w.status === "failed"
                ? "text-sell"
                : "text-text-dim"
          }
        >
          {w.status}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (w) =>
        w.status === "pending" || w.status === "approved" ? (
          <button
            type="button"
            className={dangerBtn}
            onClick={() => cancel(w.id)}
          >
            Cancel
          </button>
        ) : null,
    },
  ];

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Withdraw
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Withdraw to an external address. Internal transfers are fee-free.
        </p>
      </div>

      <nav className="flex gap-1 border-b border-border">
        <a
          href="/wallet/deposit"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          Deposit
        </a>
        <a
          href="/wallet/withdraw"
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
        >
          Withdraw
        </a>
        <a
          href="/wallet/transfer"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          Transfer
        </a>
      </nav>

      {error && (
        <div className="rounded-md border border-sell/40 bg-sell/10 text-sell px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-buy/40 bg-buy/10 text-buy px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-text">External withdrawal</h2>

        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Asset
          </label>
          <div className="flex flex-wrap gap-2">
            {ASSETS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAsset(a)}
                className={
                  a === asset
                    ? "px-3 py-1.5 rounded-md bg-accent text-accent-fg font-mono text-sm font-semibold"
                    : "px-3 py-1.5 rounded-md border border-border text-text-dim hover:bg-bg-hover hover:text-text font-mono text-sm transition-colors"
                }
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Destination address
          </label>
          <input
            value={destAddress}
            onChange={(e) => setDestAddress(e.target.value)}
            placeholder="bcrt1q…"
            className={inputClass + " text-xs"}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs uppercase tracking-wider text-text-mute font-medium">
              Amount
            </label>
            <BalancePill value={available} asset={asset} />
          </div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00000000"
            className={inputClass}
          />
          <div className="flex gap-2 mt-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(p)}
                className="px-2 py-1 text-xs rounded-md border border-border text-text-dim hover:bg-bg-hover hover:text-text transition-colors font-mono"
              >
                {p === 100 ? "MAX" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs border-t border-border-subtle pt-3">
          <span className="text-text-mute uppercase tracking-wider">
            Network fee
          </span>
          <span className="font-mono text-text-dim">
            ~0.0001 {asset}
          </span>
        </div>

        <button
          type="button"
          className={primaryBtn + " w-full"}
          disabled={!amount || !destAddress}
          onClick={() => setConfirmOpen(true)}
        >
          Review withdrawal
        </button>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          Recent withdrawals
        </h2>
        <DataTable<WithdrawalRow>
          columns={cols}
          rows={withdrawals}
          rowKey={(w) => w.id}
          empty={
            <EmptyState
              title="No withdrawals yet"
              description="Submitted withdrawals appear here once requested."
            />
          }
        />
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm withdrawal"
        description="Once broadcast, this cannot be reversed."
        footer={
          <>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button type="button" className={primaryBtn} onClick={submit}>
              Confirm withdrawal
            </button>
          </>
        }
      >
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-text-mute uppercase text-xs tracking-wider">
              Asset
            </dt>
            <dd className="font-mono">{asset}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-text-mute uppercase text-xs tracking-wider">
              Amount
            </dt>
            <dd className="font-mono tabular-nums">{amount}</dd>
          </div>
          <div className="flex items-start justify-between gap-2">
            <dt className="text-text-mute uppercase text-xs tracking-wider">
              Destination
            </dt>
            <dd className="font-mono text-xs break-all text-right">
              {destAddress}
            </dd>
          </div>
        </dl>
      </Modal>
    </Container>
  );
}
