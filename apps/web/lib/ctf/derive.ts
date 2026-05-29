// Phase 11 slice 1 — Pattern C self-derivable flag helper.
//
// Some vulns are pure recon — the trainee's "exploit" is the discovery
// of static lab material (a leaked secret in git history, a weak
// default in config, a private package name in lockfile metadata). For
// these, the flag is deterministic in (vulnId, secret) and shared
// across cohorts: no per-cohort salt rotation applies, because the
// secret IS the static codebase.
//
// Formula: BVBE{ sha256("V-NNN:" + secret).slice(0, 32) }
//
// Note this deliberately does NOT use CTF_SALT. The trainee can
// compute the flag themselves once they find the secret; or submit
// the secret as `proof` to /api/v2/ctf/claim and the server derives
// it for them. The PATTERN_C_SECRETS table is the lab's source of
// truth for which secret is the canonical answer to which vuln.
//
// SEE ALSO: docs/phases/phase-11/spec.md §"Pattern C — Self-derivable"

import { createHash } from "node:crypto";

// Each entry is the exact discovered secret the trainee must surface.
// New Pattern C plants land here as their wiring ships in slice 2.
const PATTERN_C_SECRETS: Record<string, string> = {
  "V-9": "changeme",
  "V-15": "CVE-2023-0842",
  "V-48": "devsecret-do-not-use-in-prod-bvbe-2026",
  "V-49": "@bvbe-internal/observability",
};

export function derivableFlag(vulnId: string, secret: string): string {
  const digest = createHash("sha256")
    .update(`${vulnId}:${secret}`)
    .digest("hex")
    .slice(0, 32);
  return `BVBE{${digest}}`;
}

export function expectedSecretFor(vulnId: string): string | null {
  return PATTERN_C_SECRETS[vulnId] ?? null;
}

export function patternCVulnIds(): readonly string[] {
  return Object.keys(PATTERN_C_SECRETS);
}
