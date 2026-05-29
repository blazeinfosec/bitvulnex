// Phase 11 slice 1 — claim endpoint dispatcher.
//
// Handles two of the three delivery patterns:
//   - Pattern B (side-channel proof): exploit produces something the
//     trainee can submit; per-vuln validator checks it; on success we
//     return flagFor(vulnId) (which IS salt-derived per CTF_SALT).
//   - Pattern C (self-derivable): the trainee submits the secret they
//     discovered; we validate it matches the expected lab material and
//     return the deterministic derivableFlag(vulnId, secret).
//
// Pattern A flags are NOT routed through here — they're emitted
// inline by the relevant route handler via maybeEmitFlag.
//
// SEE ALSO: docs/phases/phase-11/spec.md §"Three flag delivery patterns"

import { flagFor, ctfModeEnabled } from "@/lib/ctf";
import { derivableFlag, expectedSecretFor } from "./derive";

export type ClaimResult =
  | { ok: true; flag: string }
  | { ok: false; status: number; message: string };

type Validator = (proof: string) => boolean | Promise<boolean>;

// Slice-1 reference set. Slice 2 adds the remaining ~12 Pattern B
// validators (V-11, V-12, V-14, V-17, V-18, V-20, V-24, V-27, V-28,
// V-30, V-33, V-34, V-35, V-41 per the architect-locked plan).
const PATTERN_B_VALIDATORS: Record<string, Validator> = {
  // V-1 stored XSS — slice 1 MVP: accept any non-empty exfil tag.
  // Real exfil-tag tracking (admin's session emits a server-known
  // marker when the XSS payload runs) lands in slice 2.
  "V-1": (proof) => typeof proof === "string" && proof.trim().length > 0,

  // V-13 open-redirect — proof = the off-origin URL the trainee
  // observed router.push land on. Acceptance criteria: parseable as
  // http(s) URL whose hostname is NOT localhost / 127.0.0.1 /
  // exchange.local / [::1]. A trainee who never triggered the
  // redirect cannot reasonably know which off-origin host to submit;
  // weak proof but matches a real CTF check.
  "V-13": (proof) => {
    if (typeof proof !== "string") return false;
    let u: URL;
    try {
      u = new URL(proof);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(u.protocol)) return false;
    const denyHosts = ["localhost", "127.0.0.1", "exchange.local", "[::1]"];
    return !denyHosts.includes(u.hostname);
  },
};

export async function processClaim(
  vulnId: string,
  proof: string,
): Promise<ClaimResult> {
  if (!ctfModeEnabled()) {
    return { ok: false, status: 404, message: "not found" };
  }

  // Pattern C: validate the discovered secret, emit deterministic flag.
  const expectedSecret = expectedSecretFor(vulnId);
  if (expectedSecret !== null) {
    if (proof !== expectedSecret) {
      return { ok: false, status: 400, message: "proof does not match" };
    }
    return { ok: true, flag: derivableFlag(vulnId, proof) };
  }

  // Pattern B: dispatch to per-vuln validator.
  const validator = PATTERN_B_VALIDATORS[vulnId];
  if (!validator) {
    return {
      ok: false,
      status: 400,
      message: "unknown vuln id or wrong pattern",
    };
  }
  const ok = await validator(proof);
  if (!ok) {
    return { ok: false, status: 400, message: "invalid proof" };
  }
  return { ok: true, flag: flagFor(vulnId) };
}
