// Phase 11 slice 3 — first-interaction timer + verbose-unlock arithmetic.

import { prisma } from "@bvbe/db";
import { loadCohort } from "./cohort";

/**
 * Record the first interaction for a (cohort, user, target). Atomic
 * upsert per architect addendum condition #9 — a fast double-click
 * never creates two rows. Returns the firstAt timestamp.
 */
export async function recordFirstInteraction(
  cohortId: string,
  userId: string,
  targetKey: string,
): Promise<Date> {
  // Prisma upsert atomically respects the (cohortId, userId, targetKey)
  // unique constraint. If a row already exists, the `update` branch
  // runs but updates nothing (empty data), preserving firstAt.
  const row = await prisma.ctfInteraction.upsert({
    where: {
      cohortId_userId_targetKey: { cohortId, userId, targetKey },
    },
    create: { cohortId, userId, targetKey },
    update: {},
    select: { firstAt: true },
  });
  return row.firstAt;
}

export type VerboseUnlock = {
  unlocked: boolean;
  secondsRemaining: number;
  firstAt: Date | null;
};

export async function verboseUnlockedFor(
  cohortId: string,
  userId: string,
  targetKey: string,
  now: Date = new Date(),
): Promise<VerboseUnlock> {
  const cohort = await loadCohort(cohortId);
  const unlockSecs = cohort?.verboseUnlockSeconds ?? 900;

  const inter = await prisma.ctfInteraction.findUnique({
    where: {
      cohortId_userId_targetKey: { cohortId, userId, targetKey },
    },
    select: { firstAt: true },
  });
  if (!inter) {
    return { unlocked: false, secondsRemaining: unlockSecs, firstAt: null };
  }
  const elapsed = (now.getTime() - inter.firstAt.getTime()) / 1000;
  if (elapsed >= unlockSecs) {
    return { unlocked: true, secondsRemaining: 0, firstAt: inter.firstAt };
  }
  return {
    unlocked: false,
    secondsRemaining: Math.ceil(unlockSecs - elapsed),
    firstAt: inter.firstAt,
  };
}
