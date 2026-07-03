// Ambient activity simulator.
//
// The market-maker tick keeps the order book and price feed alive, but
// the rest of the exchange (deposits arriving, support tickets opening,
// compliance queue moving) is otherwise static between trainee actions.
// This job injects a low rate of realistic non-trading activity so
// admin dashboards, activity feeds, and queue counts visibly move during
// a lab session — the way a real venue is never quite idle.
//
// Deliberately scoped to LEDGER-SAFE signals:
//   - credited deposits (new external money in → balance increment, the
//     same shape the deposit-watcher produces on a real credit);
//   - support tickets (ledger-neutral);
//   - compliance cases and admin audit entries (ledger-neutral).
// It does NOT place or match customer orders — trading liveness is the
// market-maker's job, and driving the matching engine from here would
// duplicate it and risk balance drift on real customer accounts.
//
// Gated by ACTIVITY_SIM_ENABLED (default on); set to "false" to freeze
// the exchange for a deterministic demo.

import { Prisma, prisma } from "@bvbe/db";

const D = (v: string | number) => new Prisma.Decimal(v);

export type ActivitySimDb = Pick<
  typeof prisma,
  | "user"
  | "deposit"
  | "balance"
  | "supportTicket"
  | "supportTicketMessage"
  | "complianceCase"
  | "adminAuditLog"
  | "$transaction"
>;

const DEPOSIT_ASSETS = ["BTC", "BTC", "ETH", "LTC"];

const TICKET_TEMPLATES: Array<{
  subject: string;
  category: Prisma.SupportTicketCreateInput["category"];
  body: string;
}> = [
  { subject: "Deposit not credited yet", category: "deposit", body: "I sent a deposit a little while ago and it hasn't shown up. Can you check the status?" },
  { subject: "Question about withdrawal fees", category: "withdrawal", body: "How is the network fee for withdrawals calculated? It looks higher than I expected." },
  { subject: "2FA reset request", category: "security", body: "I lost access to my authenticator app and need to reset 2FA on my account." },
  { subject: "KYC document rejected", category: "kyc", body: "My address proof was rejected. What format do you accept for utility bills?" },
  { subject: "Limit order behaviour", category: "trading", body: "My limit order partially filled and then stopped. Why didn't the rest execute?" },
];

const CASE_NOTES = [
  "Auto-flagged: deposit/withdraw cycling above tier baseline.",
  "Velocity alert on internal transfers — analyst review queued.",
  "Name-similarity hit against watchlist; needs confirmation.",
];

function chance(p: number, rng: () => number): boolean {
  return rng() < p;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

async function pickCustomer(
  db: ActivitySimDb,
  rng: () => number,
): Promise<{ id: string } | null> {
  // A cheap random sample: count verified customers, skip a random
  // offset, take one. Excludes bot/market-maker accounts by email.
  const candidates = await db.user.findMany({
    where: {
      role: "user",
      kycTier: { gte: 1 },
      NOT: { email: { startsWith: "mm." } },
    },
    select: { id: true },
    take: 200,
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

/**
 * Run one ambient-activity tick. Returns the list of actions performed
 * (for logging / tests). Each action fires probabilistically so the
 * stream reads as irregular real traffic rather than a metronome.
 */
export async function simulateActivityTick(
  db: ActivitySimDb = prisma,
  rng: () => number = Math.random,
  now: number = Date.now(),
): Promise<{ actions: string[] }> {
  const actions: string[] = [];

  // A deposit lands most ticks — the most visible "the exchange is
  // alive" signal (balances tick up, deposits queue grows).
  if (chance(0.8, rng)) {
    const user = await pickCustomer(db, rng);
    if (user) {
      const asset = pick(DEPOSIT_ASSETS, rng);
      const amt = (0.01 + rng() * (asset === "BTC" ? 0.5 : 6)).toFixed(8);
      // Wide, tick-unique txid: ms clock + two random segments, so two
      // ticks (or two deposits in one tick) can't collide on the
      // (txid, vout) unique constraint.
      const rand = () => Math.floor(rng() * 1e9).toString(16);
      const txid = `simtx${Math.floor(now).toString(16)}${rand()}${rand()}`
        .padEnd(64, "0")
        .slice(0, 64);
      // Credit the deposit and bump the balance atomically so a mid-way
      // failure can't leave a credited row without its balance bump.
      await db.$transaction([
        db.deposit.create({
          data: {
            userId: user.id,
            asset,
            address: `bcrt1qsim${rand()}`.padEnd(42, "x").slice(0, 42),
            txid,
            vout: 0,
            amount: D(amt),
            confirmations: 3,
            status: "credited",
            creditedAt: new Date(now),
          },
        }),
        db.balance.upsert({
          where: { userId_asset: { userId: user.id, asset } },
          create: { userId: user.id, asset, amount: D(amt), available: D(amt) },
          update: {
            amount: { increment: D(amt) },
            available: { increment: D(amt) },
          },
        }),
      ]);
      actions.push(`deposit:${asset}`);
    }
  }

  // Occasionally a customer opens a support ticket.
  if (chance(0.25, rng)) {
    const user = await pickCustomer(db, rng);
    if (user) {
      const tmpl = pick(TICKET_TEMPLATES, rng);
      const ticket = await db.supportTicket.create({
        data: {
          userId: user.id,
          category: tmpl.category,
          subject: tmpl.subject,
          status: "open",
        },
        select: { id: true },
      });
      await db.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: user.id,
          isAgent: false,
          bodyMd: tmpl.body,
        },
      });
      actions.push("ticket");
    }
  }

  // Rarely, the monitoring system opens a compliance case.
  if (chance(0.08, rng)) {
    const user = await pickCustomer(db, rng);
    if (user) {
      await db.complianceCase.create({
        data: {
          subjectUserId: user.id,
          status: "open",
          notes: pick(CASE_NOTES, rng),
        },
      });
      actions.push("compliance-case");
    }
  }

  return { actions };
}
