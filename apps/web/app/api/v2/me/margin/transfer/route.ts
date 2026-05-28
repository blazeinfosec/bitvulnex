// Move funds between the user's spot and margin sub-accounts.
// Direction "to_margin": available -> marginAvailable
// Direction "to_spot":   marginAvailable -> available

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/me/margin/transfer",
  summary: "Transfer balance between spot and margin sub-accounts",
  responses: {
    "200": { description: "OK" },
    "400": { description: "Bad request / insufficient balance" },
    "401": { description: "Auth required" },
  },
});

export const dynamic = "force-dynamic";

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((s) => Number(s) > 0);

const schema = z.object({
  asset: z.string().min(1).max(16),
  amount: positiveDecimal,
  direction: z.enum(["to_margin", "to_spot"]),
});

export async function POST(req: Request) {
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;
  const amount = new Prisma.Decimal(parsed.data.amount);

  try {
    await prisma.$transaction(async (tx) => {
      const bal = await tx.balance.findUnique({
        where: { userId_asset: { userId: claims.sub, asset: parsed.data.asset } },
      });
      if (!bal) throw new Error("no balance for asset");

      if (parsed.data.direction === "to_margin") {
        if (bal.available.lt(amount)) throw new Error("insufficient available");
        await tx.balance.update({
          where: {
            userId_asset: { userId: claims.sub, asset: parsed.data.asset },
          },
          data: {
            available: { decrement: amount },
            marginAvailable: { increment: amount },
          },
        });
      } else {
        if (bal.marginAvailable.lt(amount)) {
          throw new Error("insufficient margin available");
        }
        await tx.balance.update({
          where: {
            userId_asset: { userId: claims.sub, asset: parsed.data.asset },
          },
          data: {
            marginAvailable: { decrement: amount },
            available: { increment: amount },
          },
        });
      }
    });
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "transfer failed");
  }
  return NextResponse.json({ ok: true });
}
