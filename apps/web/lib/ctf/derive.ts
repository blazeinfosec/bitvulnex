// Phase 11 slice 1 — canonical flag format + Pattern C self-derivable
// flag helper.
//
// ─── Canonical flag format (single source of truth) ────────────────
// Every flag generator and validator in the lab imports formatFlag /
// FLAG_RE / flagPrefix from here, so the wrapper can never drift across
// the runtime, the instructor flag table, and the test mocks.
//
//   {BLAZE_BITVULNEX_<16 lowercase hex>}
//
// The 16 hex chars are the first 16 of sha256(<derivation input>). The
// digest is deterministic — it only LOOKS like random hex — which is
// what lets `make flags` print the table and the /ctf submit endpoint
// validate without storing the answer.
//
// ─── Pattern C ──────────────────────────────────────────────────────
// Some vulns are pure recon — the trainee's "exploit" is the discovery
// of static lab material (a leaked secret in git history, a weak
// default in config, a private package name in lockfile metadata). For
// these, the flag is deterministic in (vulnId, secret) and shared
// across cohorts: no per-cohort salt rotation applies, because the
// secret IS the static codebase.
//
//   derivableFlag = formatFlag( sha256("V-NNN:" + secret) )
//
// Note this deliberately does NOT use CTF_SALT. The trainee can
// compute the flag themselves once they find the secret; or submit
// the secret as `proof` to /api/v2/ctf/claim and the server derives
// it for them. The PATTERN_C_SECRETS table is the lab's source of
// truth for which secret is the canonical answer to which vuln.
//
// SEE ALSO: docs/phases/phase-11/spec.md §"Pattern C — Self-derivable"

import { createHash } from "node:crypto";

// Number of hex chars in the random segment. Bump here (and nowhere
// else) to widen the flag — FLAG_RE and every generator follow.
const HEX_LEN = 16;

// The one regex any validator should use to recognize a well-formed
// flag. Kept in lock-step with formatFlag below.
export const FLAG_RE = /^\{BLAZE_BITVULNEX_[0-9a-f]{16}\}$/;

/** sha256 of an arbitrary derivation input, full lowercase hex. */
export function deriveDigest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Wrap a digest in the canonical flag envelope. */
export function formatFlag(digestHex: string): string {
  return `{BLAZE_BITVULNEX_${digestHex.slice(0, HEX_LEN)}}`;
}

/**
 * First 8 hex of a flag's random segment, for audit storage. Returns
 * "" if the input isn't a well-formed flag. The submit + reveal-flag
 * routes persist only this prefix, never the full flag.
 */
export function flagPrefix(flag: string): string {
  const m = flag.match(/^\{BLAZE_BITVULNEX_([0-9a-f]{16})\}$/);
  return m && m[1] ? m[1].slice(0, 8) : "";
}

// Each entry is the exact discovered secret the trainee must surface.
// New Pattern C plants land here as their wiring ships in slice 2.
const PATTERN_C_SECRETS: Record<string, string> = {
  "V-9": "changeme",
  "V-15": "CVE-2023-0842",
  "V-48": "devsecret-do-not-use-in-prod-bvbe-2026",
  "V-49": "@bvbe-internal/observability",
};

export function derivableFlag(vulnId: string, secret: string): string {
  return formatFlag(deriveDigest(`${vulnId}:${secret}`));
}

export function expectedSecretFor(vulnId: string): string | null {
  return PATTERN_C_SECRETS[vulnId] ?? null;
}

export function patternCVulnIds(): readonly string[] {
  return Object.keys(PATTERN_C_SECRETS);
}
