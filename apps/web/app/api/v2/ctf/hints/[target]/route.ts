import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { ctfModeEnabled } from "@/lib/ctf";
import { hintsAllowedFor, ensureUserCohort } from "@/lib/ctf/cohort";
import { verboseUnlockedFor } from "@/lib/ctf/interaction";
import { loadHint } from "@/lib/ctf/hints";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/ctf/hints/{target}",
  summary: "Reveal a basic or verbose hint for a CTF target",
  responses: {
    "200": { description: "Hint prose" },
    "401": { description: "Auth required" },
    "403": { description: "Hints disabled for this cohort or user" },
    "404": { description: "CTF mode disabled or unknown target" },
    "425": { description: "Verbose hint not yet unlocked (Too Early)" },
  },
});

export const dynamic = "force-dynamic";

const TARGET_RE = /^(V-[0-9]+|CHAIN-[A-D]-STEP-[0-9]+)$/;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const { target } = await ctx.params;
  if (!TARGET_RE.test(target)) return jsonError(400, "bad target");

  const url = new URL(req.url);
  const tierRaw = url.searchParams.get("tier") ?? "basic";
  if (tierRaw !== "basic" && tierRaw !== "verbose")
    return jsonError(400, "tier must be basic or verbose");
  const tier = tierRaw === "verbose" ? 2 : 1;

  await ensureUserCohort(claims.sub);
  const policy = await hintsAllowedFor(claims.sub);
  if (!policy.allowed) {
    return NextResponse.json(
      { error: { message: "forbidden", reason: policy.reason } },
      { status: 403 },
    );
  }

  if (tier === 2) {
    const unlock = await verboseUnlockedFor(
      policy.cohortId as string,
      claims.sub,
      target,
    );
    if (!unlock.unlocked) {
      return NextResponse.json(
        {
          error: {
            message: "too early",
            secondsRemaining: unlock.secondsRemaining,
          },
        },
        { status: 425 },
      );
    }
  }

  const hint = loadHint(target, tier);
  if (!hint) return jsonError(404, "unknown target");

  // Idempotent reveal log (architect addendum condition #8 — logged-
  // only). The unique index on (cohortId, userId, targetKey, tier)
  // de-dupes repeated reads.
  await prisma.ctfHintReveal.upsert({
    where: {
      cohortId_userId_targetKey_tier: {
        cohortId: policy.cohortId as string,
        userId: claims.sub,
        targetKey: target,
        tier,
      },
    },
    create: {
      cohortId: policy.cohortId as string,
      userId: claims.sub,
      targetKey: target,
      tier,
    },
    update: {},
  });

  return NextResponse.json({
    targetKey: target,
    tier,
    category: hint.category,
    text: hint.text,
  });
}
