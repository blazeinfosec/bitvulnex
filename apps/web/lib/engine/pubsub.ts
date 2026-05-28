// Thin Redis-pub/sub wrapper so the ws-gateway can hear about order
// book / trade / private-channel changes the web app makes.

import { Redis } from "ioredis";
import { env } from "../env";

let pub: Redis | null = null;
function publisher(): Redis {
  if (!pub) {
    pub = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return pub;
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
