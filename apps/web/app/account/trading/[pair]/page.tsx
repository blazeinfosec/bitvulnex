"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch, getAccessToken } from "@/lib/token-storage";

type BookSide = { price: string | null; remaining: string }[];
type Book = { pair: string; bids: BookSide; asks: BookSide };
type Price = {
  pair: string;
  last: string | null;
  bestBid: string | null;
  bestAsk: string | null;
};
type OrderRow = {
  id: number;
  side: "buy" | "sell";
  type: string;
  price: string | null;
  amount: string;
  filled: string;
  status: string;
  createdAt: string;
};

export default function TradingPage() {
  const router = useRouter();
  const params = useParams<{ pair: string }>();
  // Accept hyphenated slugs in the URL (`BTC-USDT`) as well as URL-encoded
  // slashes (`BTC%2FUSDT`). The API contract requires `BASE/QUOTE`.
  const rawSlug = decodeURIComponent(params.pair);
  const pair = rawSlug.includes("/") ? rawSlug : rawSlug.replace("-", "/");

  const [book, setBook] = useState<Book | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [myOrders, setMyOrders] = useState<OrderRow[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"limit" | "market">("limit");
  const [orderPrice, setOrderPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [bookRes, priceRes, myRes] = await Promise.all([
      fetch(`/api/v2/public/book/${encodeURIComponent(pair)}`),
      fetch(`/api/v2/public/price/${encodeURIComponent(pair)}`),
      authedFetch("/api/v2/me/orders?status=open"),
    ]);
    if (myRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (bookRes.ok) setBook(await bookRes.json());
    if (priceRes.ok) setPrice(await priceRes.json());
    if (myRes.ok) {
      const b = (await myRes.json()) as { orders: OrderRow[] };
      setMyOrders(b.orders);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    // WebSocket subscription for live book updates.
    const token = getAccessToken();
    const ws = new WebSocket(
      `ws://${window.location.host}/ws${token ? `?token=${token}` : ""}`,
    );
    ws.onopen = () => {
      ws.send(JSON.stringify({ kind: "subscribe", channel: `book:${pair}` }));
      ws.send(JSON.stringify({ kind: "subscribe", channel: `trades:${pair}` }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { kind?: string };
        if (msg.kind === "book_update") load();
      } catch {
        /* ignore */
      }
    };
    return () => {
      clearInterval(t);
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);

  async function place(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await authedFetch("/api/v2/me/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pair,
        side,
        type,
        price: type === "limit" ? orderPrice : undefined,
        amount,
      }),
    });
    if (res.ok) {
      setMessage("placed");
      setAmount("");
      load();
    } else {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setMessage(body.error?.message ?? "place failed");
    }
  }

  async function cancel(id: number) {
    await authedFetch(`/api/v2/me/orders/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <Container className="py-12 max-w-5xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Trading — {pair}
      </h1>
      <p className="text-sm text-navy-700 font-tabular">
        Last: {price?.last ?? "—"} · Bid: {price?.bestBid ?? "—"} · Ask:{" "}
        {price?.bestAsk ?? "—"}
      </p>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Order book</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th>Bid</th>
                  <th>Size</th>
                  <th>Ask</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody className="font-tabular">
                {Array.from({ length: 10 }, (_, i) => (
                  <tr key={i} className="border-t border-navy-100">
                    <td className="text-emerald-700">
                      {book?.bids?.[i]?.price ?? ""}
                    </td>
                    <td>{book?.bids?.[i]?.remaining ?? ""}</td>
                    <td className="text-rose-700">
                      {book?.asks?.[i]?.price ?? ""}
                    </td>
                    <td>{book?.asks?.[i]?.remaining ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Place order</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={place} className="space-y-3 text-sm">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={side === "buy" ? "primary" : "secondary"}
                  onClick={() => setSide("buy")}
                  size="sm"
                >
                  Buy
                </Button>
                <Button
                  type="button"
                  variant={side === "sell" ? "primary" : "secondary"}
                  onClick={() => setSide("sell")}
                  size="sm"
                >
                  Sell
                </Button>
              </div>
              <div className="flex gap-2">
                <select
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as "limit" | "market")
                  }
                  className="border border-navy-200 rounded-md h-10 px-3"
                >
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                </select>
              </div>
              {type === "limit" && (
                <input
                  required
                  placeholder="price"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  className="w-full border border-navy-200 rounded-md h-10 px-3 font-mono"
                />
              )}
              <input
                required
                placeholder="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-navy-200 rounded-md h-10 px-3 font-mono"
              />
              <Button type="submit" className="w-full">
                Place {side} {type}
              </Button>
              {message && <p className="text-navy-700">{message}</p>}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My open orders</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {myOrders.length === 0 ? (
              <p className="text-navy-700">No open orders.</p>
            ) : (
              <table className="w-full">
                <thead className="text-left text-navy-500 text-xs uppercase">
                  <tr>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="font-tabular">
                  {myOrders.map((o) => (
                    <tr key={o.id} className="border-t border-navy-200">
                      <td>{o.side}</td>
                      <td>{o.price ?? "—"}</td>
                      <td>
                        {o.filled}/{o.amount}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => cancel(o.id)}
                        >
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
