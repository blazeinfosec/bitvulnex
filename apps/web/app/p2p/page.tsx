"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { authedFetch } from "@/lib/token-storage";
import { DataTable, type Column, EmptyState } from "@/components/exchange";

type Offer = {
  id: string;
  side: "buy" | "sell";
  asset: string;
  amount: string;
  price: string;
  payMethod: string;
  maker: string | null;
};

const inputClass =
  "w-full h-10 px-3 rounded-md bg-bg border border-border text-text placeholder:text-text-mute font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors";

const primaryBtn =
  "inline-flex items-center justify-center h-10 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors font-semibold text-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-9 px-3 rounded-md bg-bg border border-border text-text hover:bg-bg-hover transition-colors text-sm";

export default function P2PPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [asset, setAsset] = useState("BTC");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [payMethod, setPayMethod] = useState("SEPA");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v2/public/p2p/offers");
    if (res.ok) {
      const b = (await res.json()) as { offers: Offer[] };
      setOffers(b.offers);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function createOffer() {
    setMessage(null);
    const res = await authedFetch("/api/v2/me/p2p/offers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side, asset, amount, price, payMethod }),
    });
    setMessage(res.ok ? "Offer posted." : `Error: ${res.status}`);
    if (res.ok) await load();
  }

  async function takeOffer(offerId: string, amt: string) {
    const res = await authedFetch("/api/v2/me/p2p/trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offerId, amount: amt }),
    });
    if (res.ok) {
      const b = (await res.json()) as { tradeId: string };
      setMessage(`Trade ${b.tradeId} created.`);
      await load();
    } else {
      setMessage(`Error: ${res.status}`);
    }
  }

  const cols: Column<Offer>[] = [
    {
      key: "maker",
      header: "Maker",
      // V-1: P2P side renders displayName as plain React text (escaped by default).
      render: (o) => <span className="text-text">{o.maker ?? "—"}</span>,
    },
    {
      key: "side",
      header: "Side",
      render: (o) => (
        <span
          className={
            o.side === "buy"
              ? "text-buy font-semibold uppercase text-xs"
              : "text-sell font-semibold uppercase text-xs"
          }
        >
          {o.side}
        </span>
      ),
    },
    {
      key: "asset",
      header: "Asset",
      render: (o) => <span className="font-mono">{o.asset}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (o) => (
        <span className="font-mono tabular-nums">{o.amount}</span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (o) => (
        <span className="font-mono tabular-nums">{o.price}</span>
      ),
    },
    {
      key: "pay",
      header: "Pay",
      render: (o) => (
        <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-bg border border-border text-text-dim font-mono">
          {o.payMethod}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (o) => (
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => takeOffer(o.id, o.amount)}
        >
          Take
        </button>
      ),
    },
  ];

  return (
    <Container className="py-10 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">P2P</h1>
        <p className="text-sm text-text-dim mt-1">
          Trade peer-to-peer with BVBE as escrow. Sellers lock the asset when
          they post; buyers mark fiat paid and sellers release.
        </p>
      </div>

      {message && (
        <div className="rounded-md border border-border bg-bg-elevated text-text-dim px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
          Open offers ({offers.length})
        </h2>
        <DataTable<Offer>
          columns={cols}
          rows={offers}
          rowKey={(o) => o.id}
          empty={
            <EmptyState
              title="No offers right now"
              description="Be the first to post an offer below."
            />
          }
        />
      </section>

      <section className="rounded-lg border border-border bg-bg-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-text">Post a new offer</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Side
            </label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
              className={inputClass}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Asset
            </label>
            <input
              value={asset}
              onChange={(e) => setAsset(e.target.value.toUpperCase())}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Amount
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Price
            </label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-mute mb-1 font-medium">
              Pay method
            </label>
            <input
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              className={inputClass + " font-sans"}
            />
          </div>
        </div>
        <button type="button" className={primaryBtn} onClick={createOffer}>
          Post offer
        </button>
      </section>
    </Container>
  );
}
