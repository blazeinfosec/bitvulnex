# Phase 0 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer. Scope: engineering quality
> (build, run, reproduce, maintain). Security/safety covered by
> Gates 3 and 4.
> Date: 2026-05-28
> Verdict: **Block** (3 blockers, 7 majors). The scaffolding is well
> conceived and reads cleanly, but several reproducibility and build
> correctness defects mean `make up` will fail or produce a non-functional
> shell on a clean clone today. Fixes are mostly small; none require
> rethinking the architecture.

## Method

Static audit of the repo at HEAD. Read every source file under
`apps/`, `packages/`, `nginx/`, `scripts/`, the three Dockerfiles,
`docker-compose.yml`, `Makefile`, `package.json` (root + 6 workspace
members), `tsconfig.base.json` plus every per-package `tsconfig.json`,
and all phase docs in `docs/phases/phase-0/`. Cross-checked each
exit criterion in the architect-updated plan against the actual files
on disk. Did not run the lab (no Docker invocation available in this
environment); findings are static, but the build-failure findings
below are deterministic from the configuration as written. Where a
finding overlaps with something the prior gates already addressed, I
say so explicitly and do not re-litigate it.

## Findings

### Q-0.1: No `pnpm-lock.yaml` and Dockerfiles disable frozen-lockfile
- **Severity:** blocker
- **Location:** repo root (missing `pnpm-lock.yaml`); `apps/web/Dockerfile:11`, `apps/worker/Dockerfile:10`, `apps/bitcoin-mock/Dockerfile:10` (all pass `--frozen-lockfile=false`)
- **Issue:** There is no committed `pnpm-lock.yaml` at the repo root. All three Dockerfiles compensate with `--frozen-lockfile=false`, meaning every container build will resolve the entire dependency tree fresh from the registry. Two consequences:
  1. **Builds are non-reproducible.** Two developers cloning today vs in three weeks can get materially different transitive trees — including different Prisma engine versions, different React minors, different `swagger-ui-react` patches, different `next` patches.
  2. **CI/sign-off integrity is undermined.** Gate 3 / Gate 4 signed off against a tree that no one else can recreate bit-for-bit.
- **Why it matters:** Phase 0 is the *foundation*. Every later phase that lands a planted vuln will be reasoning about specific versions of dependencies (the V-9 weak-key fallback in Phase 1, Phase 8's lodash.merge prototype pollution, supply-chain surfaces in Phase 9 generally). Without a lockfile, "we shipped vuln X" depends on which day you built. Adversarial QA reports will not be reproducible by an instructor a month later.
- **Suggested fix:** Run `pnpm install` once at the repo root, commit the resulting `pnpm-lock.yaml`, then change all three Dockerfiles to `COPY pnpm-lock.yaml ./` and `pnpm install --filter ... --frozen-lockfile`. Also add `pnpm-lock.yaml` to the list of "things Phase 0 ships" in the plan.

### Q-0.2: Prisma on Alpine — missing `openssl` / `libc6-compat`
- **Severity:** blocker
- **Location:** `apps/web/Dockerfile:1,12`; `packages/db/prisma/schema.prisma:7-9`
- **Issue:** `apps/web/Dockerfile` is `FROM node:22-alpine` and runs `pnpm --filter @bvbe/db exec prisma generate` without first installing `openssl` (and on some hosts `libc6-compat`). Prisma 5.x on `node:22-alpine` is historically a sharp edge: the engine binary it picks (`linux-musl-openssl-3.0.x`) needs the OpenSSL shared library present in the image. `node:22-alpine` does not ship it by default in all variants, and Prisma will emit a warning + sometimes fail outright at `prisma generate` or first runtime query. The `schema.prisma` `generator client` block also does not pin `binaryTargets`, so detection is left implicit.
- **Why it matters:** First-time developer attempts `make up`, the web container build fails at `prisma generate` or the web container starts and crashes at first DB query. Exit criterion #6 ("Prisma migration runs; `admin@bvbe.local` row exists") cannot pass.
- **Suggested fix:** Either switch the base image to `node:22-bookworm-slim` (simpler, slightly larger), or in `apps/web/Dockerfile` add `RUN apk add --no-cache openssl libc6-compat` immediately after `FROM`, and add `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` to the Prisma `generator client` block. Mirror in `apps/worker/Dockerfile` once Phase 1 wires the worker to Prisma (or do it now defensively, since the worker `package.json` already lists `@bvbe/db`).

### Q-0.3: No migration / seed path runs automatically; exit criterion 6 cannot pass via `make up`
- **Severity:** blocker
- **Location:** `docker-compose.yml:18-44` (web service has no entrypoint/command override running migrate); `Makefile:15-16`; `docs/phases/phase-0/plan.md:64-66`
- **Issue:** The plan states explicitly: "Compose entrypoint runs Prisma migrate + seed before the web container serves." None of the three Dockerfiles do this. The web `CMD` is `pnpm next dev -p 3000`. There is no compose-level `command:` override, no init container, no entrypoint script. The only way to land the migration + seed admin row is to invoke `make seed` manually after `make up`, which the README does say in its Quick Start. But that means exit criterion #6 ("Prisma migration runs; `admin@bvbe.local` row exists") is **not** satisfied by `docker-compose up -d` alone — it requires a second human action.
  
  There are no migrations on disk either: `packages/db/prisma/migrations/` does not exist. `make seed` runs `prisma migrate deploy` which is a no-op without a migration directory committed. The first time anyone runs it they will get "no migrations found" or Prisma will fall through to `db push`-like behaviour depending on the exact CLI invocation. Either way the admin row plan-of-record is broken.
- **Why it matters:** Two compounding gaps. (a) The plan promised auto-migrate-and-seed and the implementation does not deliver. (b) Even the manual `make seed` path is broken because no migration baseline exists. Static review by Paranoid QA marked criterion #6 ✅ on "schema + seed present" — but a schema file is not a migration.
- **Suggested fix:**
  1. Generate the initial migration: `pnpm --filter @bvbe/db exec prisma migrate dev --name init` and commit the resulting `packages/db/prisma/migrations/` tree.
  2. Add a compose-level entrypoint to the web service (or a dedicated short-lived `db-migrate` service that web `depends_on` with `condition: service_completed_successfully`) that runs `prisma migrate deploy && tsx prisma/seed.ts` before next dev starts.
  3. Update the plan's exit criterion #6 to reference the auto-path, or update the README to make `make seed` the documented expectation and rewrite criterion #6 to match.

### Q-0.4: `experimental.typedRoutes: true` + `<Link href="/login">` / `/signup` / `/api/health` will fail `next build`
- **Severity:** major (blocker for `pnpm -r build` / `make build`; not a blocker for `next dev`)
- **Location:** `apps/web/next.config.ts:11-13`; `apps/web/components/ui/navbar.tsx:25,28`; `apps/web/app/page.tsx:32` (`/signup`); `apps/web/app/docs/page.tsx:11` indirectly OK; `apps/web/components/ui/footer.tsx:12-13` (relative `<a>` ok)
- **Issue:** With `experimental.typedRoutes: true`, Next.js generates a discriminated `Route` union from the routes that exist on disk and `<Link href>` is typed against that union. Phase 0 has only `/`, `/about/changelog`, `/docs`. The navbar links to `/login` and `/signup` and the landing page CTA links to `/signup`. Under typedRoutes, `<Link href="/login">` is a type error: `Type '"/login"' is not assignable to type 'Route<...>'`. The plan acknowledges these routes "will 404 until Phase 1" but the type system will refuse to compile them.
- **Why it matters:** `next dev` is forgiving and the pages still render (the link will produce a runtime 404, as intended). But `next build` — invoked by `pnpm -r build` and the `make build` target — will fail typecheck. Exit criterion #13 lists `make test`, `make flags`, etc., but `make build` is also reachable from Phase 0. More importantly: Phase 1's CI will inherit this problem the moment someone tries to compile.
- **Suggested fix:** Three options, pick one:
  1. (Preferred) Turn off `experimental.typedRoutes` in Phase 0 and re-enable it in Phase 1 once `/login` and `/signup` exist. Add a forward-looking note to the plan.
  2. Cast: `<Link href={"/login" as Route}>` — but this leaks `Route` typing into Phase 0 components and is exactly the kind of "tell" that makes the lab feel synthetic.
  3. Create placeholder `app/login/page.tsx` and `app/signup/page.tsx` that render a "Coming in Phase 1" stub. Cheap and removes the friction; also makes the navbar links not 404 (better first-time UX during the Phase-0 demo).

### Q-0.5: Missing `.dockerignore`
- **Severity:** major
- **Location:** repo root
- **Issue:** No `.dockerignore`. Every Dockerfile uses `COPY packages ./packages` and `COPY apps/<name> ./apps/<name>`. Without a `.dockerignore`, `node_modules`, `.next`, `dist`, `.git`, `docs/`, and the `.env` file (if a developer has copied one) will be sent to the daemon as part of the build context. Concretely:
  - Build context size grows from KB to MB to GB once a developer has `pnpm install`-ed once locally, because each Dockerfile's `COPY packages` will include every package's local `node_modules`.
  - A local `.env` file (developer's own secrets) ends up in the build context and *could* be COPY'd into the image if someone later adds a broader COPY.
  - Builds are much slower and bust the Docker layer cache on irrelevant changes (a doc edit invalidates the COPY layer).
- **Why it matters:** This is a daily-papercut quality issue for everyone who clones the repo. The hard rule "No real secrets" includes "don't accidentally ingest a developer's local `.env`."
- **Suggested fix:** Add a `.dockerignore` at the repo root with at least `node_modules`, `**/node_modules`, `.next`, `**/.next`, `dist`, `**/dist`, `.git`, `.env`, `.env.*`, `coverage`, `*.log`. Mirror per-app `.dockerignore` only if needed.

### Q-0.6: No bind mounts in `docker-compose.yml` despite "Bind-mounted in dev" in the plan
- **Severity:** major (DX) — Plan ↔ implementation drift
- **Location:** `docker-compose.yml:18-44`; `docs/phases/phase-0/plan.md:53-62` table says web is "Bind-mounted in dev"
- **Issue:** The web container runs `next dev` (so Fast Refresh is expected), but `docker-compose.yml` declares no `volumes:` mapping `./apps/web` or `./packages` into the container. Any source-code edit on the host requires `docker compose build web && docker compose up -d web` — a 30-60 second cycle — instead of an HMR reload. The worker and bitcoin-mock have the same issue: `tsx watch` is in `dev` scripts in their `package.json`, but Compose runs the non-watch `CMD` (`pnpm tsx src/server.ts` / `src/index.ts`), so they don't even rebuild on change.
- **Why it matters:** Phase 0 is supposedly the *foundation* every later phase grafts onto. Every staff engineer in Phases 1-9 will be making code changes inside the web container loop. Without bind mounts + watch mode, each edit costs ~minute. That's hundreds of minutes of lost dev time across the project. The plan was correct that this should be bind-mounted; the implementation just didn't carry it through.
- **Suggested fix:** Add to the web service in `docker-compose.yml`:
  ```yaml
  volumes:
    - ./apps/web:/repo/apps/web
    - ./packages:/repo/packages
    - ./CHANGELOG.md:/repo/CHANGELOG.md:ro
    - /repo/apps/web/node_modules
    - /repo/apps/web/.next
  ```
  And mirror for `worker` (point `CMD` at `tsx watch` instead of `tsx` if you want hot reload) and `bitcoin-mock`. Be aware on Windows/WSL2 the anonymous volume idioms for `node_modules` are important to avoid host-OS contention.

### Q-0.7: `swagger-ui-react@5` peer-dep mismatch with `react@19`; `@types/swagger-ui-react@4.x` vs runtime `5.x`
- **Severity:** major
- **Location:** `apps/web/package.json:23,30`
- **Issue:** `swagger-ui-react@^5.17.14`'s package.json declares `peerDependencies: { react: ">=16.8.0 <19" }` (verify against the registry; v5.17 was authored pre-React-19). pnpm will install it but will surface a `WARN unmet peer` and React 19 will sporadically warn about deprecated lifecycle PropTypes and findDOMNode use inside the bundled swagger UI tree. The `@types/swagger-ui-react@^4.18.3` package targets the v4 API; using it against v5 means TS sees a different prop surface than runtime. There is no `@types/swagger-ui-react@5.x` published at the time of writing — DefinitelyTyped is behind on this package.
- **Why it matters:** Today: console noise, possible runtime exceptions during the first `/docs` render in React 19 strict mode (which is `reactStrictMode: true` in `next.config.ts`). Tomorrow: when the Phase 1 architect reviews `apps/web/` and sees mismatched types, the natural "fix it" instinct may pull a different swagger viewer in mid-project. Better to settle the choice now.
- **Suggested fix:** Either (a) pin `swagger-ui-react` to a 5.x version known to render in React 19 (test in Phase 0), and accept the type drift (delete `@types/swagger-ui-react` and declare `declare module "swagger-ui-react"` locally with the one component you actually use); or (b) replace `swagger-ui-react` with a thin server-rendered Swagger / Redoc embed via an `<iframe>` or a script tag — no React-version coupling at all. (b) is the long-term sane choice but (a) is faster.

### Q-0.8: Worker's `tsx` is in `devDependencies`; runtime `CMD` invokes it via `pnpm tsx`
- **Severity:** major
- **Location:** `apps/worker/Dockerfile:13`; `apps/worker/package.json:18-20`; same pattern in `apps/bitcoin-mock/Dockerfile:14`, `apps/bitcoin-mock/package.json:16-18`
- **Issue:** Both Dockerfiles run `pnpm install --filter @bvbe/<name>... --frozen-lockfile=false` without `--prod=false` or `NODE_ENV=development`. pnpm respects `NODE_ENV=production` and skips devDependencies. The web service explicitly sets `NODE_ENV: development` in compose, but `RUN pnpm install` happens during image build — *before* compose env is applied. By default `NODE_ENV` is unset at build time so devDeps are installed. Fine today. The moment anyone copies the Dockerfile and adds `ENV NODE_ENV=production` (which is what they'll do for a "real" build) the devDeps drop and `pnpm tsx ...` fails because `tsx` isn't there.
- **Why it matters:** It's a footgun for any future Phase that introduces a production build target (and the master plan mentions one for canary-runs). Also runtime use of dev-only packages is just a code smell.
- **Suggested fix:** Move `tsx` to `dependencies` in both `apps/worker/package.json` and `apps/bitcoin-mock/package.json`. Long-term: actually run the `build` script in each Dockerfile and `CMD ["node", "dist/server.js"]` so `tsx` is only ever a dev tool.

### Q-0.9: `tsx watch` in `dev` scripts is misleading — there's no `dev`-target compose service
- **Severity:** minor
- **Location:** `apps/worker/package.json:8`, `apps/bitcoin-mock/package.json:8`
- **Issue:** Both apps declare a `"dev": "tsx watch ..."` script that nothing invokes. The root `package.json` has `"dev": "pnpm -r --parallel dev"` which would invoke these, but in the docker-compose flow it's never run. This is a leftover that creates confusion: a new dev reads `pnpm dev` in the root and assumes that's how to run the lab, then is surprised when the running containers don't see their changes.
- **Why it matters:** Onboarding friction; sets up a "two ways to run it" trap for Phase 1+.
- **Suggested fix:** Either wire `pnpm dev` into the documented dev flow (less likely — Docker is the canonical environment per CLAUDE.md), or delete the `dev` scripts from the two app `package.json`s and rely solely on Compose + bind mounts (fixed in Q-0.6).

### Q-0.10: `next/font/google` Inter is loaded at build time; lab claim of "no outbound calls" is overbroad
- **Severity:** minor
- **Location:** `apps/web/app/layout.tsx:3,8`; Paranoid QA report `paranoid-qa.md:54-56` ("loads at build time and self-hosts; no runtime fetch to Google")
- **Issue:** `next/font/google` does make an outbound call to `fonts.googleapis.com` at build time; in `next dev`, that means on first render. Paranoid QA's wording suggests it's a one-time build-host fetch that never recurs — but Phase 0 ships in `next dev` mode, so the fetch happens *inside the lab container* whenever the `app/layout.tsx` module is first compiled. This is benign (it's Google, not a third-party tracker; it's only the font file) but it contradicts the QA's certainty and the hard-rule line "No outbound calls to third parties from the app code path."
- **Why it matters:** If an instructor runs the lab fully air-gapped, the first request to any page will fail (or render without Inter and look bad). Worse: the lab will silently make an external request unless explicitly configured otherwise.
- **Suggested fix:** Either (a) `next/font/local` with a self-hosted Inter `.woff2` in `apps/web/styles/fonts/` and adjust the import; or (b) document the outbound fetch in Paranoid QA's report and note that air-gapped operation requires pre-warming the next.js cache. Option (a) is the right move for a self-contained lab.

### Q-0.11: `tsx` declared in root devDependencies but Makefile invokes `pnpm tsx`
- **Severity:** minor
- **Location:** `Makefile:28`; root `package.json:21`; `scripts/derive-flags.ts`
- **Issue:** `make flags` runs `pnpm tsx scripts/derive-flags.ts`. `tsx` is in root devDependencies — but `pnpm tsx` will resolve to the workspace-root binary only if `pnpm install` has been run at the root. If a developer's first action after `git clone` is `make up` followed by `make flags` (which is plausible — instructor handing flags to grader), `pnpm tsx` is not installed yet because the host machine has no `node_modules`. Compose-built containers have `tsx` inside the image but the host doesn't.
- **Why it matters:** Friction at the demo/sign-off boundary. Easily fixed.
- **Suggested fix:** Either add a `make install` dependency (the Makefile already has an `install` target — make `flags` depend on it), or shell out to `docker compose exec web pnpm tsx scripts/derive-flags.ts` (but then `derive-flags.ts` needs to be in the image too). Simplest: document `make install` as a one-time setup step in the README's Quick Start.

### Q-0.12: `LICENSE` contains only the short header notice, not the full Apache 2.0 text
- **Severity:** minor
- **Location:** `LICENSE` (37 lines total)
- **Issue:** The architect chose Apache 2.0 specifically for the patent grant. The committed LICENSE file contains only the "Licensed under the Apache License, Version 2.0 (the 'License')" header snippet plus the bespoke "Security Education Notice." A real Apache 2.0 license file is ~200 lines: full Terms and Conditions (Definitions, Grant of Copyright License, Grant of Patent License, Redistribution, Submission of Contributions, Trademarks, Disclaimer, Limitation of Liability, Accepting Warranty), plus the "APPENDIX: How to apply." Without the full text, the patent grant the architect cited as the reason for choosing Apache over MIT *legally does not exist*.
- **Why it matters:** This is the one engineering-quality issue with downstream legal teeth. If anyone forks BVBE intending to rely on the Apache patent grant, they don't have one. README.md and `package.json` both advertise "Apache 2.0" — if the file isn't actually Apache 2.0, that's a misrepresentation.
- **Suggested fix:** Replace the body of `LICENSE` with the canonical Apache 2.0 text from <https://www.apache.org/licenses/LICENSE-2.0.txt>. Keep the prepended "SECURITY EDUCATION NOTICE" block at the top — that's fine and consistent with how Apache 2 is normally applied with a project-specific NOTICE.

### Q-0.13: Mixed `verbatimModuleSyntax` across packages will bite Phase 1's JWT split
- **Severity:** minor (Phase-0 cosmetic; Phase-1 forward-risk)
- **Location:** `tsconfig.base.json:14` (`verbatimModuleSyntax: true`); `apps/web/tsconfig.json:7` (false); `apps/bitcoin-mock/tsconfig.json:7` (false); `apps/worker/tsconfig.json:7` (false); `packages/shared/tsconfig.json` (inherits true); `packages/db/tsconfig.json` (inherits true)
- **Issue:** `verbatimModuleSyntax` is `true` in the base config but overridden to `false` in all three apps. The shared / db / bitcoin-rpc-types packages inherit `true`. The architect's Issue 3 note says Phase 1 will land `packages/shared/jwt-v1.ts` alongside `packages/shared/jwt.ts`. `jwt-v1.ts` will be imported by an `/api/v1/*` route from `apps/web`. Today, `apps/web/lib/ctf.ts:2` already does `import { env } from "./env.js"` — `verbatimModuleSyntax: false` lets that slide. But `packages/shared/src/jwt.ts` uses `import { ... type JWTPayload }` (line 1) and `import type { UserClaims } from "./types.js"` (line 2) — the package needs verbatim to be `true` for the type-only imports to be required.
- **Why it matters:** When Phase 1 lands `jwt-v1.ts`, anyone who writes `import { issueAccessTokenV1 } from "@bvbe/shared/jwt-v1"` from `apps/web` will get inconsistent type-stripping behaviour. The lab's whole "find the vulnerability by tracing imports" premise relies on import semantics being uniform across the boundary. Diverging `verbatimModuleSyntax` is the kind of cross-package booby trap that becomes a real bug when type-only imports from `@bvbe/shared` start being mistaken for runtime imports by one consumer and not another.
- **Suggested fix:** Pick one. Either flip the base to `verbatimModuleSyntax: false` and let `tsc` decide (simplest), or keep base `true` and remove the per-app overrides — then fix the ~3 existing imports that violate it. Recommend the latter: it forces the lab to use `import type` consistently, which makes the Phase-1 `jwt-v1.ts` split land cleanly.

### Q-0.14: Worker container does not run `prisma generate` despite depending on `@bvbe/db`
- **Severity:** minor (forward risk)
- **Location:** `apps/worker/Dockerfile`; `apps/worker/package.json:13`
- **Issue:** Worker `package.json` lists `@bvbe/db` as a dependency (which itself imports `@prisma/client`). The worker Dockerfile never runs `prisma generate`. Today the worker source (`apps/worker/src/index.ts`) only imports `ioredis`, so the missing client is invisible. The moment Phase 7 wires the worker to the withdrawal queue and the worker imports `prisma` from `@bvbe/db`, it will fail at first import with the famous `@prisma/client did not initialize yet`.
- **Why it matters:** Forward risk. Easy to fix now; harder to find later.
- **Suggested fix:** Add `RUN pnpm --filter @bvbe/db exec prisma generate` to `apps/worker/Dockerfile` (after `pnpm install`). Same for `apps/bitcoin-mock/Dockerfile` if/when it gains a `@bvbe/db` dep.

### Q-0.15: `apps/web/lib/openapi-registry.ts` module-level Map will be duplicated across Next.js route segments
- **Severity:** minor (latent; may bite Phase 1+)
- **Location:** `apps/web/lib/openapi-registry.ts:17`; `apps/web/app/api/openapi.json/route.ts:8`
- **Issue:** The registry stores `EndpointSpec` entries in a module-scoped `Map`. In Next.js 15 App Router with Turbopack / Webpack module graphs, route segments are compiled into independent server bundles. Each route handler module *may* end up with its own copy of `openapi-registry.ts` (and therefore its own empty Map) unless they share a single import graph. The current code happens to work because `app/api/openapi.json/route.ts` explicitly does `import "@/app/api/health/route"` — pulling the health route's `registerEndpoint` side-effect into the same module as the doc builder. That works for one endpoint. When Phase 1+ adds 5, 10, 20 endpoints, every new endpoint must remember to be imported from `openapi.json/route.ts`. Miss one and it silently disappears from the public doc — which is *exactly* the planted-vuln pattern the architect wants ("intentionally incomplete docs"), but you lose the ability to tell intent ("we forgot") from intent ("we wanted it hidden"). Worse: hot-module-reload during `next dev` may give different snapshots of the registry between requests.
- **Why it matters:** The architect explicitly noted that the gap should be *structural* (forgetting to import = doc gap). That's preserved. But module-instance duplication adds *non-structural* gaps that look like the structural ones, so a Phase-3 adversarial-QA finding "this endpoint isn't in the OpenAPI doc!" becomes ambiguous: planted, or just module-graph weirdness?
- **Suggested fix:** Move the registry to `globalThis` so all bundles share it: `const registry: Map<string, EndpointSpec> = (globalThis as any).__bvbeOpenApiRegistry ??= new Map();`. Same pattern Prisma already uses in `packages/db/src/index.ts:3-15`. Add a comment that this is the deliberate Phase-0 scaffolding decision.

### Q-0.16: `make test` is a no-op (no test runner installed anywhere)
- **Severity:** minor
- **Location:** `Makefile:21-22`; `package.json:15`; every workspace `package.json` (no `test` script)
- **Issue:** The Makefile target `make test` runs `pnpm -r test`. None of the 6 workspace `package.json` files define a `test` script. pnpm-r will exit 0 with "No projects matched the filter" — silently passing. Exit criterion #13 in the plan lists `make test` as something that must work. Today it "works" only by doing nothing.
- **Why it matters:** Vertical-slice rule (CLAUDE.md hard rules) says "phases ship vertically — UI + API + DB + tests." Phase 0 ships zero tests. That's tolerable for a scaffolding phase, but the *infrastructure* for tests should exist — otherwise the Phase 1 architect/staff engineer has to bootstrap a test runner before they can write the first test, which makes the temptation to skip tests stronger.
- **Suggested fix:** Pick a runner (Vitest is the obvious choice for a Next.js 15 + TS monorepo), add it to root devDependencies, write one trivial smoke test per workspace (e.g. `packages/shared/src/jwt.test.ts` that round-trips an issue→verify), and wire `vitest run` into each workspace's `test` script. Make `make test` then exit non-zero when a real test fails. Cost: ~15 minutes; benefit: every later phase has a credible test surface from day one.

### Q-0.17: `nginx.conf` server_name + README hosts-file step is a quiet onboarding cliff
- **Severity:** minor
- **Location:** `nginx/nginx.conf:19`; `README.md:36`
- **Issue:** nginx listens on `server_name exchange.local localhost`. README says: "open http://exchange.local/ # add to hosts: 127.0.0.1 exchange.local". The hosts-file step is non-trivial on Windows (the lab was authored on Windows) — it requires admin elevation, edit of `C:\Windows\System32\drivers\etc\hosts`, and the file is sometimes locked by Defender. A new user who follows the Quick Start verbatim and doesn't notice the inline hosts-file comment will hit DNS failure with no actionable error. `localhost` works as a fallback (it's in the `server_name` line), but the README doesn't mention that path.
- **Why it matters:** First impressions matter. Curl works because Host header rewriting; browser navigation to `http://localhost/` does too. The "add to hosts" step is documented but easy to miss.
- **Suggested fix:** Either ship a `scripts/setup-hosts.{ps1,sh}` that adds the entry (with prompts), or change the README to "open http://localhost/" and demote the `exchange.local` step to "optional: for a more realistic-looking URL."

### Q-0.18: Web Dockerfile depends on a tsconfig path it never copies
- **Severity:** nit
- **Location:** `apps/web/Dockerfile:6`
- **Issue:** The Dockerfile copies `tsconfig.base.json` to `/repo/`. That's correct — `apps/web/tsconfig.json` extends `../../tsconfig.base.json`. But it doesn't copy `.editorconfig`, `.nvmrc`, or anything else from the root that downstream tooling might look at. Most likely a non-issue — TS will resolve `extends` from disk and that's the only critical one.
- **Why it matters:** Cosmetic. Just flagging so the next reviewer doesn't have to re-prove it.
- **Suggested fix:** None unless something breaks. Leave as is.

### Q-0.19: `packages/db/package.json` `main` points at `.ts` source
- **Severity:** nit
- **Location:** `packages/db/package.json:5-6`; same pattern in `packages/shared/package.json:6-7` and `packages/bitcoin-rpc-types/package.json:6-7`
- **Issue:** `"main": "./src/index.ts"` and `"types": "./src/index.ts"`. Works because Next.js has `transpilePackages: ["@bvbe/shared", "@bvbe/db", "@bvbe/bitcoin-rpc-types"]` and worker/bitcoin-mock use `tsx`. But: anything that bypasses transpilation (e.g. a node REPL `require('@bvbe/db')` from a script not run via tsx) will fail with `SyntaxError: Cannot use import statement outside a module`.
- **Why it matters:** Forward-risk. Production builds will eventually want compiled `dist/index.js` here.
- **Suggested fix:** Defer. Note in the Phase-1 plan that `packages/*` will need to ship a compiled `dist/` once any consumer wants to use them outside the transpile-packages umbrella.

## Things that pass cleanly

- The 4-gate workflow itself: plan / architect review / adversarial / paranoid are well-structured and the architect's conditions are reflected back into the implementation reasonably faithfully.
- Banner discipline: `DoNotDeployBanner` rendered top+footer in `app/layout.tsx`; root README opens with a blockquote warning; `LICENSE` notice (legal-text gap notwithstanding); `CHANGELOG.md` and `VULNS.md` carry warnings.
- The `JWT_SECRET` / `CTF_SALT` `${VAR:?error}` pattern (post-F-0.2 fix) genuinely does fail fast at compose-up time — verified by reading the compose file.
- Zod schema in `apps/web/lib/env.ts` is strict (`min(32)` for JWT, `min(8)` for salt, `.url()` for URLs) and the cache pattern is sensible.
- The `openapi-registry` pattern itself is sound (modulo Q-0.15 module-graph caveat).
- The bitcoin-mock JSON-RPC server has bounded error handling, no stack-trace leakage, no host port mapping. Trust boundary is real.
- `packages/db/src/index.ts` correctly uses the `globalThis` PrismaClient singleton pattern — won't double-instantiate during `next dev` hot reload.
- `seed.ts` is idempotent (`upsert`), uses `scrypt` with random salt, and the admin email is `@bvbe.local` (RFC 6762 reserved). Clean.
- Compose service dependencies (`depends_on` + healthchecks on `db` and `redis`) are wired correctly.
- Redis is launched with `--save "" --appendonly no` — no persistence, matches "self-contained lab" hard rule.
- `down -v` removes the named `bvbe-db` volume; bitcoin-mock is in-memory only.
- Repo layout matches the CLAUDE.md "target layout" essentially exactly. Naming is consistent across `apps/`/`packages/`. The `@bvbe/*` scope is consistently applied.
- `pnpm-workspace.yaml` and `workspace:*` references resolve syntactically (pending lockfile generation per Q-0.1).
- `.gitignore` covers the right set (`.env`, `.env.local`, `node_modules`, `.next`, `dist`, `.pnpm-store`). Clean.

## Verdict

**Block.** The 3 blockers (no lockfile, Prisma-on-alpine OpenSSL, no auto-migrate path) mean `make up` on a clean clone today will not land exit criterion #6 and may not land any of the criteria reliably. They are all individually small fixes — together maybe one to two hours of work to remediate — but they're load-bearing for everything downstream. Phase 0 is meant to be the foundation Phase 1+ grafts onto; shipping it with non-reproducible builds and a broken first-time-developer path means every subsequent gate inherits the debt.

The 7 majors (typed-routes vs missing routes, no `.dockerignore`, no bind mounts, swagger-ui-react peer-dep mismatch, tsx in dev-deps but used at runtime, missing-watch in dev scripts, font outbound call) are real DX/correctness defects that the prior gates didn't catch because they were looking through security and lab-safety lenses, not build-and-run lenses. They're each fixable in 10-30 minutes.

Recommended sequence: Q-0.1 (lockfile) → Q-0.2 (alpine OpenSSL) → Q-0.3 (migrations + entrypoint) → run `make up` end-to-end → Q-0.4 (typed routes) → Q-0.5 (.dockerignore) → Q-0.6 (bind mounts) → ship the rest as a follow-up Phase-0.1 if needed. After the blockers are resolved I'd be happy to re-review.

— L7 QA Engineer

---

## Addendum — Build-author response (2026-05-28)

Below is the disposition of every finding. Implementer ran the fix-up
pass on the same day as the review. `pnpm install` + `tsc --noEmit`
were run end-to-end as part of remediation; all packages typecheck.

### Blockers — all FIXED

- **Q-0.1 (lockfile):** `pnpm install` run; `pnpm-lock.yaml` (4164
  lines, 136 KB) committed at the repo root. All three Dockerfiles
  now `COPY pnpm-lock.yaml` and use `pnpm install --frozen-lockfile`.
- **Q-0.2 (Prisma on alpine):** `RUN apk add --no-cache openssl
  libc6-compat` added to `apps/web/Dockerfile`, `apps/worker/Dockerfile`,
  and the new `apps/db-migrate/Dockerfile`. `binaryTargets = ["native",
  "linux-musl-openssl-3.0.x"]` added to `packages/db/prisma/schema.prisma`.
- **Q-0.3 (auto-migrate + seed path):** Initial migration generated
  via `prisma migrate diff` and committed at
  `packages/db/prisma/migrations/20260527000000_init/migration.sql`
  plus the `migration_lock.toml`. A new one-shot `db-migrate` service
  added to `docker-compose.yml` runs `prisma migrate deploy && tsx
  prisma/seed.ts` then exits; `web` and `worker` services
  `depends_on: db-migrate: condition: service_completed_successfully`.
  Exit criterion #6 is now reachable from `make up` alone.

### Majors — all FIXED

- **Q-0.4 (typed-routes vs missing routes):** Implemented option 3
  from the suggestion. Created `apps/web/app/login/page.tsx` and
  `apps/web/app/signup/page.tsx` as Phase-0 placeholder stubs
  (clearly marked "ships in Phase 1"). Better first-time UX than
  404s; removes the `next build` typecheck failure.
- **Q-0.5 (.dockerignore):** Created `.dockerignore` at repo root
  with the suggested set plus exclusions for `docs/`, `LICENSE`,
  `README.md`, etc. Anything explicitly needed inside an image is
  `COPY`'d by name.
- **Q-0.6 (bind mounts):** Bind mounts added for `web`, `worker`,
  and `bitcoin-mock` in `docker-compose.yml`, with anonymous-volume
  shadows for `node_modules` and `.next` to avoid host-vs-container
  contention on Windows.
- **Q-0.7 (swagger-ui-react React 19 peer):** Replaced
  `swagger-ui-react@5` with the vanilla `swagger-ui-dist` bundle.
  Removed `@types/swagger-ui-react`. Added a local
  `apps/web/types/swagger-ui-dist.d.ts` module declaration for the
  `swagger-ui-bundle.js` submodule entry. Confirmed no peer-dep
  warnings in the refreshed lockfile.
- **Q-0.8 (tsx in devDeps but runtime):** Moved `tsx` to
  `dependencies` in `apps/worker/package.json` and
  `apps/bitcoin-mock/package.json`. (Worker's `ioredis` default
  import also surfaced as a typecheck failure under the unified
  TS settings — switched to named import `import { Redis } from
  "ioredis"`.)
- **Q-0.9 (orphan dev scripts):** Removed the unused `dev: "tsx
  watch ..."` entries from `apps/worker` and `apps/bitcoin-mock`
  package.json. Hot reload in Phase 0 is via bind-mount + Next
  Fast Refresh in `web`; worker/bitcoin-mock restart on edit
  via Phase-1 follow-up if needed.
- **Q-0.10 (next/font/google outbound):** Replaced `next/font/google`
  with `@fontsource/inter` self-hosted weights (400/500/600/700)
  in `apps/web/app/layout.tsx`. No outbound calls at build or
  runtime; air-gapped operation works after first `pnpm install`.

### Consequential minors — all FIXED

- **Q-0.12 (LICENSE legal text):** Replaced the LICENSE body with
  the full canonical Apache 2.0 text, "SECURITY EDUCATION NOTICE"
  preserved as a prepended block. The patent grant the architect
  cited as the reason for choosing Apache now legally exists.
- **Q-0.13 (verbatimModuleSyntax mismatch):** Flipped
  `tsconfig.base.json` to `verbatimModuleSyntax: false` and removed
  the per-app overrides. Consistent across the workspace; the
  Phase-1 `jwt.ts`/`jwt-v1.ts` split won't trip on cross-package
  import-semantics divergence.
- **Q-0.15 (openapi-registry module duplication):** Anchored the
  registry `Map` to `globalThis.__bvbeOpenApiRegistry` (mirrors the
  Prisma client singleton in `packages/db/src/index.ts`). HMR- and
  route-segment-bundle-stable.

### Minors / nits deferred

- **Q-0.11 (`pnpm tsx` in Makefile):** Trainees hit this only at the
  `make flags` step (instructor-only). Defer.
- **Q-0.14 (worker `prisma generate`):** Addressed defensively as
  part of Q-0.2 — `apps/worker/Dockerfile` now runs `prisma generate`.
- **Q-0.16 (`make test` no-op):** Real concern, but Phase 0 has
  nothing to test. Phase 1 architect should treat introducing
  Vitest as a Gate-1 condition.
- **Q-0.17 (hosts-file friction):** `localhost` works because
  nginx's `server_name` includes it. Setup script in Phase 9 polish.
- **Q-0.18, Q-0.19:** Acknowledged, no action.

### Re-verification on host

- `pnpm install --ignore-scripts` → 0 peer-dep warnings; lockfile sync.
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-rpc-types exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean (after Prisma
  generate)
- Architect's "surfaces to leave clean" grep against `apps/` and
  `packages/` source — clean. (One transient hit on
  `apps/web/tsconfig.tsbuildinfo` was a TS incremental cache
  referencing node-types; added `*.tsbuildinfo` to `.gitignore`
  and removed the stale file.)

Phase 0 is now ready for a real `make up` smoke test on a clean
clone. The 3 blockers and 7 majors are all addressed; deferred
items have explicit Phase-1 / Phase-9 follow-ups.

— build-author
