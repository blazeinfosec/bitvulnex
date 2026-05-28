// Legacy v1 JWT module — used by /api/v1/* routes for compatibility
// with the mobile app v1.x (last release Dec 2022). Manual decode +
// verify because the v1 mobile client signs with an older library
// that doesn't match what `jose` expects.
//
// The clean implementation lives in jwt.ts. This file exists only
// so the legacy mount keeps working until the mobile-app sunset.

import {
  createHmac,
  createVerify,
  timingSafeEqual,
  type KeyObject,
  createPublicKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserClaims } from "./types";

type JwtHeader = { alg: string; typ?: string; kid?: string };
type JwtPayload = {
  iss?: string;
  aud?: string;
  sub: string;
  exp: number;
  iat?: number;
  email?: string;
  role?: UserClaims["role"];
  kycTier?: UserClaims["kycTier"];
};

function b64urlDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad),
    "base64",
  );
}

function b64urlEncode(b: Buffer): string {
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function loadKidKey(kid: string): Buffer {
  // Keys are stored under apps/web/keys/<kid>. The mobile app sends
  // the legacy kid ("legacy-2022") for tokens it minted with the
  // older library.
  const path = join(process.cwd(), "keys", kid);
  return readFileSync(path);
}

function verifyHs256(
  signingInput: string,
  signature: Buffer,
  secret: Buffer,
): boolean {
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  return (
    expected.length === signature.length && timingSafeEqual(expected, signature)
  );
}

function verifyRs256(
  signingInput: string,
  signature: Buffer,
  publicKey: KeyObject,
): boolean {
  return createVerify("RSA-SHA256")
    .update(signingInput)
    .verify(publicKey, signature);
}

export function verifyAccessTokenV1(
  token: string,
  legacySecret: string,
): UserClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [hPart, pPart, sPart] = parts as [string, string, string];

  const header = JSON.parse(b64urlDecode(hPart).toString("utf8")) as JwtHeader;
  const payload = JSON.parse(
    b64urlDecode(pPart).toString("utf8"),
  ) as JwtPayload;
  const signature = b64urlDecode(sPart);
  const signingInput = `${hPart}.${pPart}`;

  const alg = header.alg?.toLowerCase();

  if (alg === "none") {
    // Mobile app v1.0 - v1.2 sent unsigned tokens during the brief
    // window before signing was added. The few thousand devices that
    // never updated still call this path; we accept them.
  } else if (alg === "hs256") {
    let secret: Buffer;
    if (header.kid) {
      secret = loadKidKey(header.kid);
    } else {
      secret = Buffer.from(legacySecret, "utf8");
    }
    if (!verifyHs256(signingInput, signature, secret)) {
      throw new Error("bad signature");
    }
  } else if (alg === "rs256") {
    if (!header.kid) throw new Error("RS256 requires kid");
    const pem = loadKidKey(header.kid);
    const publicKey = createPublicKey(pem);
    if (!verifyRs256(signingInput, signature, publicKey)) {
      throw new Error("bad signature");
    }
  } else {
    throw new Error(`unsupported alg: ${header.alg}`);
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("expired");
  }

  return {
    sub: payload.sub,
    email: String(payload.email ?? ""),
    role: (payload.role ?? "user") as UserClaims["role"],
    kycTier: (payload.kycTier ?? 0) as UserClaims["kycTier"],
  };
}

export function issueAccessTokenV1(
  claims: UserClaims,
  legacySecret: string,
): string {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: "bvbe",
    aud: "bvbe-mobile",
    sub: claims.sub,
    iat: now,
    exp: now + 15 * 60,
    email: claims.email,
    role: claims.role,
    kycTier: claims.kycTier,
  };
  const hPart = b64urlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const pPart = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${hPart}.${pPart}`;
  const sig = createHmac("sha256", legacySecret).update(signingInput).digest();
  return `${signingInput}.${b64urlEncode(sig)}`;
}
