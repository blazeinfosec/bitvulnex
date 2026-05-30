# Phase 11 slice 3.x — hint authoring backlog

> **Why this file exists.** Slice 3 (commit `5e9f83f`) shipped the
> hint engine + 10/40 V-NNN exemplars + 4 chains. The L7 review (slice-
> 3-l7-review.md, finding N-1) ratified that the remaining 30 hint
> files are pure authoring labor — no code change — and recommended
> tracking them here so the gap doesn't get silently dropped before
> the first external cohort runs.

Until a file ships, the corresponding target's GET `/api/v2/ctf/hints/...`
endpoint returns `{"error":{"message":"unknown target"}}`. The /ctf
UI surfaces this gracefully as "no hint authored yet" — the trainee
can still submit a flag for that target, but no progressive nudge is
available.

## Shipped (10 plants + 4 chains = 14 files)

| Target | Category | File |
|--------|----------|------|
| V-1    | OWASP / XSS — stored | `V-1.md` |
| V-4    | OWASP / Access control / IDOR | `V-4.md` |
| V-9    | Auth / Infra — weak default secret | `V-9.md` |
| V-13   | OWASP / Auth — open redirect | `V-13.md` |
| V-14   | OWASP / Path traversal | `V-14.md` |
| V-22   | OWASP / Mass assignment | `V-22.md` |
| V-25   | Business logic — market manipulation | `V-25.md` |
| V-40   | SSRF | `V-40.md` |
| V-46   | Auth / Trust boundary — header trust | `V-46.md` |
| V-51   | OWASP / Broken access control — mass assignment | `V-51.md` |
| CHAIN-A | Crypto / Trust boundary chain | `CHAIN-A.md` (3 steps) |
| CHAIN-B | Infra / Auth — request smuggling into mass assignment | `CHAIN-B.md` (3 steps) |
| CHAIN-C | Business logic — oracle manipulation → liquidation cascade | `CHAIN-C.md` (3 steps) |
| CHAIN-D | SSRF → cloud-metadata → PII exfiltration | `CHAIN-D.md` (3 steps) |

## Open (30 V-NNN)

Authoring order: the easy-difficulty plants land first so the gap
matters less for early-cohort trainees. The harder ones can wait — a
trainee that's deep enough to attempt V-33 PSBT polyglot doesn't need
a category-level nudge.

### Easy (8) — author first

| Target | Category | Lab area | Notes |
|--------|----------|----------|-------|
| V-6    | OWASP / Auth / Trust boundary | Middleware + nginx strip list | Pairs with V-46's "edge strip list" framing. |
| V-8    | OWASP / Auth | JWT v1 verifier | "Some auth path accepts a token whose signing claim is too permissive." |
| V-10   | OWASP / Auth — predictable token | Password reset request | Sequential / time-based reset codes. |
| V-19   | OWASP / Auth — key confusion | JWT v1 verifier | "Symmetric verifier might accept the wrong kind of key." |
| V-26   | Crypto / Business logic — limit window | Withdrawal limit ledger | UTC boundary lets two same-asset withdrawals slip through. |
| V-27   | KYC tier — type confusion | requireTier | String coercion in numeric comparisons. |
| V-32   | Crypto / Race condition | Order cancel + match | Cancel during partial fill can produce a double-refund. |
| V-49   | Infra / Supply chain | Dependency manifest | "A private-scope dep reference without a registry pin." |

### Medium (15)

| Target | Category | Lab area |
|--------|----------|----------|
| V-11   | OWASP / SQLi (admin search "perf" mode) | Admin user-search |
| V-12   | OWASP / SQLi (stored displayName) | Compliance report builder |
| V-15   | OWASP / Prototype pollution (xml2js) | Sanctions importer |
| V-17   | OWASP / Command injection | Compliance PDF export |
| V-18   | OWASP / XSS / mXSS | Markdown sanitizer (admin tickets) |
| V-20   | OWASP / Path traversal | JWT kid → key file |
| V-21   | OWASP / Auth — refresh-token reuse | Refresh endpoint |
| V-23   | WebSocket / CSWSH | ws-gateway upgrade |
| V-24   | Crypto / BTC protocol — normalization | bech32 validator |
| V-28   | Crypto / Race condition | Withdrawal limit check + balance debit |
| V-30   | Business logic | Internal transfer (skips limit) |
| V-34   | OWASP / Prototype pollution (hand-rolled deepMerge) | Feature flags |
| V-35   | Framework / Auth — middleware-subrequest | Middleware short-circuit |
| V-41   | OWASP / XSS / Upload — polyglot KYC | Admin KYC viewer |
| V-44   | Business logic / Crypto-finance arithmetic | Yield accrual ordering |

### Hard / Expert (7)

| Target | Category | Lab area |
|--------|----------|----------|
| V-33   | Crypto / BTC / Business logic (Mt. Gox flavor) | PSBT validate-vs-broadcast mismatch |
| V-42   | Business logic / Race condition | Deposit watcher zero-conf credit |
| V-43   | Business logic / Crypto-finance arithmetic | Fee-tier maker-side filter miss |
| V-45   | Crypto / Race condition | Staking claim concurrent update |
| V-47   | Crypto / BTC protocol | RBF fee-bump sync credit (no compensating watcher) |
| V-48   | Infra / Supply chain / Secrets | Recon — `.env.bak` git history |
| V-50   | Infra / OWASP / HTTP smuggling | nginx CL+TE + Node insecure-parser |

## How to author

1. `cp docs/hints/V-4.md docs/hints/V-XX.md` (or `CHAIN-Y.md` for chains).
2. Edit the front matter: target, category, tier-1-basic, tier-2-verbose.
3. Run `pnpm -w run test` — `hints.test.ts` re-loads every file and
   re-validates depth-ceiling. Broken hints fail the build.
4. With CTF_MODE=true + hints enabled, GET `/api/v2/ctf/hints/V-XX?tier=basic`
   smoke-checks the file loads at runtime. (No web restart needed —
   the loader caches at module-init, but the bind-mount picks up the
   file on next reload. Until then a `docker compose restart web`
   clears the cache; slice-3 N-2 follow-up will add a `/admin/ctf
   /reload-hints` action so instructors can refresh without a
   restart.)

## Acceptance for marking the backlog "done"

- All 40 V-NNN files present + 4 CHAIN files (40 + 4 = 44 records
  loaded; chain steps explode to ~12 step records — see hints.test.ts
  exact-count assertion if you tighten it).
- `pnpm -w run test` green.
- No file violates the depth ceiling: basic ≤ 200 char + no
  paths/CVEs/payloads; verbose ≤ 600 char + no paths/line-nums/shell.
- Spot-check 3 random hints in an actual cohort run with a trainee
  who hasn't read VULNS.md — confirm the basic hint guides toward
  the class of vuln without naming the file, and verbose adds enough
  context to start probing.

This is content labor (~30 files × 5 minutes each ≈ 2-3 hours). Can
ship as a single PR with no code review beyond the validator's CI
sign-off.
