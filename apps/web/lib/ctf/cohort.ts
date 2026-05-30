// Phase 11 slice 3 — cohort + per-user hint policy resolution.
//
// The architect's addendum condition #7 makes hintsAllowedFor the SOLE
// gate for every hint-emitting code path. Every other helper in the
// hint subsystem (interaction recording, hint reveal, hint markdown
// serving) consults this function first.

import { prisma } from "@bvbe/db";
import { ctfModeEnabled } from "@/lib/ctf";
import { createHash } from "node:crypto";

export type HintsPolicy = {
  allowed: boolean;
  reason?:
    | "ctf-mode-off"
    | "no-cohort"
    | "cohort-archived"
    | "cohort-default-disabled"
    | "user-disabled";
};

const DEFAULT_COHORT_NAME = "default";

export function saltFingerprint(salt: string): string {
  return createHash("sha256").update(salt).digest("hex").slice(0, 16);
}

/**
 * Resolve (and auto-create if missing) the default cohort for fresh
 * deployments. The default cohort has hints OFF — matches the
 * spec-locked "OFF by default" rule for new cohorts. Instructor can
 * override per-cohort from /admin/ctf in slice 4.
 */
export async function ensureDefaultCohort(): Promise<{ id: string }> {
  const salt = process.env.CTF_SALT ?? "";
  const fp = saltFingerprint(salt);
  const existing = await prisma.cohort.findUnique({
    where: { name: DEFAULT_COHORT_NAME },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.cohort.create({
    data: {
      name: DEFAULT_COHORT_NAME,
      saltFingerprint: fp,
      hintsDefault: false,
      verboseUnlockSeconds: 900,
    },
    select: { id: true },
  });
}

/**
 * Attach a user to a cohort. Used lazily on first /ctf interaction
 * when the user has no cohortId set. Idempotent.
 */
export async function ensureUserCohort(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { cohortId: true },
  });
  if (user?.cohortId) return user.cohortId;
  const cohort = await ensureDefaultCohort();
  await prisma.user.update({
    where: { id: userId },
    data: { cohortId: cohort.id },
  });
  return cohort.id;
}

export async function loadCohort(cohortId: string) {
  return prisma.cohort.findUnique({
    where: { id: cohortId },
    select: {
      id: true,
      name: true,
      saltFingerprint: true,
      hintsDefault: true,
      verboseUnlockSeconds: true,
      archivedAt: true,
    },
  });
}

/**
 * Compute the effective hint policy for a (user, target).
 *
 * SOLE gate per architect addendum condition #7. Performance contract:
 * when CTF_MODE is off the function short-circuits before touching the
 * DB so production paths stay zero-cost.
 */
export async function hintsAllowedFor(
  userId: string,
): Promise<HintsPolicy & { cohortId?: string; verboseUnlockSeconds?: number }> {
  if (!ctfModeEnabled()) return { allowed: false, reason: "ctf-mode-off" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { cohortId: true, hintsOverride: true },
  });
  if (!user?.cohortId) return { allowed: false, reason: "no-cohort" };

  const cohort = await loadCohort(user.cohortId);
  if (!cohort) return { allowed: false, reason: "no-cohort" };
  if (cohort.archivedAt) return { allowed: false, reason: "cohort-archived" };

  const effective =
    user.hintsOverride === "enable"
      ? true
      : user.hintsOverride === "disable"
        ? false
        : cohort.hintsDefault;

  return effective
    ? {
        allowed: true,
        cohortId: cohort.id,
        verboseUnlockSeconds: cohort.verboseUnlockSeconds,
      }
    : {
        allowed: false,
        reason: cohort.hintsDefault
          ? "user-disabled"
          : "cohort-default-disabled",
        cohortId: cohort.id,
        verboseUnlockSeconds: cohort.verboseUnlockSeconds,
      };
}
