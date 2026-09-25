// Thin Redis-pub/sub wrapper so the ws-gateway can hear about order
// book / trade / private-channel changes the web app makes. The
// publisher is anchored to globalThis so route-segment bundle
// duplication + HMR don't leak a fresh Redis connection per reload.
// Same pattern as openapi-registry and the TOTP-ticket store.

import { Redis } from "ioredis";
import { env } from "../env";
import { getGlobalStore } from "../global-store";

function publisher(): Redis {
  return getGlobalStore(
    "engine.pubsub.redis",
    () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }),
  );
}

export async function publishBookUpdate(pair: string): Promise<void> {
  await publisher().publish(
    `book:${pair}`,
    JSON.stringify({ kind: "book_update", pair, at: new Date().toISOString() }),
  );
}

export type PublishedTrade = {
  id: number;
  price: string;
  amount: string;
  executedAt: Date;
};

// Same envelope the worker's market-maker publishes, so the client's
// RecentTrade consumer handles both sources:
// {kind:"trade", pair, trade:{id, price, size, executedAt, takerSide}}.
export async function publishTrade(
  pair: string,
  trade: PublishedTrade,
  takerSide: "buy" | "sell",
): Promise<void> {
  const price = Number(trade.price);
  const size = Number(trade.amount);
  await publisher().publish(
    `trades:${pair}`,
    JSON.stringify({
      kind: "trade",
      pair,
      trade: {
        id: trade.id,
        price: Number.isFinite(price) ? price : 0,
        size: Number.isFinite(size) ? size : 0,
        executedAt: trade.executedAt.toISOString(),
        takerSide,
      },
      at: new Date().toISOString(),
    }),
  );
}

export async function publishUserUpdate(userId: string): Promise<void> {
  await publisher().publish(
    `private:${userId}`,
    JSON.stringify({ kind: "user_update", at: new Date().toISOString() }),
  );
}
