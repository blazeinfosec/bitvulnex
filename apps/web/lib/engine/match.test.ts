import { describe, it, expect } from "vitest";
import { Prisma } from "@bvbe/db";
import {
  matchAgainstBook,
  sortBook,
  type RestingOrder,
} from "./match";

const D = (s: string) => new Prisma.Decimal(s);

function mkResting(partial: Partial<RestingOrder>): RestingOrder {
  return {
    id: 1,
    userId: "u-maker",
    side: "sell",
    type: "limit",
    price: D("100"),
    amount: D("1"),
    filled: D("0"),
    ...partial,
  };
}

describe("matchAgainstBook", () => {
  it("matches a buy limit against a single sell at price", () => {
    const resting = [mkResting({ id: 1, price: D("100"), amount: D("1") })];
    const { matches, remaining } = matchAgainstBook(
      { side: "buy", type: "limit", price: D("100"), amount: D("1"), userId: "u-taker" },
      resting,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.amount.toString()).toBe("1");
    expect(remaining.toString()).toBe("0");
  });

  it("partial fill leaves remaining on the taker side", () => {
    const resting = [mkResting({ id: 1, price: D("100"), amount: D("0.4") })];
    const { matches, remaining } = matchAgainstBook(
      { side: "buy", type: "limit", price: D("100"), amount: D("1"), userId: "u-taker" },
      resting,
    );
    expect(matches[0]?.amount.toString()).toBe("0.4");
    expect(remaining.toString()).toBe("0.6");
  });

  it("buy limit does not cross above ask", () => {
    const resting = [mkResting({ id: 1, price: D("101"), amount: D("1") })];
    const { matches } = matchAgainstBook(
      { side: "buy", type: "limit", price: D("100"), amount: D("1"), userId: "u-taker" },
      resting,
    );
    expect(matches).toHaveLength(0);
  });

  it("market order crosses any available ask", () => {
    const resting = [
      mkResting({ id: 1, price: D("100"), amount: D("0.5") }),
      mkResting({ id: 2, price: D("101"), amount: D("0.5") }),
    ];
    const sorted = sortBook(resting, "buy");
    const { matches, remaining } = matchAgainstBook(
      { side: "buy", type: "market", price: null, amount: D("1"), userId: "u-taker" },
      sorted,
    );
    expect(matches).toHaveLength(2);
    expect(remaining.toString()).toBe("0");
  });
});

describe("sortBook", () => {
  it("sorts asks ascending by price for a buy taker", () => {
    const book = [
      mkResting({ id: 1, side: "sell", price: D("102") }),
      mkResting({ id: 2, side: "sell", price: D("100") }),
      mkResting({ id: 3, side: "sell", price: D("101") }),
    ];
    const sorted = sortBook(book, "buy");
    expect(sorted.map((o) => o.id)).toEqual([2, 3, 1]);
  });

  it("sorts bids descending by price for a sell taker", () => {
    const book = [
      mkResting({ id: 1, side: "buy", price: D("100") }),
      mkResting({ id: 2, side: "buy", price: D("102") }),
      mkResting({ id: 3, side: "buy", price: D("101") }),
    ];
    const sorted = sortBook(book, "sell");
    expect(sorted.map((o) => o.id)).toEqual([2, 3, 1]);
  });
});
