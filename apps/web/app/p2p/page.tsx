"use client";

import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type Offer = {
  id: string;
  side: "buy" | "sell";
  asset: string;
  amount: string;
  price: string;
  payMethod: string;
  maker: string | null;
};

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
    setMessage(res.ok ? "offer posted" : `error: ${res.status}`);
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
      setMessage(`trade ${b.tradeId} created`);
      await load();
    } else {
      setMessage(`error: ${res.status}`);
    }
  }

  return (
    <Container className="py-10 max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        P2P
      </h1>
      <p className="text-sm text-navy-600 mb-6">
        Trade peer-to-peer with the platform as escrow. Sellers lock the asset
        when they post; buyers mark fiat paid and sellers release.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Open offers</CardTitle>
        </CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="text-sm text-navy-600">No offers right now.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="text-left py-2">Maker</th>
                  <th>Side</th>
                  <th>Asset</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Price</th>
                  <th>Pay</th>
                  <th />
                </tr>
              </thead>
              <tbody className="font-tabular">
                {offers.map((o) => (
                  <tr key={o.id} className="border-t border-navy-100">
                    <td className="py-2">{o.maker ?? "—"}</td>
                    <td className="text-center">{o.side}</td>
                    <td className="text-center">{o.asset}</td>
                    <td className="text-right">{o.amount}</td>
                    <td className="text-right">{o.price}</td>
                    <td className="text-center">{o.payMethod}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => takeOffer(o.id, o.amount)}
                      >
                        Take
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Post offer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <select
              className="border border-navy-200 rounded px-2 py-1"
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular w-24"
              placeholder="asset"
              value={asset}
              onChange={(e) => setAsset(e.target.value.toUpperCase())}
            />
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              placeholder="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="border border-navy-200 rounded px-2 py-1 font-tabular"
              placeholder="price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <input
              className="border border-navy-200 rounded px-2 py-1"
              placeholder="pay method"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            />
            <Button onClick={createOffer}>Post</Button>
          </div>
          {message && <p className="text-sm text-navy-700">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
