// Instructor utility: print all 44 CTF flags for a given CTF_SALT.
// Run via `make flags` or `pnpm exec tsx scripts/derive-flags.ts`.
//
// The catalog tracks 40 planted V-NNN plus 4 killer-chain bonus flags.
// Pattern A and Pattern B flags are salt-derived (per-cohort rotation
// via CTF_SALT). Pattern C flags are static across cohorts (derived
// from the discovered secret without involving CTF_SALT) — they're
// listed separately so an instructor can audit them once and not
// re-rotate per cohort.

import { createHash } from "node:crypto";

const SALT_DERIVED: string[] = [
  // Slice 1 wired
  "V-1",
  "V-4",
  "V-13",
  "V-22",
  "V-25",
  "V-46",
  // Slice 2 fan-out
  "V-6",
  "V-8",
  "V-10",
  "V-11",
  "V-12",
  "V-14",
  "V-17",
  "V-18",
  "V-19",
  "V-20",
  "V-21",
  "V-23",
  "V-24",
  "V-26",
  "V-27",
  "V-28",
  "V-30",
  "V-32",
  "V-33",
  "V-34",
  "V-35",
  "V-40",
  "V-41",
  "V-42",
  "V-43",
  "V-44",
  "V-45",
  "V-47",
  "V-50",
  "V-51",
  // Killer chains
  "CHAIN-A",
  "CHAIN-B",
  "CHAIN-C",
  "CHAIN-D",
];

// (vulnId, secret) for the Pattern C plants — flag is static across
// cohorts. Keep this in sync with apps/web/lib/ctf/derive.ts.
const STATIC_PATTERN_C: Array<[string, string]> = [
  ["V-9", "changeme"],
  ["V-15", "CVE-2023-0842"],
  ["V-48", "devsecret-do-not-use-in-prod-bvbe-2026"],
  ["V-49", "@bvbe-internal/observability"],
];

function flagFor(vulnId: string, salt: string): string {
  const digest = createHash("sha256")
    .update(`${vulnId}:${salt}`)
    .digest("hex")
    .slice(0, 32);
  return `BVBE{${digest}}`;
}

function derivableFlag(vulnId: string, secret: string): string {
  // Same formula as apps/web/lib/ctf/derive.ts — no salt involved.
  const digest = createHash("sha256")
    .update(`${vulnId}:${secret}`)
    .digest("hex")
    .slice(0, 32);
  return `BVBE{${digest}}`;
}

function main() {
  const salt = process.env.CTF_SALT;
  if (!salt) {
    console.error("CTF_SALT not set");
    process.exit(1);
  }

  const total = SALT_DERIVED.length + STATIC_PATTERN_C.length;
  console.log(`# BVBE CTF flag table — ${total} flags for cohort salt fp:${
    createHash("sha256").update(salt).digest("hex").slice(0, 8)
  }`);
  console.log(`# Pattern A + B + chain (${SALT_DERIVED.length} flags, salt-derived):`);
  for (const v of SALT_DERIVED) {
    console.log(`${v}\t${flagFor(v, salt)}`);
  }
  console.log(`\n# Pattern C (${STATIC_PATTERN_C.length} flags, static across cohorts):`);
  for (const [v, secret] of STATIC_PATTERN_C) {
    console.log(`${v}\t${derivableFlag(v, secret)}\t# secret = "${secret}"`);
  }
}

main();
