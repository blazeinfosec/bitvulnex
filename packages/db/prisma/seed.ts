import { PrismaClient, type Role } from "@prisma/client";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { seedActivity } from "./seed-activity";

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const FIRST = [
  "Ada", "Linus", "Grace", "Donald", "Margaret", "Edsger", "Barbara", "Tim",
  "Brian", "Ken", "Brendan", "Anita", "Radia", "Vint", "Hedy", "Alan",
  "Claude", "Niklaus", "Bjarne", "James", "Dennis", "Guido", "Yukihiro",
  "Audrey", "Frances", "Karen", "Adele", "Jeanette", "Joan", "Sophie",
];
const LAST = [
  "Lovelace", "Torvalds", "Hopper", "Knuth", "Hamilton", "Dijkstra", "Liskov",
  "Berners-Lee", "Kernighan", "Thompson", "Eich", "Borg", "Perlman", "Cerf",
  "Lamarr", "Turing", "Shannon", "Wirth", "Stroustrup", "Gosling", "Ritchie",
  "Rossum", "Matsumoto", "Tang", "Allen", "Sparck-Jones", "Goldberg",
  "Wing", "Clarke", "Wilkes",
];

type SeedUser = {
  email: string;
  displayName: string;
  password: string;
  role: Role;
  kycTier: number;
  emailVerified: boolean;
};

function det(i: number, n: number): number {
  // Deterministic pseudo-random for stable seeds across re-runs.
  // Knuth multiplicative hash; modulo n picks the bucket.
  return Math.abs((i + 1) * 2654435761) % n;
}

function buildUsers(): SeedUser[] {
  const users: SeedUser[] = [
    {
      email: "admin@bvbe.local",
      displayName: "Admin",
      password: "tT3KuqASMnwV8ZeWHRJAgd7IpIVM",
      role: "admin",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "treasury@bvbe.local",
      displayName: "Treasury Ops",
      password: "fjG4898@hf9sbbajskKwkd",
      role: "treasury",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "treasury2@bvbe.local",
      displayName: "Treasury Ops B",
      password: "change-me-after-first-login",
      role: "treasury",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "treasury3@bvbe.local",
      displayName: "Treasury Ops C",
      password: "CXwVuc6AsiDeV5iyskUh806whUVP",
      role: "treasury",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "support1@bvbe.local",
      displayName: "Support Agent A",
      password: "Hbaks52#jdh9nAth@nJa",
      role: "support",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "support2@bvbe.local",
      displayName: "Support Agent B",
      password: "change-me-after-first-login",
      role: "support",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "compliance@bvbe.local",
      displayName: "Compliance Officer",
      password: "ksdjf93jhfV@fjKlq746",
      role: "compliance",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "mm.alpha@bvbe.local",
      displayName: "MM Alpha",
      password: "iAQGIseS48R6EREZ2zsZk5KHKKd5",
      role: "user",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "mm.beta@bvbe.local",
      displayName: "MM Beta",
      password: "change-me-after-first-login",
      role: "user",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "whale1@example.test",
      displayName: "High Roller Holdings",
      password: "Xq2yXgRFuV9FIJLQqCRGQ4AOaVki",
      role: "user",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "whale2@example.test",
      displayName: "Cetacean Capital",
      password: "Sup3rLong-Whale-Pass-002",
      role: "user",
      kycTier: 3,
      emailVerified: true,
    },
  ];

  const tiers: Array<{ tier: number; verified: boolean; count: number }> = [
    { tier: 0, verified: false, count: 10 },
    { tier: 1, verified: true, count: 15 },
    { tier: 2, verified: true, count: 12 },
    { tier: 3, verified: true, count: 6 },
  ];

  let i = 0;
  for (const t of tiers) {
    for (let k = 0; k < t.count; k++) {
      const first = FIRST[det(i, FIRST.length)] as string;
      const last = LAST[det(i + 17, LAST.length)] as string;
      users.push({
        email: `${first.toLowerCase()}.${last.toLowerCase()}.${i}@example.test`,
        displayName: `${first} ${last}`,
        password: `lab-password-${i}`,
        role: "user",
        kycTier: t.tier,
        emailVerified: t.verified,
      });
      i++;
    }
  }
  return users;
}

// Pre-funded spot balances for the market-maker bot. Phase-10 slice 2
// uses these two accounts to write synthetic trades against each other
// every 2s; the worker job needs both sides of every supported pair to
// have plenty of headroom for the lab session.
const MM_BALANCES: Record<string, string> = {
  BTC: "10000",
  ETH: "100000",
  LTC: "100000",
  DOGE: "10000000",
  USDT: "1000000000",
  USDC: "1000000000",
};

async function seedMarketMakerBalances() {
  const mmEmails = ["mm.alpha@bvbe.local", "mm.beta@bvbe.local"];
  for (const email of mmEmails) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) continue;
    for (const [asset, amt] of Object.entries(MM_BALANCES)) {
      await prisma.balance.upsert({
        where: { userId_asset: { userId: u.id, asset } },
        update: {},
        create: {
          userId: u.id,
          asset,
          amount: amt,
          available: amt,
          locked: "0",
        },
      });
    }
  }
}

// Regular-user accounts we populate with owned objects so cross-account
// BOLA/IDOR testing has concrete targets (order ids, withdrawal ids, KYC doc
// storedPath, ticket ids). Each account owns DIFFERENT objects, so fetching one
// user's object under another user's session is a real cross-account test.
const USER_OBJECT_ACCOUNTS = [
  "whale1@example.test",
  "whale2@example.test",
  "mm.alpha@bvbe.local",
  "mm.beta@bvbe.local",
];

// Populate per-user objects for the accounts above. STATE ONLY — this creates
// no vulnerability and touches no planted flaw; it gives the exchange realistic
// per-account data (funds, orders, withdrawals, KYC docs, tickets) so an
// authenticated user actually owns objects. Without it, fresh accounts expose
// only their user id and every cross-account IDOR probe dead-ends on a
// non-existent object. All data is synthetic (regtest addresses, lab paths).
//
// Idempotent: unique-keyed rows use upsert; the rest are guarded by a per-user
// existence check, so re-running the seed never piles up duplicates.
async function seedTestAccountObjects() {
  const funded: Record<string, string> = { BTC: "5", ETH: "50", USDT: "250000" };
  const accounts = await prisma.user.findMany({
    where: { email: { in: USER_OBJECT_ACCOUNTS } },
  });
  const byEmail = new Map(accounts.map((u) => [u.email, u]));
  for (const email of USER_OBJECT_ACCOUNTS) {
    const u = byEmail.get(email);
    if (!u) continue;
    const uid = u.id;
    const tag = (email.split("@")[0] ?? "u").replace(/[^a-z0-9]/gi, "");

    // Funded spot balances so trading/withdrawal endpoints operate.
    for (const [asset, amt] of Object.entries(funded)) {
      await prisma.balance.upsert({
        where: { userId_asset: { userId: uid, asset } },
        update: {},
        create: { userId: uid, asset, amount: amt, available: amt, locked: "0" },
      });
    }

    // Deposit — unique on (txid, vout), deterministic per user → upsert-able.
    await prisma.deposit.upsert({
      where: { txid_vout: { txid: `seed-dep-${tag}`, vout: 0 } },
      update: {},
      create: {
        userId: uid,
        asset: "BTC",
        address: `bcrt1qseed${tag}`,
        txid: `seed-dep-${tag}`,
        vout: 0,
        amount: "1.50000000",
        confirmations: 6,
        status: "credited",
        creditedAt: new Date(),
      },
    });

    // Orders (Int autoincrement id → no natural unique key; guard on count).
    if ((await prisma.order.count({ where: { userId: uid } })) === 0) {
      await prisma.order.createMany({
        data: [
          {
            userId: uid,
            pair: "BTC/USDT",
            side: "buy",
            type: "limit",
            price: "40000",
            amount: "0.50000000",
            status: "open",
          },
          {
            userId: uid,
            pair: "ETH/USDT",
            side: "sell",
            type: "limit",
            price: "3000",
            amount: "2.00000000",
            filled: "2.00000000",
            status: "filled",
          },
        ],
      });
    }

    // Withdrawal (cuid id; guard on count).
    if ((await prisma.withdrawal.count({ where: { userId: uid } })) === 0) {
      await prisma.withdrawal.create({
        data: {
          userId: uid,
          asset: "BTC",
          amount: "0.25000000",
          fee: "0.00010000",
          destAddress: `bcrt1qdest${tag}`,
          status: "pending",
        },
      });
    }

    // KYC document — storedPath is a known cross-account IDOR surface.
    if ((await prisma.kycDocument.count({ where: { userId: uid } })) === 0) {
      await prisma.kycDocument.create({
        data: {
          userId: uid,
          type: "passport",
          filename: `passport-${tag}.pdf`,
          storedPath: `kyc/${uid}/passport-${tag}.pdf`,
          mimeType: "application/pdf",
          size: 12345,
          source: "upload",
        },
      });
    }

    // Support ticket + one message (cuid id; guard on count).
    if ((await prisma.supportTicket.count({ where: { userId: uid } })) === 0) {
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: uid,
          category: "account",
          subject: `Account access question (${tag})`,
          status: "open",
        },
      });
      await prisma.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: uid,
          isAgent: false,
          bodyMd: "Please review my recent account activity.",
        },
      });
    }
  }
}

async function main() {
  const users = buildUsers();
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        passwordHash: await hashPassword(u.password),
        displayName: u.displayName,
        role: u.role,
        kycTier: u.kycTier,
        emailVerified: u.emailVerified,
      },
    });
  }
  await seedMarketMakerBalances();
  await seedTestAccountObjects();
  console.log(
    `seeded ${users.length} users (incl. mm.alpha / mm.beta) + per-account ` +
      `objects for ${USER_OBJECT_ACCOUNTS.length} test accounts`,
  );

  // Populate a realistic backlog of exchange activity (balances, price
  // history, deposits/withdrawals, KYC queue, tickets, positions, …).
  // Guarded internally on an empty `trades` table so it's a no-op on an
  // already-seeded database.
  await seedActivity(prisma);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
