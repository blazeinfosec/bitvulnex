import { PrismaClient } from "@prisma/client";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function main() {
  // Phase 0 seeds exactly one row: the admin account that exists so
  // Phase 1's signup flow has a counterparty. No realistic users yet.
  // The realistic ~50-user seed lands in Phase 1.
  const adminEmail = "admin@bvbe.local";
  const placeholderPassword = "change-me-after-first-login";

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await hashPassword(placeholderPassword),
      role: "admin",
      kycTier: 3,
    },
  });

  console.log(`seeded: ${adminEmail} (admin)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
