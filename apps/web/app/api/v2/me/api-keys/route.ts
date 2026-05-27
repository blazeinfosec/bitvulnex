import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/me/api-keys",
  summary: "List the caller's API keys (hashes only)",
  responses: {
    "200": { description: "OK" },
    "401": { description: "Auth required" },
  },
});
registerEndpoint({
  method: "post",
  path: "/api/v2/me/api-keys",
  summary: "Mint a new API key with the requested scopes",
  responses: {
    "200": { description: "OK (raw key returned once)" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const Scope = z.enum(["read", "trade", "withdraw"]);
const createSchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(Scope).min(1),
});

export async function GET(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const keys = await prisma.apiKey.findMany({
    where: { userId: claims.sub },
    select: {
      id: true,
      name: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");
  const parsed = await readJson(req, createSchema);
  if (parsed.error) return parsed.error;

  const raw = randomBytes(24).toString("base64url");
  const keyHash = createHash("sha256").update(raw).digest("hex");
  const key = await prisma.apiKey.create({
    data: {
      userId: claims.sub,
      name: parsed.data.name,
      keyHash,
      scopes: parsed.data.scopes,
    },
  });
  return NextResponse.json({
    id: key.id,
    name: key.name,
    scopes: key.scopes,
    key: raw,
    note: "Store this key now; it cannot be retrieved later.",
  });
}
