import { describe, it, expect } from "vitest";
import { buildActivityFeed, type ActivityInput } from "./activity";

function emptyInput(): ActivityInput {
  return {
    deposits: [],
    withdrawals: [],
    transfers: [],
    trades: [],
    orders: [],
    stakes: [],
    lending: [],
    otc: [],
    p2p: [],
  };
}

describe("buildActivityFeed", () => {
  it("returns an empty list when no events are provided", () => {
    expect(buildActivityFeed(emptyInput())).toEqual([]);
  });

  it("merges + sorts newest-first across event types", () => {
    const input = emptyInput();
    input.deposits.push({
      asset: "BTC",
      amount: "0.5",
      creditedAt: new Date("2026-05-29T10:00:00Z"),
      seenAt: new Date("2026-05-29T09:50:00Z"),
      status: "credited",
    });
    input.trades.push({
      pair: "BTC/USDT",
      amount: "0.01",
      price: "60000",
      executedAt: new Date("2026-05-29T12:00:00Z"),
      side: "buy",
    });
    input.withdrawals.push({
      asset: "USDT",
      amount: "100",
      requestedAt: new Date("2026-05-29T11:00:00Z"),
      status: "pending",
      destAddress: "bcrt1qexample",
    });

    const events = buildActivityFeed(input);
    expect(events.map((e) => e.kind)).toEqual([
      "trade",
      "withdrawal",
      "deposit",
    ]);
    // Trade link points to slug form
    expect(events[0]?.link).toBe("/trade/BTC-USDT");
  });

  it("emits both placed and cancelled events for cancelled orders", () => {
    const input = emptyInput();
    input.orders.push({
      pair: "ETH/USDT",
      side: "sell",
      type: "limit",
      amount: "1",
      price: "3500",
      status: "cancelled",
      createdAt: new Date("2026-05-29T08:00:00Z"),
      cancelledAt: new Date("2026-05-29T08:30:00Z"),
    });
    const events = buildActivityFeed(input);
    expect(events.map((e) => e.kind)).toEqual([
      "order_cancelled",
      "order_placed",
    ]);
  });

  it("respects the limit", () => {
    const input = emptyInput();
    for (let i = 0; i < 75; i++) {
      input.trades.push({
        pair: "BTC/USDT",
        amount: "0.001",
        price: "60000",
        executedAt: new Date(2026, 4, 29, 12, 0, i),
        side: "buy",
      });
    }
    const events = buildActivityFeed(input, 50);
    expect(events.length).toBe(50);
  });
});
