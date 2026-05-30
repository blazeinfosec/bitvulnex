// Phase 11 slice 2 — claim endpoint dispatcher (fan-out).
//
// Handles two of the three delivery patterns plus killer-chain
// completion flags:
//   - Pattern B (side-channel proof): exploit produces something the
//     trainee can submit; per-vuln validator checks it; on success we
//     return flagFor(vulnId).
//   - Pattern C (self-derivable): the trainee submits the secret they
//     discovered; we validate it matches the expected lab material and
//     return the deterministic derivableFlag(vulnId, secret).
//   - Chains (CHAIN-A..D): trainee submits proof of chain completion;
//     a chain-specific validator checks it; on success returns
//     flagFor("CHAIN-X") (which IS salt-derived per CTF_SALT).
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

// Slice-2 MVP validators. Most accept a minimally-shaped proof string
// (non-empty, reasonable length, sometimes a URL or path shape) rather
// than verifying the trainee's session-state. Tightening to true proof
// validation (e.g., admin-XSS exfil-tag tracking) lands in later
// slices as the underlying detection plumbing arrives.
const PATTERN_B_VALIDATORS: Record<string, Validator> = {
  // ─── Slice 1 reference set ──────────────────────────────────────
  "V-1": (proof) => typeof proof === "string" && proof.trim().length > 0,
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

  // ─── Slice 2 fan-out ────────────────────────────────────────────

  // V-8 — alg=none. Proof = the unsigned JWT the trainee minted.
  // Acceptance: header decodes to {alg:"none"} with non-empty claims.
  "V-8": (proof) => isJwtWithAlg(proof, "none"),

  // V-10 — predictable password-reset token. Proof = the token the
  // trainee predicted from sha256(userId + Date.now()).slice(0,16).
  "V-10": (proof) => /^[0-9a-f]{16}$/i.test(proof.trim()),

  // V-11 — SQLi via $queryRawUnsafe in admin user search.
  // Proof = the injected SQL fragment they got to execute.
  "V-11": (proof) => /UNION\b|OR\s+1\s*=\s*1|'\s*--/i.test(proof),

  // V-12 — SQLi via stored-displayName interpolation in compliance
  // report. Proof = the displayName payload they planted.
  "V-12": (proof) => /UNION\b|--|'\s*OR\s+|;\s*SELECT/i.test(proof),

  // V-14 — path traversal in KYC doc fetch.
  // Proof = the traversed path they reached.
  "V-14": (proof) => /\.\.\/|\.\.\\\\/.test(proof) && proof.length > 0,

  // V-17 — command injection via spawn shell.
  // Proof = the marker output from the injected command.
  "V-17": (proof) => proof.trim().length > 0,

  // V-18 — markdown sanitizer single-quote bypass.
  // Proof = the rendered HTML with an `on*='...'` handler the
  // sanitizer let through.
  "V-18": (proof) => /on[a-z]+\s*=\s*'/i.test(proof),

  // V-19 — HS/RS key confusion in v1 verifier.
  // Proof = the forged v1 JWT signed with public-key bytes as HMAC.
  "V-19": (proof) => isJwtWithAlg(proof, "HS256") || isJwtWithAlg(proof, "HS512"),

  // V-20 — path traversal in JWT kid → key file.
  // Proof = the discovered key path or the file contents.
  "V-20": (proof) => proof.includes("/") && proof.length > 0,

  // V-21 — refresh token reuse. Proof = the refresh token the trainee
  // observed accepted twice.
  "V-21": (proof) => /^[A-Za-z0-9_\-]{20,}$/.test(proof.trim()),

  // V-23 — CSWSH on ws-gateway. Proof = the ws response data the
  // trainee got from a cross-origin handshake.
  "V-23": (proof) => proof.trim().length > 0,

  // V-24 — bech32 with zero-width chars accepted.
  // Proof = the zero-width-laden address the lab accepted.
  "V-24": (proof) => /[​-‍﻿]/.test(proof),

  // V-27 — KYC tier lex compare. Proof = the string tier value the
  // trainee submitted that bypassed the gate.
  "V-27": (proof) => typeof proof === "string" && proof.trim().length > 0,

  // V-28 — withdrawal limit race.
  // Proof = the over-limit withdrawal id observed.
  "V-28": (proof) => proof.trim().length > 0,

  // V-30 — internal transfer skips limit. Proof = the transfer id
  // that exceeded the trainee's daily withdrawal cap.
  "V-30": (proof) => proof.trim().length > 0,

  // V-32 — cancel race double-refund.
  // Proof = the order id whose cancel produced extra refund.
  "V-32": (proof) => /^[0-9]+$/.test(proof.trim()),

  // V-33 — PSBT validate-vs-broadcast mismatch.
  // Proof = the polyglot envelope (must contain >=2 BVBE_PSBT_V1
  // segments).
  "V-33": (proof) => {
    const segs = proof.split("BVBE_PSBT_V1:");
    return segs.length >= 3; // 1 + N segments
  },

  // V-34 — prototype-pollution → flags.adminPanel.
  // Proof = the response body showing adminPanel:true on /me/flags.
  "V-34": (proof) => /"adminPanel"\s*:\s*true/.test(proof),

  // V-35 — middleware-subrequest short-circuit.
  // Proof = a response body from a privileged endpoint the trainee
  // reached via x-middleware-subrequest.
  "V-35": (proof) => proof.trim().length > 0,

  // V-41 — KYC polyglot upload renders HTML in admin.
  // Proof = the rendered HTML from the polyglot doc.
  "V-41": (proof) => /<script|<img\s+src|onerror=|onload=/i.test(proof),

  // ─── Pattern B fan-out completing the catalog (L7 slice-4 M-1) ──

  // V-6 — middleware bypass via x-bvbe-internal-trace. Proof = any
  // body the trainee retrieved by reaching an internal-prefix
  // endpoint without a valid admin JWT.
  "V-6": (proof) => proof.trim().length > 0,

  // V-26 — UTC-bucket withdrawal-limit bypass. Proof = the second
  // withdrawal id (or txid) that landed on the same wallet within
  // a minute of the first across the UTC boundary.
  "V-26": (proof) => proof.trim().length > 0,

  // V-42 — zero-conf deposit credit. Proof = a deposit row id whose
  // status walked credited→dropped without a compensating debit.
  "V-42": (proof) => /^[0-9a-zA-Z_-]+$/.test(proof.trim()),

  // V-43 — fee-tier maker-side filter miss. Proof = the trade id or
  // fee-tier name the trainee observed inflated past their volume.
  "V-43": (proof) => proof.trim().length > 0,

  // V-44 — yield-accrual ordering inflates a mid-tick supply. Proof
  // = the lending position id that received the inflated accrual.
  "V-44": (proof) => /^[0-9a-zA-Z_-]+$/.test(proof.trim()),

  // V-45 — staking-claim concurrent update double-credit. Proof =
  // the claim id that ran twice OR the difference between expected
  // and actual credit.
  "V-45": (proof) => proof.trim().length > 0,

  // V-50 — HTTP request smuggling. Proof = a smuggled HTTP frame
  // containing both Content-Length and Transfer-Encoding plus a
  // pipelined second request line.
  "V-50": (proof) =>
    /Transfer-Encoding\s*:\s*chunked/i.test(proof) &&
    /Content-Length\s*:/i.test(proof) &&
    /(GET|POST|PATCH|PUT|DELETE)\s+\/[a-zA-Z0-9/.\-_]+\s+HTTP/.test(proof),

  // ─── Killer chains ──────────────────────────────────────────────

  // CHAIN-A: drain hot wallet (V-48 → V-6 → V-33). Trainee submits
  // proof that includes both the leaked JWT secret AND the polyglot
  // PSBT envelope (so the validator can confirm cross-step
  // composition without independent log-trail infrastructure).
  "CHAIN-A": (proof) => {
    return (
      proof.includes("devsecret-do-not-use-in-prod-bvbe-2026") &&
      proof.split("BVBE_PSBT_V1:").length >= 3
    );
  },

  // CHAIN-B: become admin and persist via V-50 smuggle into V-51 mass-
  // assign. Proof = a CL+TE smuggled request frame containing
  // PATCH /api/v2/me with role:admin.
  "CHAIN-B": (proof) => {
    return (
      /Transfer-Encoding\s*:\s*chunked/i.test(proof) &&
      /Content-Length\s*:/i.test(proof) &&
      /PATCH\s+\/api\/v2\/me/i.test(proof) &&
      /"role"\s*:\s*"admin"/i.test(proof)
    );
  },

  // CHAIN-C: mass user takeover via oracle (V-25 self-trade → price
  // poison → V-3 liquidation cascade). Proof = the self-trade id +
  // a victim liquidation id, comma-separated.
  "CHAIN-C": (proof) => {
    const parts = proof.split(",").map((p) => p.trim());
    return parts.length === 2 && parts.every((p) => /^[0-9]+$/.test(p));
  },

  // CHAIN-D: exfiltrate KYC. Proof = a synthetic KYC document key
  // path the trainee retrieved (must start with kyc-bucket/ and
  // contain a user-id segment).
  "CHAIN-D": (proof) => {
    return /^kyc-bucket\/user-[0-9]+\//.test(proof);
  },
};

function isJwtWithAlg(token: string, alg: string): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    const header = JSON.parse(
      Buffer.from(parts[0] as string, "base64url").toString("utf-8"),
    );
    return header.alg === alg;
  } catch {
    return false;
  }
}

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

  // Pattern B / chain: dispatch to per-target validator.
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
