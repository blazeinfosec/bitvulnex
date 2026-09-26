"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { authedFetch, getAccessToken, responseError } from "@/lib/token-storage";
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

type MyTrade = {
  id: string;
  offerId: string;
  asset: string;
  amount: string;
  price: string;
  status: "pending_payment" | "paid" | "released" | "disputed" | "cancelled";
  createdAt: string;
  releasedAt: string | null;
  role: "buyer" | "seller";
};

type MyOffer = {
  id: string;
  side: "buy" | "sell";
  asset: string;
  amount: string;
  price: string;
  payMethod: string;
  status: "open" | "paused" | "filled" | "cancelled";
  createdAt: string;
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
  const [isAuthed, setIsAuthed] = useState(false);
  const [myTrades, setMyTrades] = useState<MyTrade[] | null>(null);
  const [myOffers, setMyOffers] = useState<MyOffer[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadMine() {
    if (!getAccessToken()) {
      setIsAuthed(false);
      return;
    }
    setIsAuthed(true);
    try {
      const [tr, or] = await Promise.all([
        authedFetch("/api/v2/me/p2p/trades"),
        authedFetch("/api/v2/me/p2p/offers"),
      ]);
      if (tr.status === 401 || or.status === 401) {
        setIsAuthed(Boolean(getAccessToken()));
      }
      if (tr.ok) {
        const b = (await tr.json()) as { trades?: MyTrade[] };
        setMyTrades(b.trades ?? []);
      }
      // Older deployments may not expose the caller's own offers list.
      if (or.ok) {
        const b = (await or.json()) as { offers?: MyOffer[] };
        setMyOffers(b.offers ?? []);
      } else if (or.status === 404 || or.status === 405) {
        setMyOffers(null);
      }
    } catch {
      /* network blip: keep the last good data */
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/v2/public/p2p/offers");
      if (res.ok) {
        const b = (await res.json()) as { offers: Offer[] };
        setOffers(b.offers);
      }
    } catch {
      /* ignore */
    }
    await loadMine();
  }

  async function tradeAction(id: string, action: "mark-paid" | "release") {
    setMessage(null);
    setBusyId(id);
    try {
      const res = await authedFetch(
        `/api/v2/me/p2p/trades/${encodeURIComponent(id)}/${action}`,
        { method: "POST" },
      );
      if (!res.ok) {
        setMessage(await responseError(res));
        return;
      }
      setMessage(
        action === "mark-paid"
          ? "Marked as paid. The seller has been notified."
          : "Escrow released.",
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function cancelOffer(id: string) {
    setMessage(null);
    setBusyId(id);
    try {
      const res = await authedFetch(
        `/api/v2/me/p2p/offers/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setMessage(await responseError(res));
        return;
      }
      setMessage("Offer cancelled.");
      await load();
    } finally {
      setBusyId(null);
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
    setMessage(res.ok ? "Offer posted." : await responseError(res));
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
      setMessage(await responseError(res));
    }
  }

  const cols: Column<Offer>[] = [
    {
      key: "maker",
      header: "Maker",
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

  const tradeCols: Column<MyTrade>[] = [
    {
      key: "id",
      header: "Trade",
      render: (t) => (
        <span className="font-mono text-xs text-text-dim">{t.id.slice(0, 10)}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (t) => (
        <span
          className={
            t.role === "buyer"
              ? "text-buy font-semibold uppercase text-xs"
              : "text-sell font-semibold uppercase text-xs"
          }
        >
          {t.role}
        </span>
      ),
    },
    {
      key: "asset",
      header: "Asset",
      render: (t) => <span className="font-mono">{t.asset}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (t) => <span className="font-mono tabular-nums">{t.amount}</span>,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (t) => <span className="font-mono tabular-nums">{t.price}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <span className="font-mono text-xs text-text-dim">
          {t.status.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (t) =>
        t.role === "buyer" && t.status === "pending_payment" ? (
          <button
            type="button"
            className={secondaryBtn}
            disabled={busyId === t.id}
            onClick={() => tradeAction(t.id, "mark-paid")}
          >
            Mark paid
          </button>
        ) : t.role === "seller" && t.status === "paid" ? (
          <button
            type="button"
            className={secondaryBtn}
            disabled={busyId === t.id}
            onClick={() => tradeAction(t.id, "release")}
          >
            Release
          </button>
        ) : null,
    },
  ];

  const myOfferCols: Column<MyOffer>[] = [
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
      render: (o) => <span className="font-mono tabular-nums">{o.amount}</span>,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (o) => <span className="font-mono tabular-nums">{o.price}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (o) => (
        <span className="font-mono text-xs text-text-dim">{o.status}</span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (o) =>
        o.status === "open" || o.status === "paused" ? (
          <button
            type="button"
            className={secondaryBtn}
            disabled={busyId === o.id}
            onClick={() => cancelOffer(o.id)}
          >
            Cancel
          </button>
        ) : null,
    },
  ];

  return (
    <Container className="py-10 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">P2P</h1>
        <p className="text-sm text-text-dim mt-1">
          Trade peer-to-peer with Bitvulnex as escrow. Sellers lock the asset when
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

      {isAuthed && myTrades !== null && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
            My trades ({myTrades.length})
          </h2>
          <DataTable<MyTrade>
            columns={tradeCols}
            rows={myTrades}
            rowKey={(t) => t.id}
            empty={
              <EmptyState
                title="No trades yet"
                description="Take an offer above to start a trade."
              />
            }
          />
        </section>
      )}

      {isAuthed && myOffers !== null && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-text-mute font-medium mb-2">
            My offers ({myOffers.length})
          </h2>
          <DataTable<MyOffer>
            columns={myOfferCols}
            rows={myOffers}
            rowKey={(o) => o.id}
            empty={
              <EmptyState
                title="You have no offers"
                description="Post one below."
              />
            }
          />
        </section>
      )}

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
