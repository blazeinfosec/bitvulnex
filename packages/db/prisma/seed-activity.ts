// Seasoned-exchange activity seed.
//
// The base seed (seed.ts) only creates users and the two market-maker
// balances, which leaves every product surface empty on a fresh stack —
// blank charts, empty order books, no deposits, no KYC queue, no tickets,
// no positions. This module fills the exchange with a realistic backlog
// of activity so the app reads like a running venue the moment it boots
// (and so the training-lab's planted vulnerabilities have real data to
// operate against).
//
// Design notes:
//   - Everything here is SYNTHETIC. No real PII, no real addresses, no
//     real keys. Personas are famous computer scientists (see seed.ts).
//   - The data is "innocent": it gives each surface (KYC review queue,
//     compliance cases, support tickets, order book, …) something to act
//     on, but it does NOT pre-stage any exploit payload. Trainees stage
//     their own attacks.
//   - Charts and the 24h market stats aggregate `Trade` rows over time
//     windows (see apps/web/app/api/v2/public/{chart,markets}), so the
//     price history is seeded as a random-walk series of Trade rows with
//     historical `executedAt` timestamps, dense in the recent past.
//   - Idempotent-ish: the whole block is guarded on an empty `trades`
//     table, so re-running `pnpm seed` against an already-seeded DB is a
//     no-op for activity. `docker-compose down -v` + up reseeds cleanly.

import type { PrismaClient, Prisma } from "@prisma/client";

// ── Deterministic PRNG (mulberry32) so re-seeds produce stable variety.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// USD reference prices (whole units). Used to size realistic balances.
const USD: Record<string, number> = {
  BTC: 67_000,
  ETH: 3_400,
  LTC: 78,
  DOGE: 0.12,
  USDT: 1,
  USDC: 1,
};

type PairCfg = {
  base: string;
  quote: string;
  seed: number;
  tick: number;
  min: number;
  sigma: number;
};

// Mirrors the migration-seeded trading_pairs + the market-maker's
// per-pair sigma / seed price constants.
const PAIRS: PairCfg[] = [
  { base: "BTC", quote: "USDT", seed: 67_000, tick: 0.01, min: 0.0001, sigma: 0.0005 },
  { base: "ETH", quote: "USDT", seed: 3_400, tick: 0.01, min: 0.001, sigma: 0.0008 },
  { base: "BTC", quote: "USDC", seed: 67_000, tick: 0.01, min: 0.0001, sigma: 0.0005 },
  { base: "ETH", quote: "BTC", seed: 0.05074, tick: 0.000001, min: 0.001, sigma: 0.0008 },
  { base: "LTC", quote: "USDT", seed: 78, tick: 0.01, min: 0.01, sigma: 0.0012 },
  { base: "LTC", quote: "BTC", seed: 0.001164, tick: 0.000001, min: 0.01, sigma: 0.0012 },
  { base: "DOGE", quote: "USDT", seed: 0.12, tick: 0.00001, min: 1, sigma: 0.002 },
  { base: "USDC", quote: "USDT", seed: 1.0001, tick: 0.0001, min: 1, sigma: 0.00005 },
];

const COUNTRIES = ["US", "GB", "DE", "FR", "BR", "JP", "CA", "SG"];

type SeedUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  kycTier: number;
};

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function uni(a: number, b: number, rng: () => number): number {
  return a + (b - a) * rng();
}

function roundTick(price: number, tick: number): number {
  return Math.round(price / tick) * tick;
}

// Chunked createMany so we never exceed driver parameter limits.
async function insertMany<T>(
  rows: T[],
  fn: (chunk: T[]) => Promise<unknown>,
  size = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

export async function seedActivity(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.trade.count();
  if (existing > 0) {
    console.log("activity seed: trades already present — skipping");
    return;
  }

  const rng = makeRng(0x9e3779b9);
  const now = Date.now();

  const all = (await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, role: true, kycTier: true },
  })) as SeedUser[];

  const byEmail = new Map(all.map((u) => [u.email, u]));
  const mmAlpha = byEmail.get("mm.alpha@bvbe.local");
  const mmBeta = byEmail.get("mm.beta@bvbe.local");
  const compliance = byEmail.get("compliance@bvbe.local");
  const support1 = byEmail.get("support1@bvbe.local");
  const support2 = byEmail.get("support2@bvbe.local");
  const admin = byEmail.get("admin@bvbe.local");
  if (!mmAlpha || !mmBeta) {
    console.log("activity seed: market-maker users missing — skipping");
    return;
  }

  // Regular customers: everyone who isn't a bot/staff account.
  const staffEmails = new Set([
    "mm.alpha@bvbe.local",
    "mm.beta@bvbe.local",
    "support1@bvbe.local",
    "support2@bvbe.local",
    "compliance@bvbe.local",
    "treasury@bvbe.local",
    "treasury2@bvbe.local",
    "treasury3@bvbe.local",
  ]);
  const customers = all.filter((u) => !staffEmails.has(u.email));

  await seedBalances(prisma, all, rng);
  await seedBitcoinAddresses(prisma, customers);
  await seedPriceHistory(prisma, mmAlpha.id, mmBeta.id, rng, now);
  await seedRestingBook(prisma, mmAlpha.id, mmBeta.id, rng);
  await seedDeposits(prisma, customers, rng, now);
  await seedWithdrawals(prisma, customers, rng, now);
  await seedKyc(prisma, customers, admin?.id ?? null, rng, now);
  await seedSupportTickets(prisma, customers, [support1, support2], rng, now);
  await seedLendingStaking(prisma, customers, rng, now);
  await seedOtc(prisma, customers, rng, now);
  await seedP2p(prisma, customers, rng, now);
  await seedMarginPositions(prisma, customers, rng, now);
  await seedComplianceCases(prisma, customers, compliance?.id ?? null, rng);
  await seedEquitySnapshots(prisma, customers, rng, now);
  await seedAuditLog(prisma, admin?.id ?? null, compliance?.id ?? null, customers, now);

  console.log(
    `activity seed: ${customers.length} customers populated across ${PAIRS.length} pairs`,
  );
}

// ── Balances ────────────────────────────────────────────────────────
// Give every non-bot user realistic spot holdings so account/admin/IDOR
// surfaces show real numbers. Sizing scales with KYC tier + persona.
async function seedBalances(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
): Promise<void> {
  // Rough target portfolio USD by tier.
  const targetUsd = (u: SeedUser): number => {
    if (u.email.startsWith("whale")) return uni(2_000_000, 8_000_000, rng);
    switch (u.kycTier) {
      case 3:
        return uni(40_000, 250_000, rng);
      case 2:
        return uni(4_000, 30_000, rng);
      case 1:
        return uni(150, 3_000, rng);
      default:
        return uni(0, 40, rng); // tier-0: dust or nothing
    }
  };

  const rows: Array<{
    userId: string;
    asset: string;
    amount: string;
    available: string;
  }> = [];

  for (const u of users) {
    // Market-maker accounts already hold seeded balances (seed.ts).
    if (u.email === "mm.alpha@bvbe.local" || u.email === "mm.beta@bvbe.local") {
      continue;
    }
    const total = targetUsd(u);
    if (total <= 0) continue;

    // Split the portfolio across a few assets. Everyone holds some USDT;
    // higher tiers spread into BTC/ETH and occasionally LTC/DOGE.
    const weights: Record<string, number> = { USDT: uni(0.2, 0.5, rng) };
    weights.BTC = uni(0.2, 0.5, rng);
    if (u.kycTier >= 1) weights.ETH = uni(0.05, 0.3, rng);
    if (u.kycTier >= 2 && rng() < 0.6) weights.LTC = uni(0.02, 0.12, rng);
    if (u.kycTier >= 2 && rng() < 0.4) weights.DOGE = uni(0.02, 0.1, rng);
    if (u.kycTier >= 3 && rng() < 0.5) weights.USDC = uni(0.05, 0.2, rng);

    const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [asset, w] of Object.entries(weights)) {
      const usd = (total * w) / wSum;
      const qty = usd / USD[asset]!;
      if (qty <= 0) continue;
      const dp = asset === "DOGE" || asset === "USDT" || asset === "USDC" ? 2 : 8;
      const amt = qty.toFixed(dp);
      rows.push({ userId: u.id, asset, amount: amt, available: amt });
    }
  }

  await insertMany(rows, (chunk) =>
    prisma.balance.createMany({ data: chunk, skipDuplicates: true }),
  );
}

// ── Deposit addresses ───────────────────────────────────────────────
async function seedBitcoinAddresses(
  prisma: PrismaClient,
  users: SeedUser[],
): Promise<void> {
  const rows = users.map((u, i) => ({
    userId: u.id,
    asset: "BTC",
    address: `bcrt1qseed${i.toString().padStart(6, "0")}xxxxxxxxxxxxxxxxxxxx`,
    derivationIndex: i,
  }));
  await insertMany(rows, (chunk) =>
    prisma.bitcoinAddress.createMany({ data: chunk, skipDuplicates: true }),
  );
}

// ── Price history (P1) ──────────────────────────────────────────────
// A random-walk series of Trade rows per pair with historical
// timestamps, dense in the recent past. Powers candlestick charts and
// the 24h market stats. Two "filled" MM orders per pair satisfy the
// Trade → Order FK; all of a pair's historical trades reference them.
async function seedPriceHistory(
  prisma: PrismaClient,
  alphaId: string,
  betaId: string,
  rng: () => number,
  now: number,
): Promise<void> {
  // Ages (ms before now) at descending order → ascending timestamps.
  const ages: number[] = [];
  for (let a = 30 * DAY; a > 10 * DAY; a -= 2 * HOUR) ages.push(a);
  for (let a = 10 * DAY; a > 1 * DAY; a -= 30 * 60_000) ages.push(a);
  for (let a = 1 * DAY; a > 2 * HOUR; a -= 5 * 60_000) ages.push(a);
  for (let a = 2 * HOUR; a >= 0; a -= 60_000) ages.push(a);

  for (const p of PAIRS) {
    const pair = `${p.base}/${p.quote}`;
    // One resting-shaped filled buy + filled sell to hang trades off of.
    const makerOrder = await prisma.order.create({
      data: {
        userId: alphaId,
        pair,
        side: "sell",
        type: "limit",
        price: p.seed.toString(),
        amount: (p.min * 1000).toString(),
        filled: (p.min * 1000).toString(),
        status: "filled",
        feeTier: "base",
      },
      select: { id: true },
    });
    const takerOrder = await prisma.order.create({
      data: {
        userId: betaId,
        pair,
        side: "buy",
        type: "market",
        price: null,
        amount: (p.min * 1000).toString(),
        filled: (p.min * 1000).toString(),
        status: "filled",
        feeTier: "base",
      },
      select: { id: true },
    });

    let price = p.seed;
    const trades: Array<{
      pair: string;
      takerOrderId: number;
      makerOrderId: number;
      takerUserId: string;
      makerUserId: string;
      price: string;
      amount: string;
      takerFeeBps: number;
      makerFeeBps: number;
      executedAt: Date;
    }> = [];

    for (const age of ages) {
      // Multiplicative random walk, mean-reverting toward seed so a long
      // series doesn't drift away from a believable level.
      const shock = 1 + (rng() - 0.5) * 2 * p.sigma * 6;
      const revert = 1 + (p.seed / price - 1) * 0.01;
      price = roundTick(Math.max(price * shock * revert, p.tick), p.tick);
      const amt = uni(p.min, p.min * 8, rng);
      const dp = p.base === "DOGE" ? 2 : 8;
      trades.push({
        pair,
        takerOrderId: takerOrder.id,
        makerOrderId: makerOrder.id,
        takerUserId: betaId,
        makerUserId: alphaId,
        price: price.toFixed(8),
        amount: amt.toFixed(dp),
        takerFeeBps: 0,
        makerFeeBps: 0,
        executedAt: new Date(now - age),
      });
    }

    await insertMany(trades, (chunk) =>
      prisma.trade.createMany({ data: chunk }),
    );
  }
}

// ── Resting order book ──────────────────────────────────────────────
// A 6-level book per pair around the seed price so the trade screen
// shows depth at cold start, before the market-maker worker's first
// tick (and when the worker isn't running at all).
async function seedRestingBook(
  prisma: PrismaClient,
  alphaId: string,
  betaId: string,
  rng: () => number,
): Promise<void> {
  const offsets = [0.0006, 0.0012, 0.0018, 0.0026, 0.0035, 0.0048];
  const rows: Array<{
    userId: string;
    pair: string;
    side: "buy" | "sell";
    type: "limit";
    price: string;
    amount: string;
    filled: string;
    status: "open";
    feeTier: string;
  }> = [];

  for (const p of PAIRS) {
    const pair = `${p.base}/${p.quote}`;
    offsets.forEach((off, i) => {
      const bid = roundTick(p.seed * (1 - off), p.tick);
      const ask = roundTick(p.seed * (1 + off), p.tick);
      const bidQty = uni(p.min * 5, p.min * 50, rng);
      const askQty = uni(p.min * 5, p.min * 50, rng);
      const dp = p.base === "DOGE" ? 2 : 8;
      rows.push({
        userId: i % 2 === 0 ? alphaId : betaId,
        pair,
        side: "buy",
        type: "limit",
        price: bid.toFixed(8),
        amount: bidQty.toFixed(dp),
        filled: "0",
        status: "open",
        feeTier: "base",
      });
      rows.push({
        userId: i % 2 === 0 ? betaId : alphaId,
        pair,
        side: "sell",
        type: "limit",
        price: ask.toFixed(8),
        amount: askQty.toFixed(dp),
        filled: "0",
        status: "open",
        feeTier: "base",
      });
    });
  }

  await prisma.order.createMany({ data: rows });
}

// ── Deposits ────────────────────────────────────────────────────────
async function seedDeposits(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const rows: Array<{
    userId: string;
    asset: string;
    address: string;
    txid: string;
    vout: number;
    amount: string;
    confirmations: number;
    status: "seen" | "confirming" | "credited" | "dropped";
    seenAt: Date;
    creditedAt: Date | null;
  }> = [];

  let n = 0;
  for (const u of users) {
    if (u.kycTier < 1) continue; // unverified users haven't funded
    const count = 1 + Math.floor(rng() * 4);
    for (let k = 0; k < count; k++) {
      const asset = pick(["BTC", "BTC", "ETH", "LTC"], rng);
      const amt = uni(0.01, asset === "BTC" ? 1.5 : 12, rng).toFixed(8);
      const ageMs = uni(HOUR, 25 * DAY, rng);
      // Most deposits credited; a few in-flight; the occasional drop.
      const roll = rng();
      let status: "seen" | "confirming" | "credited" | "dropped";
      let confs: number;
      let creditedAt: Date | null = null;
      if (roll < 0.8) {
        status = "credited";
        confs = 3 + Math.floor(rng() * 4);
        creditedAt = new Date(now - ageMs + HOUR);
      } else if (roll < 0.9) {
        status = "confirming";
        confs = 1;
      } else if (roll < 0.97) {
        status = "seen";
        confs = 0;
      } else {
        status = "dropped";
        confs = 0;
      }
      rows.push({
        userId: u.id,
        asset,
        address: `bcrt1qseed${users.indexOf(u).toString().padStart(6, "0")}xxxxxxxxxxxxxxxxxxxx`,
        txid: `seedtx${(n).toString(16).padStart(58, "0")}`,
        vout: 0,
        amount: amt,
        confirmations: confs,
        status,
        seenAt: new Date(now - ageMs),
        creditedAt,
      });
      n++;
    }
  }

  await insertMany(rows, (chunk) =>
    prisma.deposit.createMany({ data: chunk, skipDuplicates: true }),
  );
}

// ── Withdrawals ─────────────────────────────────────────────────────
async function seedWithdrawals(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const rows: Array<{
    userId: string;
    asset: string;
    amount: string;
    fee: string;
    destAddress: string;
    status:
      | "pending"
      | "broadcast"
      | "confirming"
      | "confirmed"
      | "rejected";
    txid: string | null;
    requestedAt: Date;
    broadcastAt: Date | null;
    confirmedAt: Date | null;
  }> = [];

  let n = 0;
  for (const u of users) {
    if (u.kycTier < 1 || rng() < 0.4) continue;
    const count = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      const asset = pick(["BTC", "BTC", "ETH", "LTC", "USDT"], rng);
      const amt = uni(0.005, asset === "BTC" ? 0.4 : 5, rng).toFixed(8);
      const ageMs = uni(HOUR, 20 * DAY, rng);
      const roll = rng();
      let status: "pending" | "broadcast" | "confirming" | "confirmed" | "rejected";
      let txid: string | null = null;
      let broadcastAt: Date | null = null;
      let confirmedAt: Date | null = null;
      if (roll < 0.7) {
        status = "confirmed";
        txid = `wtx${(n).toString(16).padStart(61, "0")}`;
        broadcastAt = new Date(now - ageMs + HOUR);
        confirmedAt = new Date(now - ageMs + 2 * HOUR);
      } else if (roll < 0.82) {
        status = "broadcast";
        txid = `wtx${(n).toString(16).padStart(61, "0")}`;
        broadcastAt = new Date(now - ageMs + HOUR);
      } else if (roll < 0.92) {
        status = "pending";
      } else if (roll < 0.97) {
        status = "confirming";
        txid = `wtx${(n).toString(16).padStart(61, "0")}`;
        broadcastAt = new Date(now - ageMs + HOUR);
      } else {
        status = "rejected";
      }
      rows.push({
        userId: u.id,
        asset,
        amount: amt,
        fee: asset === "BTC" ? "0.00010000" : "0.00100000",
        destAddress: `bcrt1qdest${(n).toString(16).padStart(8, "0")}xxxxxxxxxxxxxxxxx`,
        status,
        txid,
        requestedAt: new Date(now - ageMs),
        broadcastAt,
        confirmedAt,
      });
      n++;
    }
  }

  await insertMany(rows, (chunk) =>
    prisma.withdrawal.createMany({ data: chunk }),
  );
}

// ── KYC (profiles + docs + review backlog) ──────────────────────────
async function seedKyc(
  prisma: PrismaClient,
  users: SeedUser[],
  reviewerId: string | null,
  rng: () => number,
  now: number,
): Promise<void> {
  const profiles: Prisma.KycProfileCreateManyInput[] = [];
  const docs: Prisma.KycDocumentCreateManyInput[] = [];

  users.forEach((u, idx) => {
    const name = u.displayName ?? "Lab User";
    const country = pick(COUNTRIES, rng);
    const birthYear = 1965 + Math.floor(rng() * 35);
    const dob = new Date(Date.UTC(birthYear, Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)));
    const base = {
      userId: u.id,
      legalName: name,
      dateOfBirth: dob,
      country,
      addressLine: `${1 + Math.floor(rng() * 998)} Example Street`,
      city: pick(["Springfield", "Metropolis", "Gotham", "Rivertown", "Lakeside"], rng),
      postalCode: (10000 + Math.floor(rng() * 89999)).toString(),
    };

    if (u.kycTier >= 1) {
      // Verified: approved profile with an ID + address doc on file.
      const submittedAt = new Date(now - uni(5 * DAY, 40 * DAY, rng));
      profiles.push({
        ...base,
        status: "approved",
        submittedAt,
        reviewedAt: new Date(submittedAt.getTime() + uni(HOUR, 3 * DAY, rng)),
        reviewedById: reviewerId,
      });
      docs.push(idDoc(u.id, idx, submittedAt));
      docs.push(addrDoc(u.id, idx, submittedAt));
    } else if (rng() < 0.5) {
      // A slice of tier-0 users are mid-review → populates the admin
      // KYC queue with genuine pending submissions.
      const submittedAt = new Date(now - uni(HOUR, 4 * DAY, rng));
      profiles.push({ ...base, status: "pending", submittedAt });
      docs.push(idDoc(u.id, idx, submittedAt));
      if (rng() < 0.7) docs.push(addrDoc(u.id, idx, submittedAt));
    } else {
      // The rest are incomplete (started but never submitted docs).
      profiles.push({ ...base, status: "incomplete" });
    }
  });

  await insertMany(profiles, (chunk) =>
    prisma.kycProfile.createMany({ data: chunk, skipDuplicates: true }),
  );
  await insertMany(docs, (chunk) =>
    prisma.kycDocument.createMany({ data: chunk }),
  );
}

function idDoc(userId: string, idx: number, at: Date): Prisma.KycDocumentCreateManyInput {
  return {
    userId,
    type: "passport",
    filename: `passport-${idx}.jpg`,
    storedPath: `uploads/${userId}/passport-${idx}.jpg`,
    mimeType: "image/jpeg",
    size: 180_000 + idx * 137,
    source: "upload",
    createdAt: at,
  };
}

function addrDoc(userId: string, idx: number, at: Date): Prisma.KycDocumentCreateManyInput {
  return {
    userId,
    type: "address_proof",
    filename: `utility-bill-${idx}.pdf`,
    storedPath: `uploads/${userId}/utility-bill-${idx}.pdf`,
    mimeType: "application/pdf",
    size: 240_000 + idx * 211,
    source: "upload",
    createdAt: at,
  };
}

// ── Support tickets ─────────────────────────────────────────────────
const TICKET_SUBJECTS: Array<{
  subject: string;
  category: Prisma.SupportTicketCreateManyInput["category"];
  body: string;
}> = [
  { subject: "Deposit not showing up", category: "deposit", body: "I sent BTC to my deposit address about an hour ago but my balance still shows zero. Can you check?" },
  { subject: "Withdrawal stuck in pending", category: "withdrawal", body: "My withdrawal has been pending for a while. Transaction id is in my account. Is something wrong?" },
  { subject: "Cannot enable 2FA", category: "security", body: "The 2FA setup page shows a QR code but my authenticator app rejects the codes. What am I doing wrong?" },
  { subject: "KYC review taking long", category: "kyc", body: "I submitted my documents three days ago and my tier is still 0. How long does review usually take?" },
  { subject: "Order didn't fill at expected price", category: "trading", body: "I placed a limit order and it filled at a different price than I set. Can you explain how matching works?" },
  { subject: "How do I change my email?", category: "account", body: "I need to update the email on my account. I don't see the option in settings." },
  { subject: "General question about fees", category: "general", body: "Where can I see the fee schedule for spot trading and withdrawals?" },
];

async function seedSupportTickets(
  prisma: PrismaClient,
  users: SeedUser[],
  agents: Array<SeedUser | undefined>,
  rng: () => number,
  now: number,
): Promise<void> {
  const agentList = agents.filter((a): a is SeedUser => Boolean(a));
  const tickets: Prisma.SupportTicketCreateManyInput[] = [];
  const messages: Prisma.SupportTicketMessageCreateManyInput[] = [];

  let t = 0;
  for (const u of users) {
    if (rng() < 0.7) continue; // ~30% of users have opened a ticket
    const nTickets = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < nTickets; k++) {
      const tmpl = pick(TICKET_SUBJECTS, rng);
      const id = `seed_tkt_${t.toString().padStart(4, "0")}`;
      const createdAt = new Date(now - uni(HOUR, 25 * DAY, rng));
      const roll = rng();
      const status =
        roll < 0.35 ? "resolved" : roll < 0.55 ? "closed" : roll < 0.8 ? "awaiting_agent" : "open";
      tickets.push({
        id,
        userId: u.id,
        category: tmpl.category,
        subject: tmpl.subject,
        status,
        createdAt,
        closedAt: status === "closed" || status === "resolved" ? new Date(createdAt.getTime() + uni(HOUR, 5 * DAY, rng)) : null,
      });
      // Opening message from the user.
      messages.push({
        id: `${id}_m0`,
        ticketId: id,
        authorId: u.id,
        isAgent: false,
        bodyMd: tmpl.body,
        createdAt,
      });
      // Agent reply for tickets that got attention.
      if (status !== "open" && agentList.length > 0) {
        const agent = pick(agentList, rng);
        messages.push({
          id: `${id}_m1`,
          ticketId: id,
          authorId: agent.id,
          isAgent: true,
          bodyMd: "Thanks for reaching out — I'm looking into this now and will follow up shortly.",
          createdAt: new Date(createdAt.getTime() + uni(600_000, 6 * HOUR, rng)),
        });
      }
      t++;
    }
  }

  await insertMany(tickets, (chunk) =>
    prisma.supportTicket.createMany({ data: chunk }),
  );
  await insertMany(messages, (chunk) =>
    prisma.supportTicketMessage.createMany({ data: chunk }),
  );
}

// ── Lending + staking positions ─────────────────────────────────────
async function seedLendingStaking(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const lending: Prisma.LendingPositionCreateManyInput[] = [];
  const staking: Prisma.StakingPositionCreateManyInput[] = [];
  const supplied: Record<string, number> = { BTC: 0, USDT: 0, ETH: 0 };
  const borrowed: Record<string, number> = { BTC: 0, USDT: 0, ETH: 0 };

  for (const u of users) {
    if (u.kycTier < 1) continue;
    // Supply into a pool.
    if (rng() < 0.45) {
      const pool = pick(["BTC", "USDT", "ETH"], rng);
      const usd = uni(500, u.kycTier >= 3 ? 80_000 : 8_000, rng);
      const principal = usd / USD[pool]!;
      const openedAt = new Date(now - uni(2 * DAY, 40 * DAY, rng));
      lending.push({
        userId: u.id,
        pool,
        side: "supply",
        principal: principal.toFixed(8),
        accrued: (principal * uni(0.0005, 0.02, rng)).toFixed(8),
        openedAt,
        status: "open",
      });
      supplied[pool] = (supplied[pool] ?? 0) + principal;
    }
    // A smaller set borrow against collateral.
    if (u.kycTier >= 2 && rng() < 0.2) {
      const pool = pick(["USDT", "BTC"], rng);
      const usd = uni(1_000, 20_000, rng);
      const principal = usd / USD[pool]!;
      const collAsset = pool === "USDT" ? "BTC" : "USDT";
      const collateral = (usd * 1.6) / USD[collAsset]!;
      lending.push({
        userId: u.id,
        pool,
        side: "borrow",
        principal: principal.toFixed(8),
        accrued: (principal * uni(0.001, 0.03, rng)).toFixed(8),
        collateralAsset: collAsset,
        collateral: collateral.toFixed(8),
        openedAt: new Date(now - uni(2 * DAY, 30 * DAY, rng)),
        status: "open",
      });
      borrowed[pool] = (borrowed[pool] ?? 0) + principal;
    }
    // Staking.
    if (rng() < 0.35) {
      const asset = pick(["ETH", "LTC"], rng);
      const usd = uni(300, u.kycTier >= 3 ? 40_000 : 5_000, rng);
      const principal = usd / USD[asset]!;
      staking.push({
        userId: u.id,
        asset,
        principal: principal.toFixed(8),
        startedAt: new Date(now - uni(2 * DAY, 30 * DAY, rng)),
        status: "active",
      });
    }
  }

  await insertMany(lending, (chunk) =>
    prisma.lendingPosition.createMany({ data: chunk }),
  );
  await insertMany(staking, (chunk) =>
    prisma.stakingPosition.createMany({ data: chunk }),
  );

  // Reflect the seeded principal in each pool's aggregate so the pools
  // page shows real TVL/utilization and the yield worker has a non-zero
  // supply set to distribute across.
  for (const asset of Object.keys(supplied)) {
    const sup = supplied[asset] ?? 0;
    const bor = borrowed[asset] ?? 0;
    if (sup === 0 && bor === 0) continue;
    await prisma.lendingPool.updateMany({
      where: { asset },
      data: {
        supplied: sup.toFixed(8),
        // Keep utilization < 100%: cap borrowed at 80% of supply.
        borrowed: Math.min(bor, sup * 0.8).toFixed(8),
      },
    });
  }
}

// ── OTC desk tickets ────────────────────────────────────────────────
async function seedOtc(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const rows: Prisma.OtcTicketCreateManyInput[] = [];
  for (const u of users) {
    if (u.kycTier < 2 || rng() < 0.6) continue;
    const pair = pick(["BTC/USDT", "ETH/USDT"], rng);
    const seed = pair.startsWith("BTC") ? 67_000 : 3_400;
    const side = rng() < 0.5 ? "buy" : "sell";
    const amount = uni(0.5, 8, rng);
    const roll = rng();
    if (roll < 0.6) {
      const ageMs = uni(HOUR, 20 * DAY, rng);
      rows.push({
        userId: u.id,
        pair,
        side,
        amount: amount.toFixed(8),
        quotedPrice: (seed * uni(0.998, 1.002, rng)).toFixed(8),
        status: "filled",
        quoteExpiresAt: new Date(now - ageMs + 30_000),
        filledAt: new Date(now - ageMs),
        feeBps: 25,
        createdAt: new Date(now - ageMs),
      });
    } else if (roll < 0.85) {
      rows.push({
        userId: u.id,
        pair,
        side,
        amount: amount.toFixed(8),
        quotedPrice: (seed * uni(0.998, 1.002, rng)).toFixed(8),
        status: "expired",
        quoteExpiresAt: new Date(now - uni(HOUR, 5 * DAY, rng)),
        createdAt: new Date(now - uni(HOUR, 5 * DAY, rng)),
      });
    } else {
      // A fresh live quote.
      rows.push({
        userId: u.id,
        pair,
        side,
        amount: amount.toFixed(8),
        quotedPrice: (seed * uni(0.998, 1.002, rng)).toFixed(8),
        status: "quoted",
        quoteExpiresAt: new Date(now + 25_000),
        createdAt: new Date(now - 5_000),
      });
    }
  }
  await insertMany(rows, (chunk) =>
    prisma.otcTicket.createMany({ data: chunk }),
  );
}

// ── P2P offers + trades ─────────────────────────────────────────────
async function seedP2p(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const methods = ["SEPA", "Wise", "Zelle", "Revolut", "Bank transfer"];
  const offers: Prisma.P2POfferCreateManyInput[] = [];
  const trades: Prisma.P2PTradeCreateManyInput[] = [];
  const makers = users.filter((u) => u.kycTier >= 1);

  let o = 0;
  for (const u of makers) {
    if (rng() < 0.8) continue; // ~20% of verified users run a P2P offer
    const id = `seed_p2p_${o.toString().padStart(4, "0")}`;
    const asset = pick(["BTC", "ETH", "LTC"], rng);
    const side = rng() < 0.5 ? "buy" : "sell";
    const price = USD[asset]! * uni(0.99, 1.03, rng);
    offers.push({
      id,
      userId: u.id,
      side,
      asset,
      amount: uni(0.05, 2, rng).toFixed(8),
      price: price.toFixed(2),
      payMethod: pick(methods, rng),
      status: rng() < 0.85 ? "open" : "paused",
      createdAt: new Date(now - uni(HOUR, 20 * DAY, rng)),
    });

    // Occasionally attach a trade against the offer with a counterparty.
    if (rng() < 0.4) {
      const counter = pick(makers, rng);
      if (counter.id !== u.id) {
        const roll = rng();
        const status =
          roll < 0.5 ? "released" : roll < 0.75 ? "pending_payment" : roll < 0.9 ? "paid" : "disputed";
        const createdAt = new Date(now - uni(HOUR, 10 * DAY, rng));
        trades.push({
          id: `${id}_t0`,
          offerId: id,
          buyerUserId: side === "sell" ? counter.id : u.id,
          sellerUserId: side === "sell" ? u.id : counter.id,
          amount: uni(0.02, 0.5, rng).toFixed(8),
          price: price.toFixed(2),
          asset,
          status,
          createdAt,
          releasedAt: status === "released" ? new Date(createdAt.getTime() + uni(HOUR, DAY, rng)) : null,
          disputedAt: status === "disputed" ? new Date(createdAt.getTime() + uni(HOUR, DAY, rng)) : null,
        });
      }
    }
    o++;
  }

  await insertMany(offers, (chunk) =>
    prisma.p2POffer.createMany({ data: chunk }),
  );
  await insertMany(trades, (chunk) =>
    prisma.p2PTrade.createMany({ data: chunk }),
  );
}

// ── Margin positions ────────────────────────────────────────────────
async function seedMarginPositions(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const rows: Prisma.MarginPositionCreateManyInput[] = [];
  for (const u of users) {
    if (u.kycTier < 2 || rng() < 0.6) continue;
    const pair = pick(["BTC/USDT", "ETH/USDT"], rng);
    const seed = pair.startsWith("BTC") ? 67_000 : 3_400;
    const side = rng() < 0.5 ? "long" : "short";
    const leverage = pick([2, 3, 5, 10], rng);
    const entry = seed * uni(0.95, 1.05, rng);
    const notionalUsd = uni(2_000, u.kycTier >= 3 ? 60_000 : 15_000, rng);
    const size = notionalUsd / entry;
    const collateral = notionalUsd / leverage; // in quote (USDT)
    // Maintenance-margin liquidation price (~ entry adjusted by 1/lev).
    const liq =
      side === "long" ? entry * (1 - 0.9 / leverage) : entry * (1 + 0.9 / leverage);
    rows.push({
      userId: u.id,
      pair,
      side,
      size: size.toFixed(8),
      entryPrice: entry.toFixed(8),
      leverage,
      collateralAsset: "USDT",
      collateral: collateral.toFixed(8),
      liquidationPrice: liq.toFixed(8),
      status: "open",
      openedAt: new Date(now - uni(HOUR, 15 * DAY, rng)),
    });
  }
  await insertMany(rows, (chunk) =>
    prisma.marginPosition.createMany({ data: chunk }),
  );
}

// ── Compliance cases ────────────────────────────────────────────────
async function seedComplianceCases(
  prisma: PrismaClient,
  users: SeedUser[],
  openedById: string | null,
  rng: () => number,
): Promise<void> {
  const notes = [
    "Flagged by transaction-monitoring: rapid deposit/withdraw cycling.",
    "Manual review — velocity of internal transfers exceeds tier norm.",
    "Sanctions-list name similarity requires analyst confirmation.",
    "Structuring pattern: multiple sub-threshold withdrawals.",
    "Routine enhanced-due-diligence review for high-tier account.",
  ];
  const rows: Prisma.ComplianceCaseCreateManyInput[] = [];
  for (const u of users) {
    if (rng() < 0.9) continue; // ~10% of users have a case
    const roll = rng();
    const status =
      roll < 0.4 ? "open" : roll < 0.7 ? "in_review" : roll < 0.85 ? "escalated" : roll < 0.95 ? "resolved" : "dismissed";
    rows.push({
      subjectUserId: u.id,
      openedById,
      status,
      notes: pick(notes, rng),
    });
  }
  await insertMany(rows, (chunk) =>
    prisma.complianceCase.createMany({ data: chunk }),
  );
}

// ── Equity snapshots (dashboard curve) ──────────────────────────────
async function seedEquitySnapshots(
  prisma: PrismaClient,
  users: SeedUser[],
  rng: () => number,
  now: number,
): Promise<void> {
  const rows: Prisma.EquitySnapshotCreateManyInput[] = [];
  for (const u of users) {
    if (u.kycTier < 1) continue;
    // Approximate today's equity from tier, then walk it backwards 30d.
    let equity =
      u.email.startsWith("whale")
        ? uni(2_000_000, 8_000_000, rng)
        : u.kycTier === 3
          ? uni(40_000, 250_000, rng)
          : u.kycTier === 2
            ? uni(4_000, 30_000, rng)
            : uni(150, 3_000, rng);
    for (let d = 0; d <= 30; d++) {
      const day = new Date(now - d * DAY);
      day.setUTCHours(0, 0, 0, 0);
      rows.push({
        userId: u.id,
        date: day,
        totalUsd: equity.toFixed(8),
      });
      // Walk backwards with small daily variation.
      equity = equity / (1 + (rng() - 0.5) * 0.05);
    }
  }
  await insertMany(rows, (chunk) =>
    prisma.equitySnapshot.createMany({ data: chunk, skipDuplicates: true }),
  );
}

// ── Admin audit log ─────────────────────────────────────────────────
async function seedAuditLog(
  prisma: PrismaClient,
  adminId: string | null,
  complianceId: string | null,
  users: SeedUser[],
  now: number,
): Promise<void> {
  if (!adminId) return;
  const rows: Prisma.AdminAuditLogCreateManyInput[] = [];
  const sample = users.slice(0, 8);
  sample.forEach((u, i) => {
    rows.push({
      actorUserId: adminId,
      action: "kyc.approve",
      targetType: "user",
      targetId: u.id,
      metadata: { tier: u.kycTier },
      createdAt: new Date(now - i * DAY - HOUR),
    });
  });
  if (complianceId) {
    sample.slice(0, 3).forEach((u, i) => {
      rows.push({
        actorUserId: complianceId,
        action: "compliance.open_case",
        targetType: "user",
        targetId: u.id,
        metadata: { reason: "monitoring_alert" },
        createdAt: new Date(now - i * DAY - 2 * HOUR),
      });
    });
  }
  await prisma.adminAuditLog.createMany({ data: rows });
}
