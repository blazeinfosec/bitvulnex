"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { authedFetch, responseError } from "@/lib/token-storage";
import { Modal } from "@/components/exchange";

type Ticket = {
  ticketId: string;
  quotedPrice: string;
  quoteExpiresAt: string;
};

type Me = { kycTier: number };

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

const PAIRS = [
  "BTC/USDT",
  "BTC/USDC",
  "ETH/USDT",
  "ETH/BTC",
  "LTC/USDT",
] as const;

export default function OtcPage() {
  const [pair, setPair] = useState<string>("BTC/USDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/v2/me");
      if (res.ok) {
        setMe(await res.json());
      }
    })();
  }, []);

  async function getQuote() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/otc/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair, side, amount }),
    });
    if (res.ok) {
      setTicket((await res.json()) as Ticket);
    } else if (res.status === 403) {
      setMessage(
        await responseError(res, "OTC desk requires KYC tier 2 or higher."),
      );
    } else {
      setMessage(await responseError(res, `Quote error: ${res.status}`));
    }
  }

  async function accept() {
    if (!ticket) return;
    const res = await authedFetch("/api/v2/me/otc/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.ticketId }),
    });
    if (res.ok) {
      setMessage("Ticket filled.");
      setTicket(null);
    } else {
      setMessage(await responseError(res, `Accept error: ${res.status}`));
    }
    setConfirmOpen(false);
  }

  const tierGated = me !== null && me.kycTier < 2;

  return (
    <Container className="py-10 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          OTC desk
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Block-size pricing against the desk's internal inventory. Quotes are
          valid for 30 seconds.
        </p>
      </div>

      {tierGated && (
        <div className="rounded-md border border-warn/40 bg-warn/10 text-warn px-4 py-3 text-sm">
          The OTC desk requires KYC tier 2.{" "}
          <a href="/account/kyc" className="underline">
            Verify identity →
          </a>
        </div>
      )}

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-text">Request quote</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Pair
            </label>
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              className={inputClass}
            >
              {PAIRS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Side
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-1">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={
                  side === "buy"
                    ? "h-8 rounded text-sm font-semibold bg-buy text-white"
                    : "h-8 rounded text-sm text-text-dim hover:text-text"
                }
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={
                  side === "sell"
                    ? "h-8 rounded text-sm font-semibold bg-sell text-white"
                    : "h-8 rounded text-sm text-text-dim hover:text-text"
                }
              >
                Sell
              </button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1.5 font-medium">
              Amount (base)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00000000"
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="button"
          className={primaryBtn + " w-full"}
          onClick={getQuote}
          disabled={tierGated || !amount}
        >
          Get quote
        </button>
        {message && (
          <p className="text-sm text-text-dim border-t border-border-subtle pt-3">
            {message}
          </p>
        )}
      </section>

      {ticket && (
        <section className="rounded-lg border border-accent/40 bg-bg-elevated p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text">
                Quote ready
              </h2>
              <p className="text-xs text-text-mute mt-1 font-mono">
                Ticket {ticket.ticketId.slice(0, 12)}…
              </p>
            </div>
            <span className="inline-block px-2 py-0.5 text-xs uppercase tracking-wider rounded bg-accent/20 text-accent font-semibold">
              {side}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute">
                Price
              </dt>
              <dd className="font-mono tabular-nums text-text text-lg">
                {ticket.quotedPrice}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-text-mute">
                Expires
              </dt>
              <dd className="font-mono text-text-dim text-xs">
                {new Date(ticket.quoteExpiresAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)}{" "}
                UTC
              </dd>
            </div>
          </dl>

          <div className="flex gap-2">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setTicket(null)}
            >
              Discard
            </button>
            <button
              type="button"
              className={primaryBtn + " flex-1"}
              onClick={() => setConfirmOpen(true)}
            >
              Accept quote
            </button>
          </div>
        </section>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm OTC fill"
        description="Once accepted, this trade fills immediately."
        footer={
          <>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button type="button" className={primaryBtn} onClick={accept}>
              Confirm fill
            </button>
          </>
        }
      >
        {ticket && (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-mute uppercase text-xs tracking-wider">
                Pair
              </dt>
              <dd className="font-mono">{pair}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-mute uppercase text-xs tracking-wider">
                Side
              </dt>
              <dd
                className={side === "buy" ? "text-buy" : "text-sell"}
              >
                {side.toUpperCase()}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-mute uppercase text-xs tracking-wider">
                Amount
              </dt>
              <dd className="font-mono tabular-nums">{amount}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-mute uppercase text-xs tracking-wider">
                Price
              </dt>
              <dd className="font-mono tabular-nums">{ticket.quotedPrice}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </Container>
  );
}
