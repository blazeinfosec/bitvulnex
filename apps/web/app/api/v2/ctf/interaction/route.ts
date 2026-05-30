import { NextResponse } from "next/server";
import { z } from "zod";
import { ctfModeEnabled } from "@/lib/ctf";
import { ensureUserCohort } from "@/lib/ctf/cohort";
import {
  recordFirstInteraction,
  verboseUnlockedFor,
} from "@/lib/ctf/interaction";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/ctf/interaction",
  summary:
    "Mark first interaction with a target; starts the verbose-unlock timer",
  responses: {
    "200": { description: "Recorded (or already recorded)" },
    "401": { description: "Auth required" },
    "404": { description: "CTF mode disabled" },
  },
});

export const dynamic = "force-dynamic";

const schema = z.object({
  targetKey: z
    .string()
    .min(1)
    .max(20)
    .regex(/^(V-[0-9]+|CHAIN-[A-D](-STEP-[0-9]+)?)$/),
});

export async function POST(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const cohortId = await ensureUserCohort(claims.sub);
  const firstAt = await recordFirstInteraction(
    cohortId,
    claims.sub,
    parsed.data.targetKey,
  );
  const unlock = await verboseUnlockedFor(
    cohortId,
    claims.sub,
    parsed.data.targetKey,
  );

  return NextResponse.json({
    targetKey: parsed.data.targetKey,
    firstAt: firstAt.toISOString(),
    verbose: {
      unlocked: unlock.unlocked,
      secondsRemaining: unlock.secondsRemaining,
    },
  });
}
