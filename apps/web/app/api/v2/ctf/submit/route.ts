import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@bvbe/db";
import { flagFor, ctfModeEnabled } from "@/lib/ctf";
import { derivableFlag, expectedSecretFor } from "@/lib/ctf/derive";
import { ensureUserCohort } from "@/lib/ctf/cohort";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/api";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "post",
  path: "/api/v2/ctf/submit",
  summary: "Submit a BVBE{...} flag for a target (V-NNN or CHAIN-X)",
  responses: {
    "200": { description: "Submission accepted (valid or invalid)" },
    "400": { description: "Malformed submission" },
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
  flag: z
    .string()
    .min(8)
    .max(64)
    .regex(/^BVBE\{[0-9a-f]{32}\}$/),
});

function flagPrefix(flag: string): string {
  // First 8 hex of the BVBE{...} hex digits. Never stores the full flag.
  const m = flag.match(/^BVBE\{([0-9a-f]{32})\}$/);
  return m && m[1] ? m[1].slice(0, 8) : "";
}

function expectedFlagFor(targetKey: string): string | null {
  // Pattern C plants use the static derivable formula. Everything else
  // uses the salt-derived flagFor.
  const secret = expectedSecretFor(targetKey);
  if (secret !== null) return derivableFlag(targetKey, secret);
  // Pattern A and Pattern B both validate against flagFor(targetKey).
  return flagFor(targetKey);
}

export async function POST(req: Request) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");

  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims) return jsonError(401, "unauthorized");

  const parsed = await readJson(req, schema);
  if (parsed.error) return parsed.error;

  const { targetKey, flag } = parsed.data;
  const cohortId = await ensureUserCohort(claims.sub);

  const expected = expectedFlagFor(targetKey);
  const valid = expected !== null && flag === expected;
  const prefix = flagPrefix(flag);

  // Upsert against the (cohort, user, target, valid) unique index — a
  // trainee who submits the right flag twice gets idempotent score; a
  // wrong-then-right sequence yields two rows (one valid=false, one
  // valid=true). Score = count of valid rows.
  await prisma.ctfSubmission.upsert({
    where: {
      cohortId_userId_targetKey_valid: {
        cohortId,
        userId: claims.sub,
        targetKey,
        valid,
      },
    },
    create: {
      cohortId,
      userId: claims.sub,
      targetKey,
      flagPrefix: prefix,
      valid,
    },
    update: {
      // Refresh submittedAt so /admin/ctf can show "latest attempt at"
      submittedAt: new Date(),
    },
  });

  return NextResponse.json({
    valid,
    // Don't echo the canonical flag back on miss — trainees should not
    // be able to oracle-probe the validator.
    targetKey,
  });
}
