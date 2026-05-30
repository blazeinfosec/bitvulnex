// Phase 11 slice 3 — hint markdown loader + depth-ceiling validator.
//
// Per spec, the hint subsystem is two-tier:
//   - basic   (tier=1): category-only — what KIND of vuln class
//   - verbose (tier=2): lens + category — guides investigation
//
// Architect addendum condition #6: the depth validator runs in CI, not
// at runtime. Broken hints must fail `pnpm test`, not be served as-is.
// The validator (validateHint) is exported here AND invoked from
// hints.validator.test.ts so a malformed front-matter ships as a test
// failure.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type HintTier = 1 | 2;

export type HintRecord = {
  targetKey: string;
  category: string;
  tier1Basic: string;
  // Chain steps store an ordered list. V-NNN files have a single step.
  // Both forms expose tier1Basic + tier2Verbose for the chosen step.
  tier2Verbose: string;
  // For chain steps: the step number (1-indexed).
  step?: number;
};

const HINTS_DIR = join(process.cwd(), "..", "..", "docs", "hints");
// During Next.js dev with bind-mounted /repo/docs, the CWD when route
// handlers run is /repo/apps/web. ../../docs/hints resolves correctly.
// In tests, jest/vitest runs from repo root via `pnpm -w` so we fall
// back to docs/hints if the bind-mount path doesn't exist.
const FALLBACK_HINTS_DIR = join(process.cwd(), "docs", "hints");

function hintsDir(): string {
  if (existsSync(HINTS_DIR)) return HINTS_DIR;
  return FALLBACK_HINTS_DIR;
}

export class HintValidationError extends Error {
  constructor(
    public targetKey: string,
    public tier: HintTier,
    message: string,
  ) {
    super(`hint validation failed for ${targetKey} tier-${tier}: ${message}`);
  }
}

// Substrings that violate the depth ceiling (basic = category only;
// verbose = lens + category, never location or repro payload).
//
// HTTP method patterns use word boundaries + case-sensitive matching
// so prose verbs like "get through" / "post a message" don't trip the
// regex meant to catch literal `GET /api/v2/me` style payloads.
const FORBIDDEN_BASIC =
  /apps\/|packages\/|nginx\/|CVE-|__proto__|prisma\.|\$queryRaw|\bcurl |\bline\s+\d+|\bGET \/|\bPOST \/|\bPATCH \/|\bDELETE \/|:\d+\b/;
const FORBIDDEN_VERBOSE =
  /apps\/|packages\/|nginx\/|\bcurl |\bline\s+\d+|\bGET \/|\bPOST \/|\bPATCH \/|\bDELETE \/|:\d+\b/;
// Note: verbose can mention CVE-… (V-15 specifically), zod schemas,
// dangerouslySetInnerHTML, etc. — those are "lens" cues. Explicit
// file paths and line numbers are still forbidden.

export function validateHint(record: HintRecord): void {
  const { targetKey, tier1Basic, tier2Verbose } = record;
  if (tier1Basic.length === 0)
    throw new HintValidationError(targetKey, 1, "empty");
  if (tier2Verbose.length === 0)
    throw new HintValidationError(targetKey, 2, "empty");
  if (tier1Basic.length > 200)
    throw new HintValidationError(
      targetKey,
      1,
      `length ${tier1Basic.length} > 200 char ceiling`,
    );
  if (tier2Verbose.length > 600)
    throw new HintValidationError(
      targetKey,
      2,
      `length ${tier2Verbose.length} > 600 char ceiling`,
    );
  if (FORBIDDEN_BASIC.test(tier1Basic))
    throw new HintValidationError(
      targetKey,
      1,
      "basic must be category-only — no file paths, line numbers, payloads, or CVE refs",
    );
  if (FORBIDDEN_VERBOSE.test(tier2Verbose))
    throw new HintValidationError(
      targetKey,
      2,
      "verbose must be lens + category — no file paths, line numbers, or shell commands",
    );
}

// Tiny front-matter parser. Recognizes:
//   target: <id>
//   category: <text>
//   tier-1-basic: |
//     <multi-line>
//   tier-2-verbose: |
//     <multi-line>
//   steps:
//     1:
//       tier-1-basic: <inline>
//       tier-2-verbose: <inline>
//     2: ...
//
// Deliberately NOT using `js-yaml` to keep deps light and avoid YAML's
// many footguns (anchors, references, type coercion). The format is
// rigid enough that a 50-line parser suffices.
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
          // Read indented block lines.
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
            if (sub.match(/^\s{2}\d+:\s*$/)) break; // next step
            if (!sub.match(/^\s{4,}/)) break; // back to top-level
            i++;
            const m = sub.match(/^\s{4}(tier-1-basic|tier-2-verbose):\s*"(.*)"\s*$/);
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

let CACHE: Map<string, HintRecord> | null = null;

export function loadAllHints(): Map<string, HintRecord> {
  if (CACHE) return CACHE;
  const dir = hintsDir();
  const map = new Map<string, HintRecord>();
  if (!existsSync(dir)) {
    CACHE = map;
    return map;
  }
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf-8");
    const fm = parseFrontMatter(text);
    if (fm.steps) {
      // Chain file — emit one record per step keyed CHAIN-X-STEP-N.
      for (const [stepNum, step] of Object.entries(fm.steps)) {
        const key = `${fm.target}-STEP-${stepNum}`;
        const rec: HintRecord = {
          targetKey: key,
          category: fm.category,
          tier1Basic: step.tier1Basic,
          tier2Verbose: step.tier2Verbose,
          step: Number(stepNum),
        };
        validateHint(rec);
        map.set(key, rec);
      }
    } else if (fm.tier1Basic !== undefined && fm.tier2Verbose !== undefined) {
      const rec: HintRecord = {
        targetKey: fm.target,
        category: fm.category,
        tier1Basic: fm.tier1Basic,
        tier2Verbose: fm.tier2Verbose,
      };
      validateHint(rec);
      map.set(fm.target, rec);
    }
  }
  CACHE = map;
  return map;
}

export function clearHintCache(): void {
  CACHE = null;
}

export function loadHint(
  targetKey: string,
  tier: HintTier,
): { category: string; text: string } | null {
  const all = loadAllHints();
  const rec = all.get(targetKey);
  if (!rec) return null;
  return {
    category: rec.category,
    text: tier === 1 ? rec.tier1Basic : rec.tier2Verbose,
  };
}
