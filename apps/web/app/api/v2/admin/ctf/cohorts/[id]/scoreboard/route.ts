import { NextResponse } from "next/server";
import { prisma } from "@bvbe/db";
import { userFromAuthorization } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { ctfModeEnabled } from "@/lib/ctf";
import { ALL_TARGETS } from "@/lib/ctf/catalog";
import { registerEndpoint } from "@/lib/openapi-registry";

registerEndpoint({
  method: "get",
  path: "/api/v2/admin/ctf/cohorts/{id}/scoreboard",
  summary: "Per-trainee score + hint analytics for a cohort",
  responses: { "200": { description: "Scoreboard" } },
});

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!ctfModeEnabled()) return jsonError(404, "not found");
  const claims = await userFromAuthorization(req.headers.get("authorization"));
  if (!claims || (claims.role !== "admin" && claims.role !== "support"))
    return jsonError(403, "forbidden");

  const { id: cohortId } = await ctx.params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";

  const [members, submissions, reveals] = await Promise.all([
    prisma.user.findMany({
      where: { cohortId },
      select: { id: true, email: true, displayName: true, hintsOverride: true },
      orderBy: { email: "asc" },
    }),
    prisma.ctfSubmission.findMany({
      where: { cohortId, valid: true },
      select: { userId: true, targetKey: true },
    }),
    prisma.ctfHintReveal.findMany({
      where: { cohortId },
      select: { userId: true, targetKey: true, tier: true },
    }),
  ]);

  const subsByUser = new Map<string, Set<string>>();
  for (const s of submissions) {
    if (!subsByUser.has(s.userId)) subsByUser.set(s.userId, new Set());
    subsByUser.get(s.userId)!.add(s.targetKey);
  }
  const revealsByUser = new Map<
    string,
    { basic: number; verbose: number }
  >();
  for (const r of reveals) {
    const e = revealsByUser.get(r.userId) ?? { basic: 0, verbose: 0 };
    if (r.tier === 1) e.basic++;
    if (r.tier === 2) e.verbose++;
    revealsByUser.set(r.userId, e);
  }

  // Per-target reveal heat map (basic + verbose counts across cohort).
  const heatMap = new Map<string, { basic: number; verbose: number }>();
  for (const r of reveals) {
    const e = heatMap.get(r.targetKey) ?? { basic: 0, verbose: 0 };
    if (r.tier === 1) e.basic++;
    if (r.tier === 2) e.verbose++;
    heatMap.set(r.targetKey, e);
  }

  const rows = members.map((m) => {
    const won = subsByUser.get(m.id) ?? new Set<string>();
    const plantWins = Array.from(won).filter((k) => k.startsWith("V-")).length;
    const chainWins = Array.from(won).filter((k) =>
      /^CHAIN-[A-D]$/.test(k),
    ).length;
    const reveals = revealsByUser.get(m.id) ?? { basic: 0, verbose: 0 };
    return {
      userId: m.id,
      email: m.email,
      displayName: m.displayName,
      hintsOverride: m.hintsOverride,
      plantFlags: plantWins,
      chainFlags: chainWins,
      // Weighted: 1pt per plant + 5pt per chain (architect-locked).
      score: plantWins + 5 * chainWins,
      basicReveals: reveals.basic,
      verboseReveals: reveals.verbose,
    };
  });
  rows.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));

  const heatRows = ALL_TARGETS.map((t) => ({
    targetKey: t.key,
    kind: t.kind,
    pattern: t.pattern,
    category: t.category,
    difficulty: t.difficulty,
    basicReveals: heatMap.get(t.key)?.basic ?? 0,
    verboseReveals: heatMap.get(t.key)?.verbose ?? 0,
  }));

  if (format === "csv") {
    const lines: string[] = [];
    lines.push(
      "email,displayName,hintsOverride,plantFlags,chainFlags,score,basicReveals,verboseReveals",
    );
    for (const r of rows) {
      lines.push(
        [
          r.email,
          (r.displayName ?? "").replaceAll(",", " "),
          r.hintsOverride,
          r.plantFlags,
          r.chainFlags,
          r.score,
          r.basicReveals,
          r.verboseReveals,
        ].join(","),
      );
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ctf-scoreboard-${cohortId}.csv"`,
      },
    });
  }

  return NextResponse.json({ rows, heatMap: heatRows });
}
