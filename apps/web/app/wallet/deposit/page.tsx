"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import { DataTable, type Column, EmptyState } from "@/components/exchange";

type DepositRow = {
  id: string;
  asset: string;
  txid: string;
  vout: number;
  amount: string;
  confirmations: number;
  status: string;
  seenAt: string;
  creditedAt: string | null;
};

type BalanceRow = { asset: string; amount: string; updatedAt: string };

const ASSETS = ["BTC", "ETH", "LTC", "USDT", "USDC"] as const;

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

export default function WalletDepositPage() {
  const router = useRouter();
  const [asset, setAsset] = useState<string>("BTC");
  const [address, setAddress] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [labEnabled, setLabEnabled] = useState(false);
  const [labAmount, setLabAmount] = useState("0.5");
  const [labRbfTxid, setLabRbfTxid] = useState("");
  const [labRbfAddr, setLabRbfAddr] = useState(
    "bcrt1qattackercontrolled000000000000000000",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    const [addrRes, depRes, balRes] = await Promise.all([
      authedFetch("/api/v2/me/deposit/address"),
      authedFetch("/api/v2/me/deposits"),
      authedFetch("/api/v2/me/balance"),
    ]);
    if (addrRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (!addrRes.ok) {
      const body = (await addrRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? "Could not load address");
    } else {
      const a = (await addrRes.json()) as { address: string };
      setAddress(a.address);
    }
    if (depRes.ok) {
      const b = (await depRes.json()) as { deposits: DepositRow[] };
      setDeposits(b.deposits);
    }
    if (balRes.ok) {
      const b = (await balRes.json()) as { balances: BalanceRow[] };
      setBalances(b.balances);
    }
    const probe = await fetch("/api/v2/dev/btc/status");
    if (probe.ok) {
      const body = (await probe.json()) as { enabled: boolean };
      setLabEnabled(body.enabled);
    } else {
      setLabEnabled(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function labSend() {
    if (!address) return;
    const res = await authedFetch("/api/v2/dev/btc/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, amountBtc: Number(labAmount) }),
    });
    const body = (await res.json()) as {
      txid?: string;
      error?: { message: string };
    };
    setMessage(
      body.txid
        ? `Sent ${labAmount} BTC, txid ${body.txid.slice(0, 16)}…`
        : "send failed",
    );
    if (body.txid) setLabRbfTxid(body.txid);
    setTimeout(loadAll, 5500);
  }

  async function labMine(blocks: number) {
    const res = await authedFetch("/api/v2/dev/btc/mine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (res.ok) setMessage(`Mined ${blocks} block${blocks > 1 ? "s" : ""}`);
    setTimeout(loadAll, 5500);
  }

  async function labRbf() {
    const res = await authedFetch("/api/v2/dev/btc/rbf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txid: labRbfTxid, newAddress: labRbfAddr }),
    });
    const body = (await res.json()) as {
      replacementTxid?: string;
      error?: { message: string };
    };
    setMessage(
      body.replacementTxid
        ? `RBF replaced; new txid ${body.replacementTxid.slice(0, 16)}…`
        : `RBF failed: ${body.error?.message ?? "?"}`,
    );
    setTimeout(loadAll, 5500);
  }

  const balance = balances.find((b) => b.asset === asset);

  const cols: Column<DepositRow>[] = [
    {
      key: "txid",
      header: "Txid",
      render: (d) => (
        <span className="font-mono text-xs text-text-dim">
          {d.txid.slice(0, 16)}…:{d.vout}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (d) => (
        <span className="font-mono tabular-nums">
          {d.amount} {d.asset}
        </span>
      ),
    },
    {
      key: "confs",
      header: "Confs",
      align: "right",
      render: (d) => <span className="font-mono tabular-nums">{d.confirmations}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (d) => (
        <span
          className={
            d.status === "credited"
              ? "text-buy"
              : d.status === "dropped"
                ? "text-sell"
                : "text-text-dim"
          }
        >
          {d.status}
        </span>
      ),
    },
    {
      key: "seen",
      header: "Seen",
      render: (d) => (
        <span className="font-mono text-xs text-text-mute">
          {new Date(d.seenAt).toISOString().replace("T", " ").slice(0, 19)} UTC
        </span>
      ),
    },
  ];

  return (
    <Container className="py-10 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Deposit
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Choose an asset and network, then send funds to the generated
          address. Funds appear after confirmation.
        </p>
      </div>

      {/* Wallet sub-nav */}
      <nav className="flex gap-1 border-b border-border">
        <a
          href="/wallet/deposit"
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
        >
          Deposit
        </a>
        <a
          href="/wallet/withdraw"
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
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

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* LEFT: asset → network → address */}
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-bg-elevated p-5">
            <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-3">
              Select asset
            </h2>
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
          </section>

          <section className="rounded-lg border border-border bg-bg-elevated p-5">
            <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-3">
              Network
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md bg-accent text-accent-fg font-mono text-sm font-semibold"
              >
                {asset === "USDT" || asset === "USDC"
                  ? `${asset} (regtest)`
                  : `${asset} (regtest)`}
              </button>
              <span className="text-xs text-text-mute">
                Lab environment — mainnet networks disabled.
              </span>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium">
              Deposit address ({asset})
            </h2>
            {address ? (
              <>
                <div className="font-mono text-sm break-all bg-bg border border-border-subtle rounded-md p-3 text-text">
                  {address}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={() => navigator.clipboard.writeText(address)}
                  >
                    Copy address
                  </button>
                </div>
                <div className="rounded-md border border-warn/40 bg-warn/10 text-warn px-3 py-2 text-xs leading-relaxed">
                  Only send {asset} to this address. Sending other assets may
                  result in permanent loss. Confirmations required:{" "}
                  <strong>1-3</strong> depending on tier.
                </div>
              </>
            ) : (
              <p className="text-sm text-text-dim">Loading address…</p>
            )}
          </section>

          <section>
            <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
              Recent deposits
            </h2>
            <DataTable<DepositRow>
              columns={cols}
              rows={deposits}
              rowKey={(d) => d.id}
              empty={
                <EmptyState
                  title="No deposits yet"
                  description="Once a deposit lands on chain, it will appear here."
                />
              }
            />
          </section>
        </div>

        {/* RIGHT: balances */}
        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-bg-elevated p-5">
            <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-3">
              Balances
            </h2>
            {balances.length === 0 ? (
              <p className="text-sm text-text-mute">No balances yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.asset} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 text-text-dim">{b.asset}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-text">
                        {b.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {labEnabled && (
            <section className="rounded-lg border border-border bg-bg-elevated p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium">
                  Lab toolkit
                </h2>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-warn/20 text-warn font-semibold">
                  Dev only
                </span>
              </div>
              <div className="space-y-2">
                <label className="block text-xs text-text-mute uppercase tracking-wider">
                  Amount (BTC)
                </label>
                <input
                  value={labAmount}
                  onChange={(e) => setLabAmount(e.target.value)}
                  className={inputClass}
                />
                <button type="button" className={secondaryBtn} onClick={labSend}>
                  Send to deposit address
                </button>
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryBtn} onClick={() => labMine(1)}>
                  Mine 1
                </button>
                <button type="button" className={secondaryBtn} onClick={() => labMine(3)}>
                  Mine 3
                </button>
              </div>
              <div className="space-y-2 pt-2 border-t border-border-subtle">
                <label className="block text-xs text-text-mute uppercase tracking-wider">
                  RBF replace
                </label>
                <input
                  value={labRbfTxid}
                  onChange={(e) => setLabRbfTxid(e.target.value)}
                  placeholder="txid"
                  className={inputClass + " text-xs"}
                />
                <input
                  value={labRbfAddr}
                  onChange={(e) => setLabRbfAddr(e.target.value)}
                  placeholder="new address"
                  className={inputClass + " text-xs"}
                />
                <button type="button" className={secondaryBtn} onClick={labRbf}>
                  RBF
                </button>
              </div>
              {message && (
                <p className="text-xs text-text-dim border-t border-border-subtle pt-2">
                  {message}
                </p>
              )}
            </section>
          )}
        </aside>
      </div>

      {/* hint suppress unused */}
      <div className="hidden">{balance?.amount}</div>
    </Container>
  );
}
