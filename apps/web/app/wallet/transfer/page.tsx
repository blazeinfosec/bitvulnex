"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import { BalancePill } from "@/components/exchange";

type BalanceRow = { asset: string; amount: string };

const ASSETS = ["BTC", "ETH", "LTC", "USDT", "USDC"] as const;

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";

export default function WalletTransferPage() {
  const router = useRouter();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me/balance");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.ok) {
        const b = (await res.json()) as { balances: BalanceRow[] };
        setBalances(b.balances);
      }
    })();
  }, [router]);

  async function submit() {
    setError(null);
    setMessage(null);
    const body: Record<string, unknown> = { recipientEmail, asset, amount };
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
      setError(
        "error" in respBody ? respBody.error.message : "Transfer failed",
      );
    } else {
      setMessage("Transfer complete.");
      setAmount("");
      setRecipientEmail("");
      setMemo("");
    }
  }

  const available = balances.find((b) => b.asset === asset)?.amount ?? "0";

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Internal transfer
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Move funds between BVBE accounts instantly. Fee-free.
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
          className="px-4 py-2 text-sm font-medium text-text-dim hover:text-text border-b-2 border-transparent hover:border-border -mb-px"
        >
          Withdraw
        </a>
        <a
          href="/wallet/transfer"
          className="px-4 py-2 text-sm font-medium text-text border-b-2 border-accent -mb-px"
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
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Recipient email
          </label>
          <input
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="user@example.com"
            className={inputClass + " font-sans"}
          />
        </div>

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
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
            Memo (optional)
          </label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Note to recipient"
            className={inputClass + " font-sans"}
          />
        </div>

        <button
          type="button"
          className={primaryBtn + " w-full"}
          disabled={!amount || !recipientEmail}
          onClick={submit}
        >
          Send
        </button>
      </section>
    </Container>
  );
}
