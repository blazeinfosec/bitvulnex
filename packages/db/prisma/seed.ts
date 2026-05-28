import { PrismaClient, type Role } from "@prisma/client";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

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
      password: "change-me-after-first-login",
      role: "admin",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "treasury@bvbe.local",
      displayName: "Treasury Ops",
      password: "change-me-after-first-login",
      role: "treasury",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "support1@bvbe.local",
      displayName: "Support Agent A",
      password: "change-me-after-first-login",
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
      password: "change-me-after-first-login",
      role: "compliance",
      kycTier: 3,
      emailVerified: true,
    },
    {
      email: "whale1@example.test",
      displayName: "High Roller Holdings",
      password: "Sup3rLong-Whale-Pass-001",
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
  console.log(`seeded ${users.length} users`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
