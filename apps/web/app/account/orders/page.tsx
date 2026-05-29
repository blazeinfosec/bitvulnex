"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";
import { editOrder } from "./edit-order";

type OrderRow = {
  id: number;
  pair: string;
  side: "buy" | "sell";
  type: string;
  price: string | null;
  amount: string;
  filled: string;
  status: string;
  createdAt: string;
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await authedFetch("/api/v2/me/orders?status=open");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    if (res.ok) {
      const b = (await res.json()) as { orders: OrderRow[] };
      setOrders(b.orders);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(formData: FormData) {
    const res = await editOrder(formData);
    setMessage(res.ok ? "updated" : "failed");
    await load();
  }

  return (
    <Container className="py-12 max-w-4xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-text mb-2">
        Open orders
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Edit a resting order</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {orders.length === 0 ? (
            <p className="text-text-dim">No open orders.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-text-mute text-xs uppercase">
                <tr>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2">{o.pair}</td>
                    <td>{o.side}</td>
                    <td className="font-tabular">
                      <form action={submit} className="flex gap-2 items-center">
                        <input type="hidden" name="id" value={o.id} />
                        <input
                          name="price"
                          defaultValue={o.price ?? ""}
                          className="w-24 border border-border rounded h-8 px-2 font-mono"
                        />
                        <input
                          name="amount"
                          defaultValue={o.amount}
                          className="w-24 border border-border rounded h-8 px-2 font-mono"
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          Save
                        </Button>
                      </form>
                    </td>
                    <td className="font-tabular">
                      {o.filled}/{o.amount}
                    </td>
                    <td>{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {message && <p className="text-text-dim mt-2">{message}</p>}
        </CardContent>
      </Card>
    </Container>
  );
}
