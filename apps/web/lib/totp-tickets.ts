// Short-lived TOTP login tickets, shared across the web replica pool.
//
// A ticket is minted by POST /api/v2/auth/login and redeemed by
// POST /api/v2/auth/login/totp. Behind nginx those two requests are
// round-robined across the `web-api` replicas, so the store MUST be
// shared — a per-process Map (the old approach) only works at a single
// replica and otherwise rejects the correct 2FA code ~(N-1)/N of the
// time. Redis (already used by lib/engine/pubsub.ts) is that shared store.

import { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { getGlobalStore } from "@/lib/global-store";

const TICKET_TTL_MS = 5 * 60 * 1000;

// One command connection for the process, anchored to globalThis so
// route-segment bundle duplication + HMR don't leak a socket per reload.
// Kept separate from the pubsub connection, which may enter subscriber
// mode and can't run ordinary commands.
function redis(): Redis {
  return getGlobalStore(
    "totpTickets.redis",
    () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }),
  );
}

const ticketKey = (ticket: string) => `totp:ticket:${ticket}`;

export async function mintTotpTicket(userId: string): Promise<string> {
  const ticket = randomBytes(24).toString("base64url");
  await redis().set(ticketKey(ticket), userId, "PX", TICKET_TTL_MS);
  return ticket;
}

// Atomic read-and-delete (GETDEL) so a ticket is single-use even under a
// race. Returns null when the ticket is unknown or has expired (Redis
// evicts it on TTL, so no manual expiry check is needed).
export async function consumeTotpTicket(ticket: string): Promise<string | null> {
  return redis().getdel(ticketKey(ticket));
}
