# Phase 2 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer (same role as Phase-0 / Phase-1 reviews).
> Scope: engineering quality (build, run, reproduce, maintain, lab-doc-vs-reality).
> Date: 2026-05-29
> Verdict: **Pass with conditions** (1 blocker, 2 majors, 4 minors/nits).

## Method

Static audit of `da014be` at HEAD. Read the Phase-2 plan, architect review,
adversarial QA, and paranoid QA documents; then walked every new and
modified file: `docker-compose.yml`, the mock-imds package
(`Dockerfile`, `package.json`, `src/server.ts`, `tsconfig.json`), the
new Prisma migration, schema deltas, all six user-facing KYC handlers,
all five admin-facing KYC handlers, the `lib/kyc-tier.ts` and
`lib/kyc-storage.ts` modules, the new test file, the three new UI
pages, the updated openapi registry imports, gitignore, the lockfile
delta. Cross-referenced every Phase-2 exit criterion against the code,
and threaded each Phase-1 L7 finding pattern (Q-1.1 Suspense, Q-1.4
module-Map, Q-1.6 middleware-stamp asymmetry, Q-1.9 open-redirect-shape)
into a recurrence check. Did not execute the lab; behavior assertions
are derived from the configuration as written. Did not flag any of
V-14, V-27, V-40, V-41 or any of the eight carry-forward Phase-1
vulns (each cross-referenced against `VULNS.md`).

## Findings

### Q-2.1: `/api/v2/me/kyc/doc` UI happy-path returns 404 — user cannot download their own uploaded documents
- **Severity:** major
- **Location:** `apps/web/app/account/kyc/page.tsx:298-303` ↔ `apps/web/app/api/v2/me/kyc/documents/route.ts:47-49,63-65` ↔ `apps/web/app/api/v2/me/kyc/doc/route.ts:26-34`
- **Issue:** Upload writes the file under a randomised stored name (`safeName = \`${id}_${sanitisedOriginal}\``) and persists `filename` (original) and `storedPath` (sanitised) as **different** columns. `GET /api/v2/me/kyc` returns only `filename` in the doc summary (no `storedPath`). The KYC UI's "view" link is built as `/api/v2/me/kyc/doc?file=${encodeURIComponent(d.filename)}` — i.e. it sends the *original* name. The doc-download handler joins that value to `UPLOADS_DIR` and `readFileSync`-es it. The file on disk is named `${id}_${original}`, so the read fails and the handler returns 404. The user can never view their own legitimate uploads in the UI.
- **Why it matters:**
  1. Phase 2 exit criterion #2 ("KYC profile + document upload round-trip works end-to-end via UI") is asserted ✅ by Paranoid QA on the basis that handlers + UI are wired. They are wired — wrongly. A trainee running `docker compose up`, signing up, uploading `passport.pdf`, then clicking "view" gets a 404. That's the demo trainees and instructors actually see on day one.
  2. V-14 (the planted path-traversal on the `?file=` param) still works — it doesn't require a real file to exist; it just needs `readFileSync(join(UPLOADS_DIR, file))` to escape the root. So the vuln is intact. But Phase-2 exit criterion #2 isn't.
  3. The admin-side review page at `/admin/kyc/[userId]` uses a **different**, correct endpoint (`/api/v2/admin/kyc/[userId]/doc/[docId]` resolves via `doc.storedPath`). So the admin happy path works and the user happy path doesn't — exactly the asymmetry Phase-1 Q-1.6 cautioned against repeating, by another shape.
  4. The fix is one of two: (a) change `GET /api/v2/me/kyc` to return `storedPath` in the doc summary and have the UI pass that as `?file=`; (b) reshape the route to `/api/v2/me/kyc/doc/[docId]` (DB lookup, same as admin), and keep the legacy `?file=` parameter alive as a "test affordance" (preserves V-14). Option (b) is cleaner and matches the admin shape.
- **Suggested fix:** Either return `storedPath` from `GET /api/v2/me/kyc` and have the UI use that — keeps V-14 intact, fixes the happy path — or add a parallel `/doc/[docId]` route. Important: if you go with (a), make sure VULNS.md V-14 is unchanged, because the planted endpoint is the `?file=` shape and trainees discover it by inspecting the request — they shouldn't suddenly find that the UI itself doesn't use the vulnerable path.

### Q-2.2: docker-compose subnet `169.254.169.0/24` only has 254 usable addresses for *every* service — capacity & host-collision risk
- **Severity:** major (forward-risk for Phase 3+ services; Mac/Win Docker-Desktop collision risk now)
- **Location:** `docker-compose.yml:160-168` (the entire `networks.bvbe-net.ipam.config` block)
- **Issue:** Phase 2 carved the network's IPAM range from Docker's default (typically a /16 in `172.x.0.0/16`) down to `169.254.169.0/24` so the mock-imds container can be pinned to `169.254.169.254`. The full /24 is now the **only** subnet on `bvbe-net`. All seven services (`nginx`, `web`, `db-migrate`, `worker`, `bitcoin-mock`, `mock-imds`, `db`, `redis` — eight including db-migrate) plus Docker's default gateway must fit in 254 host addresses. Today eight services is fine, but:
  1. **Host collision risk on Mac/Win.** macOS uses `169.254.0.0/16` for IPv4 link-local; Windows uses it for APIPA. Some user routers / VPN clients also live there. Docker Desktop on macOS routes through a VM, so a /24 inside the link-local /16 *usually* works on Mac — but it has been observed to break with corporate VPN clients that black-hole the entire link-local /16, and with Tailscale/ZeroTier/CGNAT setups that grab pieces of it. On Linux the docker bridge owns its address space and the host's link-local interface won't collide (host networking sees `169.254.169.254` arriving on `br-xxxxx`, not on a physical NIC). I cannot rule out a noisy class of "lab won't start on my work laptop" reports — and we won't see them until someone tries.
  2. **Capacity inflexibility.** Phase 3 will add the Bitcoin regtest worker daemon. Phase 4 adds the trading-engine matcher service and the WebSocket server. Phase 8 adds the support-chat LLM proxy. By Phase 8-9 we're at ~12-15 services, each potentially scaling to 2-3 replicas for failover demos (`docker compose up --scale web=2`). 254 addresses is still plenty for that, but the /24 means we *cannot* expand without rewriting the IPAM block — and the Phase-2 staff engineer chose the smallest possible carve.
  3. **Diagnostic friction.** A trainee running `docker network inspect bvbe_bvbe-net` will see every service on a 169.254.* address. That looks identical to the IMDS address pattern. Trainees probing IMDS via the SSRF have to remember that `169.254.169.254` specifically is the IMDS — every other 169.254.* IP is a regular service. This is a low-grade footgun.
- **Why it matters:** A canonical alternative pattern would have been: leave the bridge on its default range (`172.x.x.x`), and pin only the mock-imds container to a docker network *alias* on a second internal network whose subnet is the link-local one. That keeps the link-local exposure to a single container and lets all other services use their default-pool addresses. Two-line YAML change.
- **Suggested fix:** Move to a two-network shape: keep `bvbe-net` on Docker's default subnet (drop the `ipam` block entirely), and add a second network `bvbe-imds-net` with `subnet: 169.254.169.0/24` that only `mock-imds` joins. The mock-imds container takes `ipv4_address: 169.254.169.254` on `bvbe-imds-net`; `web` also joins `bvbe-imds-net` so it can route to that address. Other services stay on the default network. If the two-network shape feels heavy, the minimum viable fix is to *widen the carve to /29 or /28 inside the link-local /16* (e.g., `169.254.169.248/29` — gives the gateway + 6 hosts + IMDS) and put the rest of the services on their own user-defined subnet. Either way, do not put db/redis/web/worker/bitcoin-mock/nginx on link-local addresses; that's not a pattern any real ops team would write.

### Q-2.3: Paranoid QA section 6 claim "uploads are wiped … when the container's writable layer is reset" is wrong — uploads persist on host across `docker compose down -v`
- **Severity:** minor (docs-vs-reality drift; lab-safety relevance: uploaded user data lingers between cohorts)
- **Location:** `docs/phases/phase-2/paranoid-qa.md:64-67`; `docker-compose.yml:36-44` (the `./apps/web:/repo/apps/web` bind mount); `apps/web/lib/kyc-storage.ts:4` (`UPLOADS_DIR = join(process.cwd(), "uploads", "kyc")` which resolves to `/repo/apps/web/uploads/kyc` inside the container = `./apps/web/uploads/kyc` on host); `.gitignore:14-15`
- **Issue:** The Paranoid QA document asserts: *"Uploaded files live under apps/web/uploads/kyc/ in the web container's bind-mounted directory. The container is recreated on docker compose down -v && up; uploads are wiped when the container's writable layer is reset."* That's incorrect. The `web` service mounts `./apps/web:/repo/apps/web` (Phase-0 Q-0.6 fix-up gave us the host bind mount for Fast Refresh). Files the Next.js server writes to `/repo/apps/web/uploads/kyc/` are writes through the bind mount onto the host filesystem at `./apps/web/uploads/kyc/`. `docker compose down -v` removes the **named** volume `bvbe-db`, the anonymous volumes (`node_modules`, `.next`), and the containers — but bind-mounted host directories are owned by the host, not docker. They survive. `scripts/reset-lab.sh` does `down -v && up`; uploads persist across this. The repo's `.gitignore` does correctly hide them from git (`apps/web/uploads/*` except `.gitkeep`), but they remain on the host filesystem until a trainee `rm -rf`s them by hand.
- **Why it matters:**
  1. **Lab-safety drift.** CLAUDE.md § Hard rules says *"`docker-compose down -v` destroys everything."* Phase 2 violates this for the first time. A red-team trainee uploads a polyglot HTML file (V-41) → the file persists on the *instructor's laptop* across lab resets. Next cohort's trainee A signs up, reaches the doc-download endpoint with V-14 traversal, and reads the previous cohort's uploads. Mild data leakage between students.
  2. **Doc gate drift.** Paranoid QA explicitly inspected this and got it wrong. The whole point of Gate 4 is to catch this category. The lapse here is the documented-and-reviewed claim, not the bind-mount itself (the bind-mount was correct from Phase 0).
  3. **`reset-lab.sh` no longer fully resets.** Trainees and instructors run that script trusting the docstring; they need to know it doesn't wipe uploads.
- **Suggested fix:** Pick one:
  1. **Cleanest:** mount `apps/web/uploads` as a named volume (or anonymous volume) instead of letting the parent bind mount own it. Add `- bvbe-uploads:/repo/apps/web/uploads` *after* the `./apps/web:/repo/apps/web` line — the more-specific later mount wins. Declare `bvbe-uploads:` in the `volumes:` block. Uploads are now a real volume; `down -v` wipes them.
  2. Add an explicit `rm -rf ./apps/web/uploads/kyc/* 2>/dev/null` step at the top of `scripts/reset-lab.sh` and document it in CLAUDE.md.
  3. Fix the Paranoid QA doc text to admit the truth: uploads currently persist on the host until manually deleted; this is a known lab-doc deviation. Track as a Phase-3 fix-up.
  Option 1 is the right one — it preserves the CLAUDE.md "down -v destroys everything" invariant. The change is two lines of YAML plus one line in the volumes block.

### Q-2.4: mock-imds runs as root to bind port 80, container has the full pnpm install (tsx + transpile-time deps) and lives forever — slimmer/safer alternatives skipped
- **Severity:** minor (forward-risk + container quality)
- **Location:** `apps/mock-imds/Dockerfile:1,9,13`; `apps/mock-imds/src/server.ts:39`
- **Issue:** Two related observations, neither blocks Phase 2:
  1. **Root for port 80.** `node:22-alpine` runs as root by default. Express binds port 80 via `app.listen(80)` — needs root or `CAP_NET_BIND_SERVICE` on Linux. Docker Desktop on Win/Mac inherits root by default. So port 80 binds. But the container runs as uid 0 forever — and we *don't* need it to. The mock-imds is reachable inside docker by network alias `imds.bvbe.local` and by literal `169.254.169.254`; the trainee SSRF target is the IP literal. Nothing about the planted vuln requires port 80 specifically — `http://169.254.169.254:8080/...` works identically, and the SSRF guard doesn't check port. Running on 8080 would let the container drop to a non-root user and would prevent host-port-mapping accidents in future phases.
  2. **`pnpm install --filter @bvbe/mock-imds...` brings in the full lockfile context.** The `--frozen-lockfile` flag is correct. But `--filter X...` includes X's transitive workspace deps; for `@bvbe/mock-imds` that's just `express`, `tsx`, and `@types/express` — small. Confirmed all three are in the lockfile (`pnpm-lock.yaml` has the `apps/mock-imds:` importer block with the same versions as the bitcoin-mock service from Phase 0). The build should succeed. Two caveats: (a) the Dockerfile copies the **entire** monorepo `package.json` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` before COPYing only `apps/mock-imds/`; if the root `package.json` changes (very Phase-3+ likely), the mock-imds image cache invalidates on every commit. (b) `tsx` is in *dependencies*, not *devDependencies*. That's defensible (the container runs `pnpm tsx`), but it's a small smell — the production-ish way would be a `build` step that emits `dist/server.js` and a `start` that runs `node dist/server.js`. The package.json *has* the `build` and `start` scripts but the Dockerfile uses `tsx` to run TS at runtime instead of building. Phase 2 is dev-only so this is fine; flagging for forward.
- **Why it matters:** Phase 9 (per architect's "polish" notes) will be the phase where the lab tightens its self-image. mock-imds is the canonical example of "this container should be tiny and minimal" since its single job is to play AWS IMDS. Lowering port 80 to 8080 *and* dropping to a non-root user *and* moving to `node dist/server.js` is three lines of Dockerfile changes that pay off as the lab grows.
- **Suggested fix:** Defer cleanup to Phase-3 fix-up. Document in `apps/mock-imds/README.md` (if it ever ships) that the service runs as root only to bind port 80, and that a `PORT=8080` env var works around it. Or just leave it — it's a teaching-grade container.

### Q-2.5: `mimeForFilename` has no tests; the upload-handler's mime-fallback path is the V-41 vuln site and is uncovered
- **Severity:** minor (test-coverage gap on logic the architect explicitly chose not to test)
- **Location:** `apps/web/lib/kyc-storage.ts:21-24`; `apps/web/lib/kyc-tier.test.ts` (the only Phase-2 test file)
- **Issue:** Architect condition 6 says *"no test for requireTier"* — correct, testing it would pin the V-27 vuln behavior. But `mimeForFilename` is a *different* function on the same module. Its happy-path behavior (`.pdf` → `application/pdf`, `.png` → `image/png`, unknown → `application/octet-stream`) is *not* a vuln; it's straight string-map logic. The vuln (V-41) is that the **upload handler** falls back to this function when client sends `application/octet-stream`. That's a handler-level concern, not a `mimeForFilename` concern. Testing `mimeForFilename` directly — including the `text/html`/`.html` mapping — is fine and doesn't pin the vuln.
  Also untested:
  - `getGlobalStore` helper from the Phase-1 fix-up (no test was added when it was extracted; if the implementation changes in a Phase-N fix-up, the TOTP-ticket store + any Phase-2+ consumers regress silently).
  - The `kyc-storage.ts` `ensureUploadsDir` (one-line `mkdirSync(..., {recursive: true})` — low risk, but the line is the difference between "first upload succeeds" and "first upload 500s on a fresh container").
- **Why it matters:**
  1. Phase 2 added 3 tests. Total is 13. The trend is slow growth; that's fine if every test is load-bearing, but the architect's "no test for requireTier" was a specific call about the vuln, not a license to skip testing the rest of the module.
  2. `getGlobalStore` is now the established pattern for all ephemeral cross-request state. Phase 3+ will pile on (deposit confirmations, withdrawal rate-limit windows, address-derivation cache). A regression on the helper would cascade across phases. One ~5-line test would catch it.
  3. None of this blocks Phase 3; it's housekeeping.
- **Suggested fix:** Add `apps/web/lib/kyc-storage.test.ts` with ~4 tests covering `mimeForFilename` happy paths (`.pdf`, `.png`, `.jpg`/`.jpeg`, unknown ext → octet-stream). Add `apps/web/lib/global-store.test.ts` with 2 tests: (a) same key returns same instance across calls, (b) different keys return different instances. Total +6 tests, total now 19. None of these pin a planted-vuln behavior.

### Q-2.6: KYC document download `Content-Disposition` filename interpolation reflects user-controlled query string verbatim
- **Severity:** nit
- **Location:** `apps/web/app/api/v2/me/kyc/doc/route.ts:42`
- **Issue:** Header is built as `\`inline; filename="${file}"\`` where `file` comes straight from `searchParams.get("file")`. Modern Node's `Response` constructor sanitises header values (CR/LF rejected), so classical header-splitting is closed. But the value can still contain unescaped quotes (`"`) and backslashes that confuse some downstream parsers, and contains the path-traversal string in the V-14 exploit case — meaning the response to V-14 echoes `inline; filename="../../../etc/hostname"` back. That's not a defect (it's evidence in the PoC) but it's a "tell" for trainees inspecting the response that the server isn't normalizing the input — which is the V-14 surface and is intended. Keep this as-is; flagging for forward.
- **Why it matters:** Zero impact. Filed as a nit because Phase 9's "polish" pass might want to swap to `\`inline; filename="${path.basename(file)}"\`` — which *still* leaks V-14 because the `readFileSync` happens *before* the header is built and the traversal already succeeded. Don't "polish" this without thinking about V-14.
- **Suggested fix:** None for Phase 2. Note in `VULNS.md` V-14 that the response surfaces the traversal string in `Content-Disposition` as part of the planted shape; that prevents a future maintainer from "fixing" the disposition header thinking it's a separate concern.

### Q-2.7: KycProfile fields are nullable in the schema and the migration but `submit` validates only three of them — incomplete-but-submittable shape is reachable
- **Severity:** nit
- **Location:** `packages/db/prisma/schema.prisma:66-86` (all profile fields nullable except `status`, `createdAt`, `updatedAt`, `userId`); `apps/web/app/api/v2/me/kyc/submit/route.ts:27-29` (validates only `legalName`, `dateOfBirth`, `country`)
- **Issue:** `kyc_profiles` columns `addressLine`, `city`, `postalCode` are NULL-able in the migration AND not required to submit. So a profile with `{legalName: "X", dateOfBirth: "2000-01-01", country: "US"}` + one document passes submit. The profile UI (`/account/kyc`) marks all six fields `required` on the form so a normal user fills all of them, but a direct API call to `PUT /api/v2/me/kyc/profile` requires all six (the zod schema is strict) — so the only way to land in DB with three populated and three NULL is to call `PUT /profile` with all six fields, then directly write SQL. Not really reachable via the UI or the API. But the **submit-time** check should match the **profile zod** so that future maintainers can't accidentally drop a field from the profile schema and have submit silently accept incomplete data.
- **Why it matters:** Tiny defense-in-depth gap. The UI form already enforces this; the API zod schema already enforces this; the submit handler is the third wall and it's leaky. Phase 3 will add new profile fields (probably; deposit confirmation needs no profile changes — but Phase 4 trading-tier limits might). Setting the pattern now matters more than the bug itself.
- **Suggested fix:** Either make the columns NOT NULL in the schema (and add the constraint in a follow-up migration) — but that breaks the `findUnique` happy path on partial saves. Better: tighten `submit/route.ts` to check all six fields, and keep the columns nullable to allow draft saves. One-line zod-style refactor.

## Things that pass cleanly

- **No Phase-1 pattern recurrence.** Searched `apps/web/` for `useSearchParams` and `new Map(` — `useSearchParams` appears only in `login-form.tsx` and `reset-form.tsx` (the Phase-1-fixed surfaces, both already in Suspense wrappers), and the only `new Map()` in the codebase is in `openapi-registry.test.ts` (intentionally seeding the test). No new module-scoped Maps in Phase 2. `getGlobalStore` was not needed in Phase 2 (KYC has no in-memory cross-request state) but the pattern stayed available for Phase 3.
- **Middleware contract is honored.** The Phase-1 fix-up's deliberate split (`/api/v2/admin/*` trusts middleware-stamped headers; `/api/v2/me/*` re-verifies via `userFromAuthorization`) is faithfully applied in every Phase-2 handler: admin handlers (`queue`, `[userId]`, `approve`, `reject`, `doc/[docId]`) read `req.headers.get("x-bvbe-user-id")`; user handlers (`route`, `profile`, `documents`, `import-url`, `doc`, `submit`) call `userFromAuthorization`. No drift.
- **Prisma migration is internally consistent.** Three enum types created, two tables created with proper PK/FK/index/unique constraints, FK targets `users(id)` with `ON DELETE CASCADE` which matches the schema's `onDelete: Cascade`. The schema's `@default(cuid())` on `id` fields correctly produces a SQL DDL with no default (cuid is generated at app level). Migration applies cleanly after Phase-0 + Phase-1 migrations.
- **OpenAPI registry growth.** Six new v2 imports added to `app/api/openapi.json/route.ts` in alphabetical order under the auth/me sections. The registry is still globalThis-anchored (`openapi-registry.ts:23-29` unchanged from Phase-1 fix-up). Side-effect imports load on first request; the `globalThis` Map handles segment-bundle duplication. No regression.
- **V-27 is correctly latent.** `requireTier(claims, 1)` in `import-url/route.ts:59` uses two numeric operands — `claims.kycTier` is typed as `KycTier = 0|1|2|3` from `@bvbe/shared`, and `1` is a number literal. The lex-compare bug doesn't fire (`1 < 1 === false`); the architect's "bug exists, runtime payoff waits for Phase 4 string tiers" is honored exactly.
- **V-14 architecture is intact.** The `?file=` query path takes user input, joins to `UPLOADS_DIR`, and `readFileSync` — exactly the planted shape. The admin doc-fetch path (which is V-41's other half) correctly uses `doc.storedPath` from the DB, so admin can serve real files. The two endpoints' divergence is intentional (and explains Q-2.1's happy-path break).
- **V-40 SSRF guard is the planted shape.** Three literal-string checks (`localhost`, `127.0.0.1`, `::1`), no DNS resolution, no IP-form normalization, `redirect: "follow"`. The mock-imds is reachable via the IP literal and the alias `imds.bvbe.local`. The handler correctly gates on `requireTier(claims, 1)` per architect condition 4 (the bug ships but doesn't fire on tier-1 numeric).
- **V-41 surface is the planted shape.** Upload sets mime from filename extension when client sends `application/octet-stream`. Admin doc-fetch emits `Content-Type: ${doc.mimeType}` verbatim. The admin review page builds a Blob URL with the stored mime → same-origin iframe → script executes in the admin's origin.
- **Mock-imds container is correctly scoped.** No `ports:` mapping → no host exposure. Network alias `imds.bvbe.local` + `ipv4_address: 169.254.169.254`. The synthetic credentials are AWS's own documentation placeholder values (recognisable as fake by anyone who's read AWS docs).
- **Lockfile delta is clean.** mock-imds workspace appears in `pnpm-lock.yaml` `importers:` block; transitive express + tsx + @types/express versions match the pre-existing bitcoin-mock service (no duplicate version churn). `pnpm install --filter @bvbe/mock-imds... --frozen-lockfile` will succeed.
- **`/admin/*` pages render client-side only.** No SSR/RSC paths trying to do server-side fetches with the user's token. Auth gating happens via API redirect-to-`/login` on 401/403 — same pattern as Phase 1 account pages.
- **VULNS.md ledger matches Adversarial QA 1:1.** V-14, V-27, V-40, V-41 are documented with location, root cause, exploit path, and chain membership. The chain status block at the end reflects the current state correctly (CHAIN B has V-35 + V-41; CHAIN D has V-40).
- **`requireTier` accepts the `UserClaims` shape** (`{kycTier: KycTier}`), not just the Prisma `User` shape — so callers can pass JWT claims directly, which is what `import-url/route.ts` does. The architect-mandated "Phase 4+ ready" reachability holds.
- **No `useSearchParams`-without-Suspense regressions** in any of the four new client pages (`/account/kyc`, `/admin`, `/admin/kyc`, `/admin/kyc/[userId]`). They use `useParams` (different hook, no Suspense requirement) or no router-state hooks at all. Q-1.1 did not recur.
- **The `surfaces to leave clean` grep would still return zero hits** (verified by reading the diff — no new `lodash`, no `child_process`, no `eval`, no `$queryRawUnsafe`, no `proxy_cache_`, no `/api/v1/internal/*`, no WebSocket).
- **The "no security fixes" rule helped.** The Phase-1 second addendum (revert security-flavored fix-up items) clearly conditioned the Phase-2 author. Phase 2's adversarial-qa.md acknowledges unintended-probe items like "URL-import follows infinite redirects" with the disposition `Acknowledged — realistic for V-40's purpose` rather than fixing them. That's the policy working correctly. The Phase-2 staff engineer didn't accidentally close any planted-vuln-adjacent surfaces.

## Verdict

**Pass with conditions.** No blockers. One major (Q-2.1 — user happy-path 404 on doc download) breaks Phase-2 exit criterion #2 in the lab as currently deployed, but the fix is mechanical (return `storedPath` from the listing endpoint or add a `/doc/[docId]` route). One major (Q-2.2 — `/24` carve from link-local for the entire docker network) is a defensible Phase-2 shortcut but should be revisited before Phase 3 stacks more services on top. The minor finding Q-2.3 (Paranoid QA doc says uploads are wiped on `down -v` — they aren't, because of the bind mount) is the only finding that touches lab-safety doctrine; it's a doc-drift issue and the right fix is to add a named volume for uploads so the doc's claim becomes true.

The Phase-1 patterns I was specifically asked to check for **did not recur**: no module-scoped Maps without `globalThis` anchoring, no `useSearchParams` without Suspense, no middleware-stamp contract drift (admin trusts stamps, /me re-verifies — uniform across all 11 Phase-2 handlers). The Phase-1 fix-up's `getGlobalStore` helper was available but not needed — Phase 2's state is all DB-backed, no in-memory caches. That's the right outcome.

Improvement over Phase 0/1: this is the first phase where I'm not opening with a blocker. The Phase-1 fix-up's three blockers (Suspense, seed template, V-9 reachability) created a pattern of "the staff engineer ships and the L7 catches build/run defects." Phase 2's staff engineer caught those classes themselves before shipping — `pnpm --filter @bvbe/web build` is in Paranoid QA's re-verification list, the seed wasn't touched, and the V-9 env-wiring isn't relevant here. The codified "DO NOT FIX SECURITY ISSUES" rule (commit `306cad6`) clearly bit: the Phase-2 adversarial-qa.md is more relaxed about unintended-probes than Phase-1's was, with explicit "Acknowledged — intentional surface" dispositions rather than reflexive hardening. The Phase-1 second addendum's revert-pattern carried over correctly.

Recommended sequence for the Phase-2 fix-up: Q-2.1 (storedPath in the listing endpoint, ~15 min) → Q-2.3 (named volume for uploads + Paranoid QA doc fix, ~5 min) → Q-2.5 (add 6 housekeeping tests, ~20 min) → Q-2.7 (tighten submit-route validation to all six profile fields, ~5 min). Defer Q-2.2 (docker subnet rework) and Q-2.4 (mock-imds slim-down) to a Phase-3 design conversation — Phase 3 adds the bitcoind regtest worker and is the right moment to revisit the network shape. Q-2.6 stays as a documentation note in VULNS.md V-14, not a fix.

Phase 2 is solid; the forward risk to Phase 3 is small. Mock IMDS landing is the right wedge for CHAIN D; the SSRF guard's shape is realistic; V-41's polyglot chain is teaching-grade quality. After the Q-2.1 fix the trainee can actually walk the lab. Ship it.

— L7 QA Engineer

---

## Addendum — Build-author response (2026-05-29)

All five recommended fixes applied. `pnpm test`, `tsc --noEmit`, and
`next build` all pass; the four planted vulns still fire in the
PoC scratch. No security-flavored remediation was applied — the
"DO NOT FIX SECURITY ISSUES" rule held during this fix-up too.

### Majors — both FIXED

- **Q-2.1 (happy-path download):** Added `storedPath` to the
  `select` clause in `GET /api/v2/me/kyc` and updated the
  `/account/kyc` UI to pass `storedPath` (not `filename`) into the
  `?file=` query. V-14 endpoint shape unchanged — trainees still
  discover the path-traversal by inspecting the request. The
  legitimate happy path now actually serves the file.
- **Q-2.2 (network split):** Reshaped docker-compose into two
  networks: `bvbe-net` on Docker's default IPAM (all services), and
  `bvbe-imds-net` on `169.254.169.0/24` (only `mock-imds` and `web`).
  `mock-imds` pins to `169.254.169.254` on the IMDS net; everything
  else uses normal private addresses on `bvbe-net`. Removes the
  link-local exposure for nginx/db/redis/worker/bitcoin-mock.

### Consequential minors — both FIXED

- **Q-2.3 (uploads named volume):** Added `bvbe-uploads` named
  volume mounted at `/repo/apps/web/uploads` *after* the apps/web
  bind mount. More-specific mount wins; uploads now live in
  docker's volume layer, not on the host bind path. `down -v` wipes
  them — CLAUDE.md "destroys everything" hard rule restored.
  Paranoid QA section 6 text updated to match the corrected design
  (with a note pointing to this Q-2.3 fix-up).
- **Q-2.7 (submit-route validation):** Tightened the
  `submit/route.ts` check to require all six profile fields
  (legalName, dateOfBirth, country, addressLine, city, postalCode).
  Now matches the profile zod schema and the UI form `required`
  attributes — third wall of defense is no longer leaky.

### Minor — Q-2.5 housekeeping done

- Added `apps/web/lib/kyc-storage.test.ts` (+4 tests):
  `mimeForFilename` happy paths for pdf, png, jpg/jpeg, case
  insensitivity, unknown extension.
- Added `apps/web/lib/global-store.test.ts` (+2 tests): same-key
  returns same instance, different keys return distinct instances.
- Test count: 13 → 19 (5 files → 7 files). None pin a planted-vuln
  behavior.

### Nit — Q-2.6 documented, not fixed

- Added an "Implementation note (Phase-2 fix-up Q-2.6)" block to
  V-14 in VULNS.md warning future maintainers not to "polish" the
  `Content-Disposition` header — the read happens before the header
  is built, so a `path.basename` polish would only hide evidence
  rather than stop the traversal.

### Deferred

- **Q-2.4 (mock-imds container slim-down):** Deferred to Phase 9
  polish per L7's recommendation. Port-80 + root-user behavior is
  acceptable for a teaching-grade lab service.

### Re-verification (executed)

- `pnpm test` → **19/19 pass** (7 files; was 13/13 in 5 files)
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → succeeded
  end-to-end; UI routes prerender; API routes registered
- `pnpm tsx docs/phases/phase-2/poc-scratch.mjs` → V-14, V-27,
  V-40, V-41 all still fire (planted-vuln behavior survived)

### No security hardening applied

The fix-up did not touch any of the V-NNN-tracked surfaces:
`requireTier` still uses the lexicographic compare, the SSRF guard
still checks only literal localhost strings, the polyglot
mime-by-extension is unchanged, the path-traversal `?file=`
endpoint is unchanged, the admin handlers still trust the
middleware-stamped `x-bvbe-user-id` header. Verified by re-running
`poc-scratch.mjs`. The Phase-1 second-addendum audit pattern held.

Phase 2 is ready for Phase 3. Forward note for the Phase-3
architect: the bitcoin-mock service from Phase 0 will finally get
real regtest semantics for deposits — confirm the RPC contract in
`@bvbe/bitcoin-rpc-types` is tight before staff eng starts. The
`apps/web/uploads/` named-volume pattern is now the canonical place
for any Phase-N user-uploaded blob (if a later phase ever ships
S3-mock-as-uploads, swap there).

— build-author
