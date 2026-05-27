import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { UserClaims } from "./types.js";

const ISSUER = "bvbe";
const AUDIENCE = "bvbe-web";
const ALG = "HS256" as const;
const ACCESS_TTL = "15m";

function secretBytes(secret: string): Uint8Array {
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 bytes. Refusing to start with a weak key.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function issueAccessToken(
  claims: UserClaims,
  secret: string,
): Promise<string> {
  return new SignJWT({ ...claims } satisfies JWTPayload)
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretBytes(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<UserClaims> {
  const { payload } = await jwtVerify(token, secretBytes(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALG],
  });
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    role: payload.role as UserClaims["role"],
    kycTier: payload.kycTier as UserClaims["kycTier"],
  };
}
