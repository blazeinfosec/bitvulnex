// Instructor utility: compile every authored CTF hint (basic + verbose)
// into reference docs, cross-referenced against the canonical 44-target
// catalog — PLUS a separate machine-readable flag answer-key.
//
// Run via `pnpm hints-doc` or `pnpm exec tsx scripts/compile-hints.ts`.
// Salt-derived flags need CTF_SALT (read from the environment, falling
// back to a CTF_SALT= line in ./.env). Without it, the hint docs still
// generate and Pattern C (static) flags still resolve; salt-derived
// flags are emitted as null with a note.
//
// Output (regenerated each run, NOT hand-edited):
//   docs/COMPILED-HINTS.md     human-readable hints, catalog order
//   docs/compiled-hints.json   machine-readable hints — FLAG-FREE, safe
//                              to feed to a stuck solver
//   docs/compiled-flags.json   answer key (flag per target) — KEEP AWAY
//                              from the solver; use only to verify solves
//
// The hint feed and the flag key are deliberately separate files so the
// answer never rides along with the hints you hand a stuck agent.
//
// IMPORTANT: the artifacts land in docs/, NOT docs/hints/. The runtime
// loader (apps/web/lib/ctf/hints.ts) parses every .md in docs/hints/
// except README.md and throws on anything without valid front-matter —
// dropping a compiled doc there would break hint serving.
//
// The front-matter parser below mirrors parseFrontMatter in
// apps/web/lib/ctf/hints.ts. Kept in sync deliberately (no shared import
// to avoid pulling the web app's path aliases into a root script). The
// flag helpers ARE imported from the canonical source so the format
// can't drift.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ALL_TARGETS } from "../apps/web/lib/ctf/catalog";
import {
  deriveDigest,
  formatFlag,
  expectedSecretFor,
} from "../apps/web/lib/ctf/derive";

const REPO_ROOT = join(__dirname, "..");
const HINTS_DIR = join(REPO_ROOT, "docs", "hints");
const OUT_MD = join(REPO_ROOT, "docs", "COMPILED-HINTS.md");
const OUT_JSON = join(REPO_ROOT, "docs", "compiled-hints.json");
const OUT_FLAGS = join(REPO_ROOT, "docs", "compiled-flags.json");

// Resolve CTF_SALT from the env, falling back to a CTF_SALT= line in
// ./.env (which `pnpm`/`tsx` do not auto-load). Returns null if unset.
function resolveSalt(): string | null {
  if (process.env.CTF_SALT) return process.env.CTF_SALT;
  const envFile = join(REPO_ROOT, ".env");
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*CTF_SALT\s*=\s*(.+?)\s*$/);
    if (m && m[1]) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

type FlagEntry = {
  key: string;
  kind: "plant" | "chain";
  category: string;
  difficulty: string;
  flagType: "salt-derived" | "static";
  flag: string | null; // null only for salt-derived when CTF_SALT unset
};

function buildFlags(salt: string | null): FlagEntry[] {
  return ALL_TARGETS.map((t): FlagEntry => {
    const secret = expectedSecretFor(t.key);
    if (secret !== null) {
      // Pattern C — static across cohorts, no salt involved.
      return {
        key: t.key,
        kind: t.kind,
        category: t.category,
        difficulty: t.difficulty,
        flagType: "static",
        flag: formatFlag(deriveDigest(`${t.key}:${secret}`)),
      };
    }
    return {
      key: t.key,
      kind: t.kind,
      category: t.category,
      difficulty: t.difficulty,
      flagType: "salt-derived",
      flag: salt === null ? null : formatFlag(deriveDigest(`${t.key}:${salt}`)),
    };
  });
}

type ParsedFrontMatter = {
  target: string;
  category: string;
  tier1Basic?: string;
  tier2Verbose?: string;
  steps?: Record<number, { tier1Basic: string; tier2Verbose: string }>;
};

function parseFrontMatter(text: string): ParsedFrontMatter {
  if (!text.startsWith("---")) throw new Error("missing front-matter delimiter");
  const end = text.indexOf("\n---", 3);
  if (end < 0) throw new Error("unterminated front-matter");
  const body = text.slice(4, end);

  const out: ParsedFrontMatter = { target: "", category: "" };
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const top = line.match(/^([a-zA-Z0-9_-]+):\s*(\|)?\s*(.*)?$/);
    if (top) {
      const [, key, pipe, inline] = top;
      if (key === "target") out.target = (inline ?? "").trim();
      else if (key === "category") out.category = (inline ?? "").trim();
      else if (key === "tier-1-basic" || key === "tier-2-verbose") {
        let val = (inline ?? "").trim();
        if (pipe === "|") {
          const block: string[] = [];
          while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1] ?? "")) {
            i++;
            block.push((lines[i] ?? "").replace(/^\s+/, ""));
          }
          val = block.join(" ").trim();
        }
        if (key === "tier-1-basic") out.tier1Basic = val;
        else out.tier2Verbose = val;
      } else if (key === "steps") {
        out.steps = {};
        while (i + 1 < lines.length) {
          const next = lines[i + 1] ?? "";
          const stepMatch = next.match(/^\s{2}(\d+):\s*$/);
          if (!stepMatch) break;
          i++;
          const step = Number(stepMatch[1]);
          let basic = "";
          let verbose = "";
          while (i + 1 < lines.length) {
            const sub = lines[i + 1] ?? "";
            if (sub.match(/^\s{2}\d+:\s*$/)) break;
            if (!sub.match(/^\s{4,}/)) break;
            i++;
            const m = sub.match(
              /^\s{4}(tier-1-basic|tier-2-verbose):\s*"(.*)"\s*$/,
            );
            if (m) {
              if (m[1] === "tier-1-basic") basic = (m[2] ?? "").trim();
              else verbose = (m[2] ?? "").trim();
            }
          }
          out.steps[step] = { tier1Basic: basic, tier2Verbose: verbose };
        }
      }
    }
    i++;
  }
  return out;
}

type CompiledStep = { step: number; basic: string; verbose: string };
type CompiledTarget = {
  key: string;
  kind: "plant" | "chain";
  pattern: string;
  category: string;
  difficulty: string;
  hasHint: boolean;
  basic?: string;
  verbose?: string;
  steps?: CompiledStep[];
};

function loadParsed(): Map<string, ParsedFrontMatter> {
  const map = new Map<string, ParsedFrontMatter>();
  if (!existsSync(HINTS_DIR)) return map;
  const files = readdirSync(HINTS_DIR).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
  for (const f of files) {
    const text = readFileSync(join(HINTS_DIR, f), "utf-8");
    const fm = parseFrontMatter(text);
    map.set(fm.target, fm);
  }
  return map;
}

function compile(): CompiledTarget[] {
  const parsed = loadParsed();
  return ALL_TARGETS.map((t): CompiledTarget => {
    const fm = parsed.get(t.key);
    const base = {
      key: t.key,
      kind: t.kind,
      pattern: t.pattern,
      category: t.category,
      difficulty: t.difficulty,
    };
    if (!fm) return { ...base, hasHint: false };
    if (fm.steps) {
      const steps = Object.entries(fm.steps)
        .map(([n, s]) => ({
          step: Number(n),
          basic: s.tier1Basic,
          verbose: s.tier2Verbose,
        }))
        .sort((a, b) => a.step - b.step);
      return { ...base, hasHint: true, steps };
    }
    return {
      ...base,
      hasHint: true,
      basic: fm.tier1Basic,
      verbose: fm.tier2Verbose,
    };
  });
}

function renderMarkdown(targets: CompiledTarget[]): string {
  const authored = targets.filter((t) => t.hasHint);
  const missing = targets.filter((t) => !t.hasHint);
  const lines: string[] = [];

  lines.push("# Compiled CTF hints — basic + verbose");
  lines.push("");
  lines.push(
    "> **DELIBERATELY VULNERABLE LAB — DO NOT DEPLOY. Instructor / tooling",
  );
  lines.push(
    "> material only. Not linked from any attacker-facing page.**",
  );
  lines.push("");
  lines.push(
    "Auto-generated by `scripts/compile-hints.ts` — **do not hand-edit**.",
  );
  lines.push(
    "Regenerate with `pnpm exec tsx scripts/compile-hints.ts` after editing",
  );
  lines.push("any file under `docs/hints/`. Source of truth for hint prose is");
  lines.push("`docs/hints/<TARGET>.md`; target metadata is `apps/web/lib/ctf/catalog.ts`.");
  lines.push("");
  lines.push(
    `Coverage: **${authored.length}/${targets.length}** targets have authored hints` +
      (missing.length ? ` (${missing.length} pending).` : "."),
  );
  lines.push("");
  lines.push(
    "Hint depth contract: **basic** = vuln class only; **verbose** = lens +",
  );
  lines.push(
    "category (what to scrutinize) — never a file path, line number, or",
  );
  lines.push("exploit payload. Feed these to a stuck solver in order: basic first,");
  lines.push("verbose only if still blocked.");
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const t of authored) {
    lines.push(`## ${t.key} — ${t.category}`);
    lines.push("");
    lines.push(
      `- **Kind:** ${t.kind} · **Pattern:** ${t.pattern} · **Difficulty:** ${t.difficulty}`,
    );
    lines.push("");
    if (t.steps) {
      for (const s of t.steps) {
        lines.push(`### Step ${s.step}`);
        lines.push("");
        lines.push(`**Basic:** ${s.basic}`);
        lines.push("");
        lines.push(`**Verbose:** ${s.verbose}`);
        lines.push("");
      }
    } else {
      lines.push(`**Basic:** ${t.basic}`);
      lines.push("");
      lines.push(`**Verbose:** ${t.verbose}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  if (missing.length) {
    lines.push("## Targets without authored hints");
    lines.push("");
    lines.push(
      "These catalog targets have no `docs/hints/<TARGET>.md` yet. The",
    );
    lines.push(
      "runtime returns 404 (`unknown target`) and the /ctf page shows",
    );
    lines.push('"no hint authored yet".');
    lines.push("");
    for (const t of missing) {
      lines.push(
        `- **${t.key}** — ${t.category} (${t.kind}, ${t.difficulty})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main(): void {
  const targets = compile();
  // Hint feed — deliberately FLAG-FREE.
  writeFileSync(OUT_MD, renderMarkdown(targets) + "\n", "utf-8");
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedBy: "scripts/compile-hints.ts",
        note: "Hints only — no flags. Safe to feed to a solver when stuck.",
        targetCount: targets.length,
        authoredCount: targets.filter((t) => t.hasHint).length,
        targets,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  // Answer key — separate file. Salt-derived flags are cohort-specific.
  const salt = resolveSalt();
  const flags = buildFlags(salt);
  const saltFp = salt
    ? createHash("sha256").update(salt).digest("hex").slice(0, 8)
    : null;
  writeFileSync(
    OUT_FLAGS,
    JSON.stringify(
      {
        generatedBy: "scripts/compile-hints.ts",
        warning:
          "ANSWER KEY — do NOT feed to the solver. Salt-derived flags are " +
          "valid only for the cohort sharing this CTF_SALT fingerprint.",
        saltFingerprint: saltFp,
        saltResolved: salt !== null,
        targetCount: flags.length,
        flags,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  const authored = targets.filter((t) => t.hasHint).length;
  const saltMsg = salt
    ? `flags keyed to salt fp:${saltFp}`
    : "CTF_SALT unset — salt-derived flags emitted as null";
  // eslint-disable-next-line no-console
  console.log(
    `Compiled ${authored}/${targets.length} hinted targets → ` +
      `docs/COMPILED-HINTS.md, docs/compiled-hints.json; ` +
      `${flags.length} flags → docs/compiled-flags.json (${saltMsg})`,
  );
}

main();
