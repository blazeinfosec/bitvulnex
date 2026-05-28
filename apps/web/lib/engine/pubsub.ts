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

export async function publishTrade(
  pair: string,
  price: string,
  amount: string,
): Promise<void> {
  await publisher().publish(
    `trades:${pair}`,
    JSON.stringify({ kind: "trade", pair, price, amount, at: new Date().toISOString() }),
  );
}

export async function publishUserUpdate(userId: string): Promise<void> {
  await publisher().publish(
    `private:${userId}`,
    JSON.stringify({ kind: "user_update", at: new Date().toISOString() }),
  );
}
