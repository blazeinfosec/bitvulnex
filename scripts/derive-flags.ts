// Instructor utility: print all CTF flags for a given CTF_SALT.
// Run via `make flags`. The list of vuln IDs is populated as planted
// vulns land. Phase 0 has none.

import { createHash } from "node:crypto";

const VULN_IDS: string[] = [
  // Populated by later phases. See VULNS.md.
];

function flagFor(vulnId: string, salt: string): string {
  const digest = createHash("sha256")
    .update(`${vulnId}:${salt}`)
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
  if (VULN_IDS.length === 0) {
    console.log("(no planted vulns yet — phase 0)");
    return;
  }
  for (const v of VULN_IDS) {
    console.log(`${v}\t${flagFor(v, salt)}`);
  }
}

main();
