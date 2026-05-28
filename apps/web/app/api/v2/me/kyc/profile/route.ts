import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "put",
  path: "/api/v2/me/kyc/profile",
  summary: "Submit or update KYC profile fields",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  legalName: z.string().min(1).max(128),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country: z.string().length(2).toUpperCase(),
  addressLine: z.string().min(1).max(256),
  city: z.string().min(1).max(64),
  postalCode: z.string().min(1).max(16),
});

export async function PUT(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const data = {
    legalName: parsed.data.legalName,
    dateOfBirth: new Date(parsed.data.dateOfBirth),
    country: parsed.data.country,
    addressLine: parsed.data.addressLine,
    city: parsed.data.city,
    postalCode: parsed.data.postalCode,
  };

  const profile = await prisma.kycProfile.upsert({
    where: { userId: claims.sub },
    create: { userId: claims.sub, ...data },
    update: data,
  });
  return NextResponse.json({ profile });
}
