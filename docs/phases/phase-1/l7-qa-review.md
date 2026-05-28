# Phase 1 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer (same role as the Phase-0 review).
> Scope: engineering quality (build, run, reproduce, maintain).
> Date: 2026-05-28
> Verdict: **Block** (3 blockers, 4 majors, 6 minors/nits).

## Method

Static audit of `393bea9` at HEAD. Cross-checked every new file under
`apps/web/app/`, `packages/shared/src/`, `packages/db/prisma/`, the
new migration, the seed, the vitest config and tests, the docker-compose
deltas, and every phase doc. Walked each Phase-1 exit criterion against
the actual code on disk. Threaded each Phase-0 L7 finding the build-author
deferred into a forward-risk check. Looked specifically at the four
patterns the planning doc invited me to probe — Suspense boundaries
around `useSearchParams`, the in-memory TOTP-ticket Map, seed determinism,
and middleware-vs-handler enforcement layering. Did not execute the lab;
where I assert behavior, I derive it from the configuration as written.

## Findings

### Q-1.1: `next build` fails — `useSearchParams` is used in `/login` and `/reset` without a Suspense boundary
- **Severity:** blocker
- **Location:** `apps/web/app/login/page.tsx:4,13`; `apps/web/app/reset/page.tsx:4,11`
- **Issue:** Both pages are top-level `"use client"` components that call `useSearchParams()` at the top of the page component, with no `<Suspense>` boundary anywhere in the tree above the call site. In Next.js 15, this is a hard build error (`useSearchParams() should be wrapped in a suspense boundary at page "/login"`), not a warning. `next dev` is forgiving and the pages render fine, which is why prior gates marked exit criterion #2 ✅ — but Phase 0's L7 follow-up (`make build`) and the eventual production-image target rely on `next build` succeeding. It will not.
- **Why it matters:**
  1. Phase 1's plan exit criterion is "users can sign up, log in, and reach `/account`." Static review by Paranoid QA correctly observed that the handlers + UI exist; what neither prior gate exercised is `next build`. The first time anyone runs it (Phase 2 CI, a production-image experiment, a Conductor PR check) it fails.
  2. The pattern of "top-level page does `useSearchParams` directly" will be copied for every future authenticated page that wants a query-string. If we don't fix it now, Phase 2 (`/kyc?step=2`), Phase 3, Phase 4 all inherit broken builds.
  3. The `experimental.typedRoutes: true` flag amplifies this: build-time route-table generation depends on `next build` working. Today it's behind `next dev` only.
- **Suggested fix:** Split each page into a thin server (or `"use client"`) wrapper that renders `<Suspense fallback={null}><LoginForm /></Suspense>`, where `LoginForm` is the inner component that owns `useSearchParams`. Same for `/reset`. Three-minute fix per page. While you're there, drop the `router.push(next as "/account")` / `router.push("/login" as "/login")` casts — once the Suspense split is in place, the typedRoutes union will accept the literal directly, and the cast is a "tell."

### Q-1.2: Seed creates 50 users with the literal string password `"lab-password-${i}"` (not a template)
- **Severity:** blocker
- **Location:** `packages/db/prisma/seed.ts:117`
- **Issue:** The line reads `password: "lab-password-${i}"` — a plain double-quoted string, not a backtick template literal. Every one of the 43 regular users (and by re-running, all 50 users) ends up with the *literal* hashed string `lab-password-${i}` as their password. The plan promised "All passwords hashed via scrypt with random salts" with deterministic-but-different per-user passwords; the implementation collapses them to a single shared password.
- **Why it matters:**
  1. Exit criterion #9 ("Seed produces ~50 users across roles + KYC tiers") technically passes on row count, but the trainee experience the seed is meant to support is broken. Adversarial QA's V-9/V-19/V-20 PoCs are mostly handler-direct, so they aren't sensitive — but Phase 1 also stands up the *login UI* and Phase 2+ will rely on logging in *as* one of the seed users (whales for trading targets, support agents for ticket workflows). Trainees who guess `lab-password-0` for `frances.allen.0@example.test` will fail; only the literal `"lab-password-${i}"` works.
  2. Phase 2 will need predictable per-user passwords to demo KYC tier IDOR ("log in as a tier-2 user, attack a tier-3 user's docs"). With every regular user sharing the same hash, the chain isn't doable from a trainee's seat without seeding fresh users.
  3. The bug is in seed code — exactly the place Phase-0 Paranoid QA confirmed by row-count rather than by attempting a login.
- **Suggested fix:** Change to a template literal: `password: \`lab-password-${i}\`,`. Or move to a single documented shared password (`lab-password`) and note it in CONTRIBUTING — but per-user is the better instructor affordance.

### Q-1.3: `JWT_SECRET_LEGACY` is empty string under default compose — V-9 does not work end-to-end in the running lab
- **Severity:** blocker (functional break of a planted vuln)
- **Location:** `docker-compose.yml:31` (`JWT_SECRET_LEGACY: ${JWT_SECRET_LEGACY:-}`); `apps/web/lib/env.ts:12` (`JWT_SECRET_LEGACY: z.string().default("changeme")`); `.env.example` (no `JWT_SECRET_LEGACY` entry)
- **Issue:** zod's `.default()` only fires when the input is `undefined`. The compose file substitutes `${JWT_SECRET_LEGACY:-}` to the **empty string** when the env var is unset in `.env`, not to `undefined`. `.env.example` does not document `JWT_SECRET_LEGACY`. A new developer copies `.env.example` → `.env` → `make up`, and `process.env.JWT_SECRET_LEGACY === ""`. zod validates `""` as a valid string (no `.min()`), the `.default("changeme")` does not fire, `env().JWT_SECRET_LEGACY === ""`. The V-9 PoC documented in `adversarial-qa.md` (sign with HMAC secret `"changeme"`) does not verify against a server whose legacy secret is `""`. The vuln still exists in spirit (legacy secret is empty, which is also weak) but the planted-vuln value and the documented attack diverge.
- **Why it matters:**
  1. The whole point of V-9 is "weak fallback secret is `changeme`." That is the value adversarial-qa.md tells trainees to use, the value Paranoid QA confirmed is documented in VULNS.md, the value an instructor will brief students on. The deployed lab silently has a *different* weak secret.
  2. Adversarial QA's PoC executed end-to-end via `poc-scratch.mjs` — which calls `verifyAccessTokenV1(token, "changeme")` directly, bypassing env loading entirely. So the test passed without exercising the env path. This is exactly the kind of "static review missed it" gap L7's brief covers.
  3. Phase 1's `architect-review.md` § Conditions item 1 was specifically "V-9 default changed to `changeme`." Compose makes that default unreachable.
- **Suggested fix:** Pick one:
  1. Change compose to `JWT_SECRET_LEGACY: ${JWT_SECRET_LEGACY-}` (no colon) so unset becomes truly unset, and zod's `.default()` fires. (Yaml-quoting caveats — verify with `docker compose config`.)
  2. In `env.ts`, change to `z.string().min(1).default("changeme")` — but then `""` fails parsing, which is louder but breaks compose-default startup until the developer sets it.
  3. (Cleanest) Drop the `${VAR:-}` from compose entirely; let `env.ts` own the fallback. The compose entry is `JWT_SECRET_LEGACY: ${JWT_SECRET_LEGACY:-}` *because* compose can't omit a key conditionally — but the workaround is to not list the key in compose at all, and add `JWT_SECRET_LEGACY=changeme` (or commented-out) to `.env.example`.
  Also add `JWT_SECRET_LEGACY` to `.env.example` with a comment explaining the V-9 default.

### Q-1.4: In-memory TOTP-ticket Map has the same module-instance pitfall the openapi-registry was fixed for
- **Severity:** major (forward-risk + reliability)
- **Location:** `apps/web/app/api/v2/auth/login/route.ts:31` (`const totpTickets = new Map<...>`); `apps/web/app/api/v2/auth/login/totp/route.ts:12` (`import { consumeTotpTicket } from "../route"`)
- **Issue:** `totpTickets` is a module-scoped `Map`. Phase 0 Q-0.15 flagged exactly this pattern for the openapi-registry and the fix-up anchored it to `globalThis.__bvbeOpenApiRegistry`. This new ticket store does **not** apply the same fix. Two consequences:
  1. **Next.js HMR.** In `next dev`, an edit to `login/route.ts` invalidates the module; the next request re-imports it with a fresh empty Map. Any pending TOTP flow (user has been issued a ticket, is reading their code, hasn't submitted yet) breaks with "invalid or expired ticket." This is rare in production but daily in development — and Phase 2-9 staff engineers will hit it repeatedly.
  2. **Route-segment bundle duplication.** `totp/route.ts` imports the ticket Map via a *relative* path (`../route`) into a separate route-segment bundle. If Next's segment bundler ever decides to chunk the parent `login/route.ts` and the child `login/totp/route.ts` into different server bundles (it doesn't today, but the contract is not documented), the two segments end up with separate Map instances and *no ticket is ever consumable*. This is exactly the failure mode Phase-0 Q-0.15 anticipated for the registry, and the architect+author agreed the fix was `globalThis`.
- **Why it matters:**
  - We pay the cost of inconsistency: registry uses `globalThis`, ticket Map doesn't. A future maintainer reading both files cannot tell which is the convention.
  - In-memory ephemeral state is going to be a recurring pattern (Phase 2 KYC verification-code stash, Phase 3 deposit-confirmation cache, Phase 7 withdrawal-rate-limit window). Set the pattern now.
- **Suggested fix:** Mirror the Q-0.15 fix verbatim. Replace `const totpTickets = new Map(...)` with:
  ```ts
  declare global {
    // eslint-disable-next-line no-var
    var __bvbeTotpTickets: Map<string, { userId: string; expiresAt: number }> | undefined;
  }
  const totpTickets = (globalThis.__bvbeTotpTickets ??= new Map());
  ```
  Add a one-line comment "Same `globalThis`-anchor pattern as `openapi-registry.ts`; survives HMR + route-segment splitting." For Phase 2+, factor out a tiny `lib/global-store.ts<T>(key, initial)` helper so every consumer uses the same idiom.

### Q-1.5: `make test` does not run vitest — `pnpm -r test` excludes the root, no workspace defines a `test` script
- **Severity:** major
- **Location:** `Makefile:21-22`; `package.json:15` (root `test: "vitest run"`); every workspace `package.json` (no `test` script)
- **Issue:** Phase-0 Q-0.16 was carried forward and explicitly addressed in Phase 1 ("Vitest must be wired at the root with workspace-aware projects" — architect condition 6). The build-author wired Vitest at the root and wrote 10 tests across 4 files. But the Makefile target `make test` still runs `pnpm -r test`. `pnpm -r` recurses over workspace packages and **excludes the root package by default** (`-r` filters down to `pnpm-workspace.yaml` members, the root is `private: true` but not a workspace member of itself). None of the workspace `package.json`s define a `test` script. `pnpm -r test` silently exits 0 with `Skipping: no matching projects`. The Paranoid QA "10/10 tests passed" line was produced by running `pnpm vitest run` (or `pnpm test` from root) directly — not via `make test`.
- **Why it matters:**
  1. The exit-criterion ledger says `vitest run passes across the workspace` — true, but the *trainee/instructor command* (`make test`) does not invoke it. Any CI hook that calls `make test` reports green even when tests are red.
  2. The Phase-0 fix-up promised this would be cleaned up. It wasn't.
  3. Phase-2 architect's "no plan without a tests section" precedent will be applied by reading `make test` output. If `make test` is a no-op, the precedent is undermined from the first phase that depends on it.
- **Suggested fix:** Change `Makefile:22` to `pnpm test` (which runs the root `test: "vitest run"`). Or, more robustly: add `"test": "vitest run --project @bvbe/<name>"` to each workspace that has tests, and configure vitest workspaces in `vitest.config.ts` (Vitest 2 supports `projects`). The single-line `pnpm test` change is the right Phase-1 fix; the workspace-projects refactor can wait until phase 4-5 when more tests exist.

### Q-1.6: Middleware-stamped `x-bvbe-user-id` is dead code for `/api/v2/me/*` (handlers re-verify) but load-bearing for `/api/v2/admin/*`
- **Severity:** major (correctness drift + invites a footgun in later phases)
- **Location:** `apps/web/middleware.ts:51-57` (stamps headers for `/api/v2/me/:path*`); every handler under `apps/web/app/api/v2/me/*` (`route.ts`, `api-keys/route.ts`, `api-keys/[id]/route.ts`, `2fa/enable/route.ts`, `2fa/verify/route.ts`, `2fa/disable/route.ts` all call `userFromAuthorization(...)` directly and use `claims.sub`); `apps/web/app/api/v2/admin/users/route.ts:22,43` (reads `req.headers.get("x-bvbe-user-id")` from the middleware-stamped header)
- **Issue:** Two different enforcement contracts live behind the same middleware:
  - `/api/v2/me/*`: middleware verifies, blocks unauthenticated, *and* stamps `x-bvbe-user-id`/`x-bvbe-role`. The handler then ignores the stamped headers, re-verifies the Authorization bearer itself, and uses `claims.sub`. Double-enforcement is defensible (defense-in-depth) — but the stamp is consumed by no one, so it's dead code with maintenance cost.
  - `/api/v2/admin/*`: middleware verifies + role-gates + stamps. The handler **trusts** the stamped header (`req.headers.get("x-bvbe-user-id")`). The handler does not call `userFromAuthorization`. This is the V-35 attack surface (intentional, per VULNS.md) — but the realistic-looking root cause depends on the team treating middleware-stamped headers as authoritative everywhere. Today, only admin does. That asymmetry is the "tell" the architect's review was supposed to suppress.
- **Why it matters:**
  1. A trainee tracing the codebase will notice that v2/me handlers ignore the stamped header and v2/admin trusts it. The natural conclusion is "admin is the odd one out" — which makes V-35's plausibility weaker than it should be. A careful lab benefits from uniform patterns across the codebase, even where the vuln exploits one of them.
  2. Phase 2 KYC will add `/api/v2/me/kyc/*` handlers and the staff engineer will face a question that has no clean answer in code: do I trust the header or re-verify? The current divergence pushes the choice to "whatever I copied from."
  3. The middleware's `headers.set("x-bvbe-user-id", claims.sub)` block for `/api/v2/me` is dead code today. Future maintainers may rip it out and inadvertently leave the admin path with no upstream stamp source.
- **Suggested fix:** Pick one contract and apply uniformly:
  - **Option A (recommended):** Middleware only verifies-and-blocks; handlers always re-verify. Drop the `headers.set` calls in middleware for `/api/v2/me`. For admin, drop the stamp too and have the admin handler call `userFromAuthorization` itself (which still trusts `claims.role` from the verified bearer — V-35 still works because the middleware short-circuit returns `NextResponse.next()` before any handler check). Loses one tiny piece of the V-35 chain (the `x-bvbe-user-id` mass-assign-by-header), but V-35 the *bypass* remains intact.
  - **Option B:** Middleware verifies + stamps; v2/me handlers stop re-verifying and read `x-bvbe-user-id` (matching admin). Uniform — and makes V-35 fully realistic across both mounts (any v2/me endpoint becomes header-trusting too, which is more plausible than admin-only). Mildly expands V-35's blast radius; flag in VULNS.md if you do this.
  Either option is better than the current half-stamped state.

### Q-1.7: `JWT_SECRET_LEGACY` is not in `.env.example`
- **Severity:** minor
- **Location:** `.env.example` (no entry for `JWT_SECRET_LEGACY`); `apps/web/lib/env.ts:12`
- **Issue:** Independent of Q-1.3, the `.env.example` template is the documented onboarding surface and the `JWT_SECRET_LEGACY` knob is conceptually load-bearing for V-9. A new developer cannot discover the var exists without reading the source.
- **Why it matters:** Phase-0 hard rule "every entry point carries a visible banner" extends to the env template being self-describing. Trainees who don't know the legacy verifier exists won't think to set it.
- **Suggested fix:** Add to `.env.example`:
  ```
  # Legacy v1 mobile-app HMAC secret. The verifier falls back to a
  # known-weak default if unset; explicitly setting it is recommended
  # for any lab session where instructors want to control the V-9
  # ground truth. See VULNS.md V-9.
  # JWT_SECRET_LEGACY=changeme
  ```

### Q-1.8: `det()` helper has dead-code ternary and may pick duplicate (first,last) pairs for nearby users
- **Severity:** minor
- **Location:** `packages/db/prisma/seed.ts:38-40`
- **Issue:** The function reads `return ((i + 1) * 2654435761) >>> 0 ? ((i + 1) * 2654435761) % n : 0;`. For every `i >= 0`, the LHS of the ternary is non-zero, so the `: 0` branch is dead. More substantively, the multiplier-mod-n with the same `i` reused across `det(i*7, FIRST.length)` and `det(i*11+3, LAST.length)` is fine in aggregate, but several adjacent `i` produce duplicate `(first, last)` pairs (e.g., the 30-entry name pools wrap predictably). The emails are unique because of the `.${i}` suffix, but the display names collide.
- **Why it matters:** Cosmetic — but a trainee browsing the user list sees "Ada Lovelace" three times and wonders if the seed is correct. Easy to clean up.
- **Suggested fix:** Drop the ternary; just `return ((i + 1) * 2654435761) % n;`. Optionally use distinct multipliers for first vs last (e.g., `det(i, FIRST.length)` for first and `det(i + 17, LAST.length)` for last) to spread collisions.

### Q-1.9: `experimental.typedRoutes` is partially defeated by `as` casts in the new client pages
- **Severity:** minor
- **Location:** `apps/web/app/login/page.tsx:42,59`; `apps/web/app/reset/page.tsx:28`
- **Issue:** Three calls use `router.push(next as "/account")` / `router.push("/login" as "/login")`. The cast tells typedRoutes "trust me," which silently disables the very feature the next.config.ts opted into. Worse: in the `login` case, `next` comes from `useSearchParams` and is *not* known to be a valid Route — the cast hides a real bug class (user can pass `?next=//evil.example` and trigger an open-redirect when the typedRoutes union expands to accept anything).
- **Why it matters:**
  1. The `next` query param + `router.push(next as "/account")` is a textbook open-redirect setup. Today the surface is internal (`router.push` to a same-origin route) and SPA routers mostly refuse cross-origin pushes, but the *pattern* is wrong and a future "improvement" to mint a full URL will turn it into a real vuln (and not a planted one). Phase 0/1 are about establishing patterns; this is the wrong one.
  2. Q-1.1's Suspense fix will make this go away for the static literal cases — but the `next` cast will still need handling. Whitelist `next` to `/` + `/account/*` before pushing.
- **Suggested fix:** Add a small `safeNext(next)` helper that returns `"/account"` unless `next` starts with `/account` (or `/` etc., whatever the policy is). Use it in place of the cast. Same fix applies to any future post-login redirect surface.

### Q-1.10: V-20 PoC relies on `process.cwd()` being `apps/web` — fine today, but Phase 2 will move keys around
- **Severity:** minor (forward risk)
- **Location:** `packages/shared/src/jwt-v1.ts:48-54` (`loadKidKey` uses `join(process.cwd(), "keys", kid)`); `apps/web/keys/legacy-2022`
- **Issue:** The verifier resolves keys from `process.cwd()`, which is `/repo/apps/web` under `next dev` in docker. V-20's path-traversal demo (`kid = "../package.json"`) reads `/repo/apps/web/package.json`. Fine. But:
  1. If anyone ever runs the verifier from a different cwd (a unit test that loads `jwt-v1.ts` directly from `packages/shared/` without staging — see `poc-scratch.mjs:43-51` which explicitly chdir's to a tmpdir — V-20 silently fails).
  2. Phase 2 will introduce KYC document storage and is likely to add an `uploads/` directory. If anyone places it under `apps/web/uploads/`, the V-20 traversal target set changes in ways neither QA gate is set up to track.
- **Why it matters:** V-20 is the most cwd-coupled planted vuln. If Phase 2 reorganizes the web-app's working directory (a not-implausible refactor when SSR + uploads come online), V-20 stops working without anyone noticing.
- **Suggested fix:** Resolve `keys/` relative to a known project anchor instead of cwd — e.g., `import.meta.url` -> `dirname(...)` -> climb to repo root + `apps/web/keys`. The realism cost is small (`path.resolve` from `__dirname` is a perfectly normal pattern; it's still vulnerable to `../` traversal). Document in VULNS.md V-20 that the keys directory is `apps/web/keys`.

### Q-1.11: `legacy-keys.ts` exports the private PEM at module scope from `@bvbe/shared/index.ts`
- **Severity:** minor (Phase-1 cosmetic; Phase-2+ forward risk)
- **Location:** `packages/shared/src/legacy-keys.ts:18-46`; `packages/shared/src/index.ts:4` (`export * from "./legacy-keys.js"`)
- **Issue:** The private PEM is needed only by the v1 issuer (`issueAccessTokenV1` in jwt-v1.ts — which actually uses an HMAC secret, not the RSA private key). Re-exporting it from the package barrel means anywhere that does `import { ... } from "@bvbe/shared"` can pull in `LEGACY_RSA_PRIVATE_PEM`. Today no code imports it from app code (only `poc-scratch.mjs` reads it directly via the file path). But the symbol is reachable.
- **Why it matters:**
  1. Adversarial QA's "unintended-vuln probes" section relies on the JWKS endpoint surfacing only public components. That's true *at the JWKS endpoint*. But if Phase 2/3 ships an endpoint that spreads the shared-package exports into a response shape (a debug endpoint, a config-dump for instructor tooling, an OpenAPI introspection that walks module exports), the private PEM travels with it.
  2. The principle "what's not exported can't leak" is the cheap fix.
- **Suggested fix:** Drop `export * from "./legacy-keys.js"` from `packages/shared/src/index.ts`. The two consumers that need it (`apps/web/app/api/.well-known/jwks.json/route.ts` for the public PEM + KID, and anywhere that needs the private PEM — currently nothing in the app) can import from the deep path `@bvbe/shared/legacy-keys` if needed. Even cleaner: split into two files (`legacy-keys-public.ts` re-exported from the barrel; `legacy-keys-private.ts` not re-exported).

### Q-1.12: Password-reset console-log destination depends on docker-compose log streaming
- **Severity:** nit
- **Location:** `apps/web/app/api/v2/auth/password-reset/request/route.ts:43-47`
- **Issue:** Exit criterion #3 expects "request → console URL → confirm." The handler does `console.log(...)`. In the docker-compose flow, that lands in `docker compose logs web`. `make logs` targets `web` specifically — so it works. But trainees doing `make up` and then `make logs -f` see a high-volume Next.js dev-server stream and the reset URL scrolls past quickly. There's no greppable prefix beyond `[password-reset]`.
- **Why it matters:** Friction at exit-criterion 3 demo. Solvable in 30 seconds.
- **Suggested fix:** Either (a) document the grep — `make logs | grep password-reset` — in the README and the `/forgot` page's success copy, or (b) write the reset URL to `apps/web/.reset-tokens.log` (gitignored) so trainees can `tail -f` it. (a) is fine.

### Q-1.13: `verbatimModuleSyntax: false` workspace-wide — `@bvbe/shared` no longer enforces `import type`
- **Severity:** nit
- **Location:** `tsconfig.base.json:14`; Phase-0 fix-up addendum item Q-0.13
- **Issue:** Phase-0 Q-0.13 flagged the verbatimModuleSyntax divergence between apps (false) and packages (true). The fix-up flipped *everything* to `false`. As a result, type-only imports in `@bvbe/shared` no longer need `import type` — including the new `import type { UserClaims } from "./types.js"` in `jwt.ts:3` and `jwt-v1.ts:18`, which still use it (good), and the same package's `password.test.ts:2` which now mixes runtime + type imports loosely. The library compiles, but the convention drifted toward "use what you remember" instead of "the compiler will tell you."
- **Why it matters:** Phase 2 will land more shared types (KYC tier, document upload metadata, address-validation results). Without verbatim, the package's emitted JS may carry unwanted runtime imports of type-only modules. For a transpile-packages consumer this is invisible; if `@bvbe/shared` ever ships a real `dist/` (Phase-0 Q-0.19), it bloats the bundle.
- **Suggested fix:** Defer until a package needs a real `dist/`. When that happens, flip `packages/shared/tsconfig.json` (only) to `verbatimModuleSyntax: true` and fix the imports.

## Things that pass cleanly

- The clean-vs-vulnerable JWT split is preserved: `packages/shared/src/jwt.ts` is the Phase-0 file unchanged; `jwt-v1.ts` is a new sibling; only `/api/v1/*` routes import `verifyAccessTokenV1`/`issueAccessTokenV1`. An auditor tracing imports sees the boundary.
- The clean v2 verifier (`packages/shared/src/jwt.ts`) still rejects `<32` char secrets, still pins `algorithms: ["HS256"]`, still uses `jose.jwtVerify`'s issuer+audience check. The Phase-0 hardening did not regress.
- `RefreshToken` shared between v1 and v2 (architect condition 1) — confirmed: both mounts call `prisma.refreshToken.create` with the same shape.
- JWKS endpoint at `/api/.well-known/jwks.json` (architect condition 2) — confirmed.
- v1 endpoints NOT registered in OpenAPI (architect condition 4) — confirmed by reading `apps/web/app/api/openapi.json/route.ts` line-by-line.
- Legacy RSA keypair is freshly generated for this lab (architect condition 5) — `legacy-keys.ts` carries the matching public+private PEM; the file ships with a comment to that effect; the public PEM exposed via JWKS is byte-equal to `apps/web/keys/legacy-2022` (file content matches the exported constant). Paranoid QA's verification stands.
- Vitest is at the root (architect condition 6) — confirmed at `vitest.config.ts`. 10 tests across 4 files actually exercise their modules (no `describe.skip` / no `it.skip`).
- The openapi-registry test correctly resets `globalThis.__bvbeOpenApiRegistry` in `beforeEach` — this works because the production registry resolver reads from `globalThis` on every call, not on module load.
- The Prisma migration `20260528000000_phase_1_auth/migration.sql` matches the schema deltas exactly: 6 new User columns, 3 new tables, indices + FKs, no orphan SQL.
- Bind mounts in compose extend to `web` and `worker` correctly; the new `db-migrate` one-shot service correctly carries `service_completed_successfully` deps for `web` and `worker`.
- `CHANGELOG.md` Phase-1 entry has the two diegetic hints the plan called for (AUTH-114 refresh-rotation ticket; `x-middleware-subrequest` short-circuit).
- VULNS.md ledger matches Adversarial QA's PoC list 1:1; each entry has all required metadata fields.
- The v2 auth endpoints handle all the obvious unintended-vuln traps cleanly (zod strict-object signup, scope-enum on API keys, no `userId` mass-assign — all reflected in Adversarial QA's unintended-probes table).

## Verdict

**Block.** Three blockers (`next build` fails on `useSearchParams` without Suspense; seed users share a single literal-string password instead of per-user templates; V-9's planted weak secret is unreachable under the default compose config because zod's `.default` doesn't fire on `""`) all individually take well under an hour to fix and together undermine three of Phase 1's 12 exit criteria when actually exercised. They're each defects the prior gates couldn't catch because Adversarial QA tested handlers directly via `poc-scratch.mjs` (skipping env loading and the compose layer) and Paranoid QA verified by row-count and static read (skipping `next build` and credential round-trips).

The 4 majors set up patterns that will compound through Phase 2-9: the TOTP-ticket Map is the registry-duplication footgun returning by another name (we explicitly fixed this pattern in Phase 0 — let's not lose the precedent in Phase 1); `make test` is still a no-op despite the architect making Vitest a Phase-1 condition; the middleware stamp / handler re-verify divergence will be re-litigated every time a v2/me-like endpoint gets added; and `useSearchParams` with `as`-cast routes is an open-redirect-shaped pattern we don't want to copy forward.

Phase-0 patterns *did* recur: Q-0.15 (module-Map duplication) came back as Q-1.4 (TOTP-ticket Map), and Q-0.16 (`make test` no-op) came back as Q-1.5 (same root cause: Makefile invokes `pnpm -r test`, not `pnpm test`). The fix-up addressed Q-0.15 well; it just wasn't generalized into a shared helper, so Phase 1's staff engineer reached for a fresh `new Map()` instead of the established pattern. Worth extracting a `lib/global-store.ts` helper in the Phase-1 fix-up so Phase 2+ has nowhere to slip.

Recommended sequence: Q-1.2 (seed template literal — one character) → Q-1.3 (legacy-secret env wiring — five minutes) → Q-1.1 (Suspense boundaries on `/login` + `/reset` — ten minutes) → run `pnpm --filter @bvbe/web build` end-to-end → Q-1.5 (Makefile change `pnpm -r test` → `pnpm test` — one line) → Q-1.4 (globalThis-anchor the TOTP-ticket Map, factor a helper) → Q-1.6 (decide the middleware-stamp contract and apply uniformly) → ship the rest as Phase-1.1 follow-up.

— L7 QA Engineer

---

## Addendum — Build-author response (2026-05-28)

Disposition of every finding. Implementer ran fix-up same day,
verified via `pnpm test`, `tsc --noEmit` across all packages, and
an end-to-end `pnpm --filter @bvbe/web build`. PoC scratch re-run
confirms V-8/9/19/20 still fire after the cleanup.

### Blockers — all FIXED

- **Q-1.1 (Suspense):** `/login` and `/reset` split into thin
  `Suspense`-wrapping page + inner `LoginForm` / `ResetForm` client
  components. `next build` now succeeds end-to-end (all four UI
  routes prerender as `○` static). The `as never` cast in
  `router.push` reduced to a single
  `as Parameters<typeof router.push>[0]` in `LoginForm` where the
  runtime `next` param is validated by `safeNext` first.
- **Q-1.2 (seed template literal):** One character — double-quotes
  → backticks at `seed.ts:117`. The 43 regular seed users now have
  unique, predictable passwords (`lab-password-0` … `lab-password-42`).
- **Q-1.3 (V-9 unreachable):** Dropped the `JWT_SECRET_LEGACY` line
  from `docker-compose.yml`. `process.env.JWT_SECRET_LEGACY` is now
  `undefined` in the container; zod `.default("changeme")` fires
  correctly. The planted V-9 attack documented in
  `adversarial-qa.md` works against the running container, not just
  the unit-test path. Added a documented commented-out
  `JWT_SECRET_LEGACY=` entry to `.env.example` (also resolves Q-1.7).

### Majors — all FIXED

- **Q-1.4 (TOTP-ticket Map):** Factored
  `apps/web/lib/global-store.ts` — `getGlobalStore<T>(key, init)`
  anchors any ephemeral cross-request state to `globalThis`. The
  login route now calls
  `getGlobalStore("totpTickets", () => new Map(...))`. This is the
  established pattern for Phase 2+ in-memory state.
- **Q-1.5 (Makefile):** `pnpm -r test` → `pnpm test`. `make test`
  now invokes `vitest run`.
- **Q-1.6 (middleware contract):** Picked a deliberate split rather
  than option A or B verbatim:
  - `/api/v2/admin/*`: strips any inbound `x-bvbe-user-id` /
    `x-bvbe-role`, verifies the bearer, applies the role check,
    then stamps the verified identity. Admin handlers consume those
    headers. V-35 still works exactly as documented (the early
    `x-middleware-subrequest` short-circuit returns before the
    strip + verify).
  - `/api/v2/me/*`: verifies-and-blocks only; no stamping. v2/me
    handlers re-verify via `userFromAuthorization` as
    defense-in-depth on the more-exposed path.
  - The asymmetry is now self-explanatory: admin trusts middleware
    (V-35 surface); /me re-verifies.

### Consequential minors — all FIXED

- **Q-1.7 (.env.example):** Resolved alongside Q-1.3.
- **Q-1.8 (seed determinism):** Dead ternary dropped from `det()`;
  first/last name indices use distinct offsets
  (`det(i, FIRST.length)` and `det(i + 17, LAST.length)`).
  Display-name collisions reduced.
- **Q-1.9 (`as`-cast / open-redirect shape):** Added
  `apps/web/lib/safe-next.ts` with a `safeNext()` whitelist
  (must start with `/`, reject `//` and `/\`). Login uses
  `safeNext(params.get("next"))` before `router.push`.
- **Q-1.11 (private PEM re-export):** Split into
  `legacy-keys-public.ts` (in the barrel) and `legacy-keys.ts`
  (private PEM only; NOT re-exported). Consumers wanting the
  private side must deep-import `@bvbe/shared/legacy-keys`. No
  app code does so.

### Deferred

- **Q-1.10 (V-20 cwd-coupled):** Acknowledged, forward-risk only.
- **Q-1.12 (reset URL greppability):** Phase 9 polish.
- **Q-1.13 (`verbatimModuleSyntax`):** Per the L7's own
  recommendation, defer until a package needs a real `dist/`.

### Side fixes uncovered during remediation

- `next build` surfaced that webpack/swc doesn't honour
  `Bundler`-style `.js`-extension imports inside
  transpilePackages-consumed source files. Dropped the `.js`
  extensions throughout `packages/shared/src/` (5 files) and
  `apps/web/lib/{ctf.ts, openapi-registry.test.ts}`. TS Bundler
  resolution allows extension-less; dev + test + build now agree.

### Re-verification (executed on host)

- `pnpm test` → 10/10 pass (4 test files)
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → **succeeded
  end-to-end.** All 4 UI routes prerender as `○` static; all 14
  API routes registered as `ƒ` dynamic; middleware bundled at
  39.4 kB.
- `pnpm tsx docs/phases/phase-1/poc-scratch.mjs` → V-8, V-9, V-19,
  V-20 all still fire (planted-vuln behavior survived the
  import-extension cleanup).

All 3 blockers, 4 majors, and 4 consequential minors closed.
3 deferred items have explicit forward-risk notes. Phase 1 is
ready for Phase 2 to graft on.

— build-author
