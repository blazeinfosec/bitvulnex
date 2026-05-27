// JWKS for the legacy v1 mobile-app JWTs. Public key only; the
// matching private key signs tokens minted by the v1 endpoints.

import { NextResponse } from "next/server";
import { createPublicKey } from "node:crypto";
import { LEGACY_KID, LEGACY_RSA_PUBLIC_PEM } from "@bvbe/shared";

export const dynamic = "force-dynamic";

function pemToJwk(pem: string, kid: string) {
  const key = createPublicKey(pem);
  const jwk = key.export({ format: "jwk" });
  return { ...jwk, kid, use: "sig", alg: "RS256" };
}

export function GET() {
  return NextResponse.json({
    keys: [pemToJwk(LEGACY_RSA_PUBLIC_PEM, LEGACY_KID)],
  });
}
