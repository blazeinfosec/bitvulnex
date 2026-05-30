// Phase 11 slice 4 — single source of truth for the 44 CTF targets.
//
// Used by:
//   - GET /api/v2/ctf/targets        (trainee catalog endpoint)
//   - POST /api/v2/ctf/submit        (validate the targetKey)
//   - scripts/derive-flags.ts        (kept in sync; tests assert)
//   - /admin/ctf scoreboard          (iterate the catalog for analytics)
//   - /ctf trainee page              (replace hardcoded PLANT_KEYS)
//
// Order is deliberate — V-NNN by ascending number, then chains.
// Difficulty levels mirror VULNS.md's `Intended discovery difficulty`
// field (easy / medium / hard / expert).

export type TargetPattern = "A" | "B" | "C";
export type TargetKind = "plant" | "chain";
export type TargetDifficulty = "easy" | "medium" | "hard" | "expert";

export type TargetRecord = {
  key: string;
  kind: TargetKind;
  pattern: TargetPattern;
  category: string;
  difficulty: TargetDifficulty;
};

export const ALL_TARGETS: readonly TargetRecord[] = [
  // ── Plants (40) ─────────────────────────────────────────────────
  { key: "V-1",  kind: "plant", pattern: "B", category: "OWASP / XSS",                       difficulty: "easy" },
  { key: "V-4",  kind: "plant", pattern: "A", category: "OWASP / Access control / IDOR",     difficulty: "easy" },
  { key: "V-6",  kind: "plant", pattern: "B", category: "OWASP / Auth / Trust boundary",     difficulty: "medium" },
  { key: "V-8",  kind: "plant", pattern: "B", category: "OWASP / Auth",                      difficulty: "easy" },
  { key: "V-9",  kind: "plant", pattern: "C", category: "Auth / Infra",                      difficulty: "easy" },
  { key: "V-10", kind: "plant", pattern: "B", category: "OWASP / Auth — predictable token",  difficulty: "easy" },
  { key: "V-11", kind: "plant", pattern: "B", category: "OWASP / SQLi",                      difficulty: "medium" },
  { key: "V-12", kind: "plant", pattern: "B", category: "OWASP / SQLi",                      difficulty: "medium" },
  { key: "V-13", kind: "plant", pattern: "B", category: "OWASP / Auth — open redirect",      difficulty: "easy" },
  { key: "V-14", kind: "plant", pattern: "B", category: "OWASP / Path traversal",            difficulty: "easy" },
  { key: "V-15", kind: "plant", pattern: "C", category: "Infra / Supply chain",              difficulty: "medium" },
  { key: "V-17", kind: "plant", pattern: "B", category: "OWASP / Command injection",         difficulty: "medium" },
  { key: "V-18", kind: "plant", pattern: "B", category: "OWASP / XSS / mXSS",                difficulty: "medium" },
  { key: "V-19", kind: "plant", pattern: "B", category: "OWASP / Auth — key confusion",      difficulty: "medium" },
  { key: "V-20", kind: "plant", pattern: "B", category: "OWASP / Path traversal",            difficulty: "medium" },
  { key: "V-21", kind: "plant", pattern: "B", category: "OWASP / Auth — refresh reuse",      difficulty: "hard" },
  { key: "V-22", kind: "plant", pattern: "A", category: "OWASP / Mass assignment",           difficulty: "medium" },
  { key: "V-23", kind: "plant", pattern: "B", category: "WebSocket / CSWSH",                 difficulty: "medium" },
  { key: "V-24", kind: "plant", pattern: "B", category: "Crypto / BTC protocol",             difficulty: "medium" },
  { key: "V-25", kind: "plant", pattern: "A", category: "Business logic / Market manipulation", difficulty: "medium" },
  { key: "V-26", kind: "plant", pattern: "B", category: "Crypto / Business logic",           difficulty: "easy" },
  { key: "V-27", kind: "plant", pattern: "B", category: "KYC tier — type confusion",         difficulty: "easy" },
  { key: "V-28", kind: "plant", pattern: "B", category: "Crypto / Race condition",           difficulty: "hard" },
  { key: "V-30", kind: "plant", pattern: "B", category: "Business logic",                    difficulty: "hard" },
  { key: "V-32", kind: "plant", pattern: "B", category: "Crypto / Race condition",           difficulty: "hard" },
  { key: "V-33", kind: "plant", pattern: "B", category: "Crypto / BTC / Business logic",     difficulty: "expert" },
  { key: "V-34", kind: "plant", pattern: "B", category: "OWASP / Prototype pollution",       difficulty: "hard" },
  { key: "V-35", kind: "plant", pattern: "B", category: "Framework / Auth",                  difficulty: "medium" },
  { key: "V-40", kind: "plant", pattern: "A", category: "SSRF",                              difficulty: "medium" },
  { key: "V-41", kind: "plant", pattern: "B", category: "OWASP / XSS / Upload",              difficulty: "medium" },
  { key: "V-42", kind: "plant", pattern: "B", category: "Business logic / Race condition",   difficulty: "hard" },
  { key: "V-43", kind: "plant", pattern: "B", category: "Business logic / Crypto-finance arithmetic", difficulty: "hard" },
  { key: "V-44", kind: "plant", pattern: "B", category: "Business logic / Crypto-finance arithmetic", difficulty: "medium" },
  { key: "V-45", kind: "plant", pattern: "B", category: "Crypto / Race condition",           difficulty: "hard" },
  { key: "V-46", kind: "plant", pattern: "A", category: "Auth / Trust boundary",             difficulty: "medium" },
  { key: "V-47", kind: "plant", pattern: "A", category: "Crypto / BTC protocol",             difficulty: "hard" },
  { key: "V-48", kind: "plant", pattern: "C", category: "Infra / Supply chain / Secrets",    difficulty: "easy" },
  { key: "V-49", kind: "plant", pattern: "C", category: "Infra / Supply chain",              difficulty: "medium" },
  { key: "V-50", kind: "plant", pattern: "B", category: "Infra / OWASP / HTTP smuggling",    difficulty: "hard" },
  { key: "V-51", kind: "plant", pattern: "A", category: "OWASP / Broken access control",     difficulty: "medium" },

  // ── Killer chains (4) ───────────────────────────────────────────
  { key: "CHAIN-A", kind: "chain", pattern: "B", category: "Crypto / Trust boundary chain",  difficulty: "hard" },
  { key: "CHAIN-B", kind: "chain", pattern: "B", category: "Infra / Auth — smuggling chain", difficulty: "expert" },
  { key: "CHAIN-C", kind: "chain", pattern: "B", category: "Business logic — oracle chain",  difficulty: "hard" },
  { key: "CHAIN-D", kind: "chain", pattern: "B", category: "SSRF → metadata → exfil chain",  difficulty: "medium" },
];

export const TARGET_KEYS: readonly string[] = ALL_TARGETS.map((t) => t.key);

export function isKnownTarget(key: string): boolean {
  return ALL_TARGETS.some((t) => t.key === key);
}

export function targetCounts(): { plants: number; chains: number; total: number } {
  let plants = 0;
  let chains = 0;
  for (const t of ALL_TARGETS) {
    if (t.kind === "plant") plants++;
    else chains++;
  }
  return { plants, chains, total: plants + chains };
}
