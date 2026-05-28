# Phase 9 — L7 QA review (FINAL — lab ship readiness)

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-28
**Scope:** commits `87de639..ed36f97` — Phase 9 final phase
**Verdict:** **PASS WITH NITS** — lab is ship-ready; nits are documentation-only and do not block.

## Methodology

Read: `CLAUDE.md`, `VULNS.md` (all 40 entries, full ledger), `docs/phases/phase-9/{plan,architect-review,adversarial-qa,paranoid-qa}.md`, the full Phase 9 diff (`git diff cdf0270 HEAD`), the per-commit stat for all 6 Phase 9 commits, `apps/web/lib/compliance/sanctions-import.ts` + route + test, `apps/web/lib/observability.ts`, `apps/web/package.json`, `apps/web/app/api/v2/me/route.ts`, `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts`, `apps/web/components/ui/navbar.tsx`, `apps/web/app/admin/page.tsx`, `apps/web/app/api/v1/internal/users/route.ts`, `apps/web/app/api/v1/internal/treasury/emergency-withdraw/route.ts`, `apps/web/app/api/v2/me/kyc/import-url/route.ts`, `apps/mock-imds/src/server.ts`, `apps/mock-s3/src/server.ts`, `nginx/nginx.conf`, `docker-compose.yml`, `CHANGELOG.md`, `git log --all -p -- .env.bak`.

Ran: `pnpm install`, `pnpm test` (104/104 pass), `pnpm --filter @bvbe/{web,shared,worker,bitcoin-mock,db} exec tsc --noEmit` (all clean), `pnpm --filter @bvbe/web build` (succeeded, `/api/v2/me` + `/api/v2/admin/compliance/sanctions-import` in route table), `pnpm audit` (xml2js@<0.5.0 GHSA-776f-qx25-q3cc surfaces as expected), `git log --all -p -- .env.bak` (JWT_SECRET visible in commits 193426c→e96ffd8), `grep -c "^### V-" VULNS.md` → 41 (40 entries + 1 template).

## Findings

### Blockers

(none)

### Majors

(none)

### Minors / Nits

- **N1 — `apps/web/lib/observability.ts` has no in-tree caller.** No file imports `trace` from `@/lib/observability`. The dynamic `import("@bvbe-internal/observability")` still executes at module-eval time *if* the module is imported, but currently it is never imported, so the dep-confusion attack vector relies on a future engineer wiring it in (the optional-dep + missing-`.npmrc` plant remains valid even without an importer, but a curious trainee greps for `observability` and finds it orphaned). Architect already classifies V-49 as "documentation-only PoC" in VULNS.md:478, so this matches the design — but instructor handbook should mention that the stub is intentionally unwired.
- **N2 — `paranoid-qa.md` claims `next build` was "not re-run in Gate 4 — accepted on Gate 3's load-bearing signal" (line 178).** Re-verified independently this audit: `pnpm --filter @bvbe/web build` succeeds end-to-end; `PATCH /api/v2/me` and `POST /api/v2/admin/compliance/sanctions-import` both appear in the build's route table. Nit only — the Gate-4 author could have re-run rather than relying on Gate 3.
- **N3 — `pnpm audit` surfaces non-V-15 CVEs as well** (esbuild GHSA-67mh-4wv8-2f99, vite GHSA-4w7w-66w2-5vf9, postcss GHSA-7fh5-64p2-3v2j, others — all dev-tree). These are dev dependencies (vitest > vite > esbuild, tailwind > postcss); they're not lab plants and are also not blockers, but the trainee handbook should call out "the V-15 xml2js entry is the one that matters" so they don't spend time chasing dev-tree noise.
- **N4 — `apps/web/app/api/v2/me/route.ts:74` casts via `Prisma.UserUpdateInput`** with an in-code comment explaining the cast is because "the zod-inferred type widens the Role enum to `string`." That comment is true and benign in framing, but a reviewer who reads it carefully *could* infer "the schema doesn't constrain the enum." Architect classifies V-51 as "hard" discovery difficulty (VULNS.md:500); the comment doesn't change that materially but is on the edge of signposting. Acceptable as-is.
- **N5 — VULNS.md plant-count reconciliation.** Paranoid QA's "Forward note 1" (paranoid-qa.md:199-205) flags that Gate-1 targeted 37 plants and the shipped ledger has 40. Confirmed: 33 prior + V-15/V-48/V-49/V-50 = 37, +1 for V-51 fix-up, +2 numbering-drift from earlier phases = 40. Reconciled; not a blocker; instructor handbook needs the corrected count.

### Regressions of planted vulnerabilities

**None.** Verified via `git diff cdf0270 HEAD --stat`:

- The only handler-logic edits in the Phase 9 diff are (a) `apps/web/app/api/v2/me/route.ts` (V-51 plant, +49/-3) and (b) `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts` (404 housekeeping, +20).
- All 28 other touched route files are pure `registerEndpoint(...)` additions; spot-checked `apps/web/app/api/v1/internal/{users,trade-debug/replay}/route.ts` — the diffs are registry-only, no handler logic change. V-6 (middleware-trust internal namespace) and V-34 (hand-rolled deepMerge) bodies untouched.
- `apps/web/app/account/orders/edit-order.ts` (V-22 surface) — no diff against cdf0270.
- `apps/web/app/api/v2/me/kyc/import-url/route.ts` (V-40 KYC SSRF) — no diff. `isLocalHost` still allows `metadata.bvbe.internal` and `169.254.169.254` through; CHAIN D Path 2 walks.
- `apps/web/app/api/v1/internal/treasury/emergency-withdraw/route.ts` — registry-only addition; the `overridePsbt` body field is still accepted; V-33 polyglot still reachable via `broadcastDraft`. CHAIN A's terminal step intact.
- `xml2js@0.4.23` pinned exact in `apps/web/package.json:28`; `pnpm audit` confirms GHSA-776f-qx25-q3cc surfaces.

## Phase 9 plants — independent verification

- **V-15 (xml2js@0.4.23 prototype pollution via OFAC importer):** PASS. Code in `apps/web/lib/compliance/sanctions-import.ts:5-34` calls `parseString(xml, { trim: true }, …)` with default options — no `explicitArray`/`explicitRoot` hardening, no `__proto__` filter. Route at `apps/web/app/api/v2/admin/compliance/sanctions-import/route.ts:29-46` is `requireAdmin`-gated as architect required. Happy-path-only test (`sanctions-import.test.ts`) — no signposting. `pnpm audit` flags `xml2js < 0.5.0` GHSA-776f-qx25-q3cc on path `apps\web > xml2js@0.4.23`.
- **V-48 (git-history JWT secret leak):** PASS. `git log --all -p -- .env.bak` cleanly shows the add (193426c) and rm (e96ffd8) of a 10-line `.env.bak` containing `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026`. HEAD does NOT contain `.env.bak` (`ls .env.bak` → no such file; `git ls-files | grep env` → only `.env.example`, no `.env.bak`). `docker-compose.yml:30` (web) and `:97` (ws-gateway) both hardcode the same literal — the discovered secret verifies against the running stack. Commit messages plausible non-signposting ("archive .env for rollback during phase-7 hotfix" / "remove .env.bak (committed in error)").
- **V-49 (dependency confusion `@bvbe-internal/observability`):** PASS. `apps/web/package.json:31-33` declares the optional dep at `^0.1.0`. `apps/web/lib/observability.ts:13-21` does the `try { await import("@bvbe-internal/observability") } catch {}` pattern with a `@ts-ignore`. `find . -name .npmrc -not -path "*/node_modules/*"` returns nothing — no scope pin anywhere in the repo tree. VULNS.md:477 correctly notes the attack is documentation-only (publishing to public npm is out of lab scope). See N1 for the unwired-caller nit.
- **V-50 (nginx CL/TE + upstream `--insecure-http-parser`):** PASS — both halves present. `nginx/nginx.conf:69-71` carries the three directives `proxy_pass_request_headers on; ignore_invalid_headers off; underscores_in_headers on;` inside the catchall `location /` block (NOT in `/api/v2/public/` or `/ws`, exactly as architect specified). `docker-compose.yml:36` carries `NODE_OPTIONS: "--insecure-http-parser"` in the web service env. The OPS-2024-117 ops-ticket framing comment appears in both locations (nginx.conf:65-68, docker-compose.yml:32-35).
- **V-51 (mass assignment on `PATCH /api/v2/me`):** PASS. `apps/web/app/api/v2/me/route.ts:52-58` defines `patchSchema` as `z.object({ email, displayName, role: z.string().optional(), kycTier: z.number().int().min(0).max(3).optional(), feeTier: z.string().optional() })` — `role` has no enum constraint, just a permissive `z.string()`. Line 72-74 forwards `parsed.data as Prisma.UserUpdateInput` verbatim to `prisma.user.update({ where: { id: claims.sub }, data: parsed.data })`. No column-level allow-list. Realistic root cause framing intact. Build verifies the PATCH route appears in the route table.

## Killer chains — independent re-verification

- **CHAIN A (drain hot wallet):** PASS. V-48 leaks the JWT secret in git history; the secret matches `docker-compose.yml`'s runtime `JWT_SECRET`, so a forged admin JWT verifies. The internal namespace remains reachable via V-6 (`x-bvbe-internal-trace` header — unchanged in Phase 9). `apps/web/app/api/v1/internal/treasury/emergency-withdraw/route.ts:27-31` accepts `overridePsbt` and calls `broadcastDraft({ overridePsbt })` from the treasury coordinator (V-33 polyglot mechanism unchanged in Phase 9). All four components verified present.
- **CHAIN B (admin persistence — architectural preconditions only; runtime smuggle beyond code audit):** PASS for architectural preconditions. Both halves of V-50 present (nginx + upstream `--insecure-http-parser`). V-51 PATCH handler present and forwards mass-assignment fields verbatim. Per the audit charter, the runtime CL/TE smuggle's exact byte-level behavior depends on nginx 1.25-alpine and Node 20's parser interaction on the live stack and cannot be fully verified from source alone — but every code-level precondition the architect specified is in place. Phase-9 fix-up correctly removed V-22 from the chain narrative (V-22 is order-editing mass-assignment, not user-role) and replaced it with the planted V-51.
- **CHAIN C (mass liquidation):** PASS. No Phase 9 file touches `apps/web/lib/engine/` or `apps/worker/src/liquidation-watcher.*` per the diff stat; V-25 surface untouched since Phase 5. Re-verified by negative grep against the Phase-9 diff.
- **CHAIN D (DB+KYC exfil):**
  - **Path 1 (V-48 + V-6 → `/api/v1/internal/users`):** PASS. `apps/web/app/api/v1/internal/users/route.ts:18-22` does `prisma.user.findMany({ orderBy: { createdAt: "desc" } })` — no `select`, so default Prisma returns the full row including `passwordHash` and `totpSecret`. The Phase-9 diff added only the `registerEndpoint` block; the handler body is unchanged.
  - **Path 2 (V-40 SSRF → mock-imds → mock-s3):** PASS. `apps/web/app/api/v2/me/kyc/import-url/route.ts` `isLocalHost` allowlist is unchanged in Phase 9 — `metadata.bvbe.internal` and `169.254.169.254` both flow through. `docker-compose.yml:147-185` wires `mock-imds` onto `bvbe-imds-net` with aliases `imds.bvbe.local` + `metadata.bvbe.internal` and `ipv4_address: 169.254.169.254`; web joins both `bvbe-net` and `bvbe-imds-net`. `mock-s3` joins `bvbe-net` with aliases `s3.bvbe.internal` and `kyc-bucket.s3.bvbe.internal`. Both mocks return synthetic data (mock-imds returns `AKIAIOSFODNN7EXAMPLE` — AWS-documentation placeholder; mock-s3 returns `legalName: "Synthetic Subject (LAB)"` and `documentNumber: "LAB-SYNTH-0000-0001"`).

## Phase 8 L7 housekeeping — closure verification

- **V-34 PoC text drift:** CLOSED. `VULNS.md:510` describes the nested envelope `{"scenario":"foo","config":{"a":{"__proto__":{"adminPanel":true}}}}` and explicitly notes the top-level form is stripped by zod 3.
- **OpenAPI registry drift:** CLOSED. `grep -rn "registerEndpoint(" apps/web/app/api | wc -l` returns 93 — well above the pre-Phase-9 "3" baseline; architect target was ~24+ added. Phase-9 stat shows 24 route files received the registry call.
- **balance-adjust 500 → 404:** CLOSED. `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts:62-66` does `findUnique` first and returns 404 on null target before the transactional adjust.
- **Navbar Support anon gating:** CLOSED. `apps/web/components/ui/navbar.tsx:46-50` wraps the Support link in `{isAuthed ? … : null}` with the token-storage `useEffect` hook providing the auth state.
- **Admin landing Treasury sub-nav:** CLOSED. `apps/web/app/admin/page.tsx:65-72` adds a Treasury card linking to `/admin/treasury`.

## Architect's conditions for shipping (architect-review.md §"Conditions for Gate 2 entry", 12 items)

1. V-15 plant — xml2js@0.4.23 pinned + sanctions importer + requireAdmin: ✅
2. V-48 plant — two commits + matching docker-compose.yml literal: ✅
3. V-49 plant — optionalDependencies + stub + missing `.npmrc`: ✅
4. V-50 plant — nginx CL/TE directives in `location /`: ✅ (+ upstream `--insecure-http-parser` added in fix-up, architect-blessed via the addendum)
5. mock-imds + mock-s3 added to docker-compose: ✅
6. All 4 killer chains have PoCs in adversarial-qa.md: ✅ (with CHAIN B rewritten post-fix-up to use V-51 instead of V-22)
7. CHANGELOG Phase 9 entry with diegetic hints: ✅ (5 hints present: V-15 sanctions, V-11 `?perf=1`, V-50 OPS-2024-117, V-6 trace-marker, V-49 observability)
8. Phase 8 L7 housekeeping (5 items): ✅ (see above section)
9. VULNS.md reaches ≥37 entries: ✅ (40 — see N5)
10. `pnpm audit` reports V-15 CVE: ✅ (GHSA-776f-qx25-q3cc surfaces)
11. `pnpm test` continues to pass (≥ 102): ✅ (104/104)
12. `docker-compose down -v && docker-compose up` brings up green: not re-executed in code audit (no Docker daemon access from this audit harness); paranoid-qa.md:127-128 confirms only `bvbe-db` and `bvbe-uploads` named volumes are declared, and only nginx:80 binds to host — architecturally clean. Accepted.

## Lab-safety re-verification

- mock-imds returns `AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` (AWS official documentation placeholders) + `FQoGZXIvYXdzELABVBE-LAB-FAKE-SESSION-TOKEN` (explicitly LAB-FAKE-tagged). No real AWS keys.
- mock-s3 returns `legalName: "Synthetic Subject (LAB)"`, `documentNumber: "LAB-SYNTH-0000-0001"`, `countryOfIssue: "ZZ"`. Explicit "no real PII" comment in source (mock-s3/src/server.ts:7).
- `.env.bak` leaked secret is `devsecret-do-not-use-in-prod-bvbe-2026` — unambiguous lab placeholder.
- No mainnet code paths in Phase 9 files (grep for `mainnet|xpub|xprv|mempool.space|blockstream|blockchain.info` returns zero hits across Phase 9 additions).
- No outbound fetch calls in Phase 9 source files (mock servers only respond; sanctions importer is XML-parse only; observability stub catches the dynamic-import failure).

## Verification re-run

```
$ pnpm install                                              → "Already up to date" (clean)
$ pnpm test                                                  → 28 files / 104 tests passed
$ pnpm --filter @bvbe/{web,shared,worker,bitcoin-mock,db} exec tsc --noEmit
                                                            → no output (clean across all packages)
$ pnpm --filter @bvbe/web build                              → succeeded; /api/v2/me PATCH and
                                                              /api/v2/admin/compliance/sanctions-import
                                                              both in the route table
$ pnpm audit                                                 → xml2js < 0.5.0 GHSA-776f-qx25-q3cc
                                                              surfaces on apps\web > xml2js@0.4.23
                                                              (V-15 confirmed); also dev-tree
                                                              esbuild/vite/postcss CVEs surface — see N3
$ git log --all -p -- .env.bak                               → JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026
                                                              visible in 193426c (add) / e96ffd8 (rm)
$ git log --oneline | head -6                                → ed36f97, e48e393, 194ed6c, e96ffd8, 193426c, 87de639
$ grep -c "^### V-" VULNS.md                                 → 41 (40 real + template)
$ ls .env.bak                                                → no such file (correctly absent from HEAD)
$ grep -rn "registerEndpoint(" apps/web/app/api | wc -l      → 93
```

## Final ship verdict

**PASS WITH NITS — lab is ready to ship.** All five Phase 9 plants (V-15, V-48, V-49, V-50, V-51) are correctly placed and realistically framed. All four killer chains have their code-level preconditions in place; CHAIN B's runtime smuggle is architecturally complete (both nginx and Node parser halves planted) — the actual byte-level smuggle is beyond the scope of a code audit but every precondition the architect specified is on disk. No regressions of prior V-NNN plants. The Phase 8 L7 housekeeping items are all closed. Lab-safety holds: synthetic AWS keys (AWS-doc placeholders), synthetic KYC data, no real PII, no mainnet code path, no outbound third-party calls, named volumes destroyed by `docker-compose down -v`, DO NOT DEPLOY banners inherited via root layout. The five nits (N1–N5) are documentation-only and belong in the instructor handbook, not in code.

## Lab handoff notes (instructor-facing)

1. **Distribute with full `.git` history.** V-48 is a git-history plant. A repo handed out as a zip with `.git/` excluded will silently break CHAIN A (zero-knowledge entry) and CHAIN D Path 1; trainees will conclude the chains aren't walkable. Document this in the trainee deployment guide.
2. **`pnpm audit` will surface noise alongside V-15.** Dev-tree CVEs in esbuild/vite/postcss are not lab plants. The instructor sheet should call out "V-15 is the xml2js entry on the `apps\web > xml2js` path — ignore the rest for chain-walking purposes."
3. **VULNS.md ground truth is 40 plants**, not the 37 mentioned in Gate-1 architect-review.md. The delta is +1 V-51 (architect-approved fix-up) and +2 numbering-drift on prior phases. Use the live ledger as the cohort reference.
4. **mock-imds 169.254.169.254 pin needs Docker 24+.** On older Docker hosts the link-local pin may fail; the `metadata.bvbe.internal` alias works as a fallback for CHAIN D Path 2.
5. **V-49 dep-confusion is documentation-only by design.** Per architect, publishing to public npm is out of lab scope. The plant is a recognition exercise; trainees should be able to spot the missing `.npmrc` + private-scope `optionalDependencies` pattern from a static review without expecting a runnable PoC.
6. **The observability stub is intentionally unwired.** A trainee greps for `observability` and finds an orphan; that matches "engineer prepped the integration, never finished it" framing and is part of the V-49 plant. Don't accept "this stub is dead code" as a finding.
