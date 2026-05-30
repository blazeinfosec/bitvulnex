import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { ctfModeEnabled } from "@/lib/ctf";
import { ensureUserCohort, loadCohort } from "@/lib/ctf/cohort";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/ctf/me",
  summary: "Trainee CTF state — cohort, hint policy, score, reveals",
  responses: {
    "200": { description: "Trainee state" },
    "401": { description: "Auth required" },
    "404": { description: "CTF mode disabled" },
  },
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const cohortId = await ensureUserCohort(claims.sub);
  const cohort = await loadCohort(cohortId);
  if (!cohort) return jsonError(500, "cohort missing");

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { hintsOverride: true },
  });
  const userOverride = user?.hintsOverride ?? "follow";
  const effectiveHints =
    userOverride === "enable"
      ? true
      : userOverride === "disable"
        ? false
        : cohort.hintsDefault;

  // Submissions: collapse to per-target { hasValid, attempts }.
  const submissions = await prisma.ctfSubmission.findMany({
    where: { cohortId, userId: claims.sub },
    select: {
      targetKey: true,
      valid: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: "desc" },
    take: 200,
  });

  const targetMap = new Map<string, { hasValid: boolean; attempts: number }>();
  for (const s of submissions) {
    const entry = targetMap.get(s.targetKey) ?? {
      hasValid: false,
      attempts: 0,
    };
    entry.attempts += 1;
    if (s.valid) entry.hasValid = true;
    targetMap.set(s.targetKey, entry);
  }
  const targets = Array.from(targetMap.entries()).map(([targetKey, v]) => ({
    targetKey,
    valid: v.hasValid,
    attempts: v.attempts,
  }));

  // Per-target reveal state for THIS trainee only. Aggregates are
  // admin-only per architect addendum condition #8.
  const reveals = await prisma.ctfHintReveal.findMany({
    where: { cohortId, userId: claims.sub },
    select: { targetKey: true, tier: true, revealedAt: true },
  });
  const interactions = await prisma.ctfInteraction.findMany({
    where: { cohortId, userId: claims.sub },
    select: { targetKey: true, firstAt: true },
  });

  // Score: count of distinct targets with valid=true. Chain steps and
  // chain bonus flags both count individually. The /admin/ctf view
  // weights chains 5x; here we just expose raw counts.
  const validTargets = targets.filter((t) => t.valid).map((t) => t.targetKey);
  const planCount = validTargets.filter((k) => k.startsWith("V-")).length;
  const chainCount = validTargets.filter((k) =>
    /^CHAIN-[A-D]$/.test(k),
  ).length;

  return NextResponse.json({
    cohort: {
      name: cohort.name,
      saltFingerprint: cohort.saltFingerprint,
      hintsDefault: cohort.hintsDefault,
      verboseUnlockSeconds: cohort.verboseUnlockSeconds,
      archived: cohort.archivedAt !== null,
    },
    hints: {
      userOverride,
      effective: effectiveHints,
    },
    score: {
      plantFlags: planCount,
      chainFlags: chainCount,
      // Plant total: 40 V-NNN flags. Chain total: 4. (Slice 4 will
      // make these counts configurable per cohort.)
      plantTotal: 40,
      chainTotal: 4,
    },
    targets,
    reveals: reveals.map((r) => ({
      targetKey: r.targetKey,
      tier: r.tier,
      revealedAt: r.revealedAt.toISOString(),
    })),
    interactions: interactions.map((i) => ({
      targetKey: i.targetKey,
      firstAt: i.firstAt.toISOString(),
    })),
  });
}
