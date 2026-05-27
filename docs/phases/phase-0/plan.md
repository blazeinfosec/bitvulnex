# Phase 0 — Scaffolding & Safety Rails

> Input to **Gate 1 (Senior Architect)**. Authored by the planning role
> (you, the project lead) on 2026-05-27. No planted vulnerabilities in
> this phase — Phase 0 is the clean foundation everything else is grafted
> onto.

## Goal

Stand up the bones of the app so every later phase can plug in its
feature slice and its planted vulns without touching infrastructure.
After Phase 0, `docker-compose up` produces a running but feature-empty
exchange shell that is **obviously a lab** (DO NOT DEPLOY banners on
every surface) and that has all hooks the later phases will use:
nginx in front, JWT-only auth scaffold, mock bitcoind RPC, Prisma
migrations baseline, Swagger mount, CTF/hint env-var plumbing, VULNS.md
ledger, and the in-app diegetic-hints surface (`/about/changelog`).

## Non-goals for Phase 0

- No business features (no signup, no orders, no deposits, no withdrawals)
- No planted vulnerabilities of any kind — Paranoid QA will explicitly
  verify the scaffolding is clean
- No real Bitcoin code paths (mock node only)
- No seed users yet beyond a single hardcoded `admin@bvbe.local` that
  exists solely so Phase 1's signup flow has a counterparty
- No rate limiting, no monitoring (per locked scope)

## Deliverables (file inventory)

### Repo root

- `README.md` — landing doc with DO NOT DEPLOY banner, project purpose,
  audience, how to start, links to CLAUDE.md / VULNS.md / docs/phases
- `LICENSE` — **Apache 2.0** (per architect decision on open Q 2) +
  disclaimer paragraph stating this is authorized security education
  material
- `CONTRIBUTING.md` — gate workflow summary, how to claim a vuln slot
- `CHANGELOG.md` — empty header; the in-app `/about/changelog` page
  reads from this file
- `VULNS.md` — skeleton with category headers (OWASP / Crypto /
  Business / Infra) and the V-NNN entry format from CLAUDE.md
- `.gitignore`, `.editorconfig`, `.nvmrc` (node 22 LTS)
- `.env.example` — placeholder values; final form set in Phase 9
- `package.json` (root) — pnpm workspace declaration
- `pnpm-workspace.yaml`
- `tsconfig.base.json`

### `docker-compose.yml`

Six services (revised per architect review — `bitcoin-mock` broken out):

| Service        | Image                | Notes                                             |
|----------------|----------------------|---------------------------------------------------|
| `nginx`        | nginx:1.25-alpine    | Reverse proxy. CL/TE-tolerant block staged but    |
|                |                      | inert (no upstreams Phase-0 sensitive to it).     |
| `web`          | node:22-alpine build | Next.js 15 app (App Router). Bind-mounted in dev. |
| `worker`       | node:22-alpine build | BullMQ worker stub. No jobs registered yet.       |
| `bitcoin-mock` | node:22-alpine build | Express server exposing the bitcoind RPC stub on  |
|                |                      | an internal-only port (not routed via nginx).     |
| `db`           | postgres:16-alpine   | Volume-backed; reset on `down -v`.                |
| `redis`        | redis:7-alpine       | No persistence in dev.                            |

Compose entrypoint runs Prisma migrate + seed before the web container
serves. Health checks on db/redis so web waits. One named volume each
for `db` and `redis`. `docker-compose down -v` must wipe everything.

### `nginx/`

- `nginx.conf` — proxies `/` → `web:3000`. Includes a commented-out
  block reserved for the deliberate CL/TE-tolerant config that Phase 9
  will activate as part of CHAIN B. Phase 0 keeps it inert and
  documented so adversarial QA can verify it's not exploitable yet.

### `apps/web/` (Next.js 15)

- `next.config.ts`, `tsconfig.json`, `package.json`
- `app/layout.tsx` — root layout with `<DoNotDeployBanner />` in header
  and footer; Inter font; Tailwind base
- `app/page.tsx` — landing page (institutional aesthetic): hero with
  product blurb, ticker placeholder, "Sign in / Sign up" CTAs (links
  go to `/login` and `/signup` which will 404 until Phase 1)
- `app/about/changelog/page.tsx` — renders `CHANGELOG.md` as MDX. Empty
  in Phase 0 except for an entry: "2026-05-27 — initial scaffolding."
- `app/docs/page.tsx` — Swagger UI mount; reads an OpenAPI spec at
  `/api/openapi.json`. Phase 0 spec lists only `GET /api/health`.
- `app/api/health/route.ts` — returns `{status: "ok", phase: 0}`;
  registers itself with the OpenAPI registry on import.
- `app/api/openapi.json/route.ts` — serves the OpenAPI doc built from
  the registry (per architect decision on Issue 2)
- `lib/openapi-registry.ts` — `registerEndpoint(spec)` collector. Phase
  0 plumbing for the "intentionally incomplete docs" mechanism: later
  phases simply do not call `registerEndpoint()` for endpoints they
  want absent from public docs. This makes the gap structural, not
  manually maintained.
- `components/ui/*` — shadcn primitives needed for the shell: Button,
  Card, Container, NavBar, Footer
- `components/banner/do-not-deploy.tsx` — sticky red banner; cannot be
  dismissed; renders on every page via layout
- `lib/env.ts` — env-var loader with typed schema (zod). Knows about
  `CTF_MODE`, `HINT_MODE`, `SCOREBOARD_ENABLED`, `JWT_SECRET`,
  `DATABASE_URL`, `REDIS_URL`. Falls back behavior is deliberate
  Phase 1 territory; Phase 0 just defines the schema with strict
  parsing.
- `lib/ctf.ts` — flag-string derivation: `BVBE{<sha256(vulnId + salt)>}`.
  Salt comes from env. Phase 0 ships the function; no flag is wired
  to any surface yet.
- `styles/globals.css` — Tailwind + design tokens (navy/white)

### `packages/db/` (Prisma)

- `prisma/schema.prisma` — bootstrap schema with `User` (id, email,
  passwordHash, role, kycTier, createdAt) and a single seeded admin
  row. Migration baseline. No other models in Phase 0 — Phase 1
  extends.
- `prisma/seed.ts` — creates the admin row; idempotent. No other seed
  data in Phase 0.

### `apps/bitcoin-mock/` (revised per architect — own container)

- `src/server.ts` — Express server exposing the bitcoind RPC subset
  over HTTP JSON-RPC on an internal-only port (not routed by nginx).
  Phase 7's PSBT signing flaw (V-33) requires this to be across a
  network boundary; in-process would make the flaw contrived.
- `src/rpc/*.ts` — handlers for `getblockchaininfo`, `generatetoaddress`,
  `getnewaddress`, `gettransaction`, `sendrawtransaction`,
  `getrawmempool`, `decodepsbt`, `walletprocesspsbt`. Phase 0 stubs
  return well-typed fixtures; Phase 3+ fills in regtest semantics.
- `package.json` — internal app

### `packages/bitcoin-rpc-types/`

- `src/index.ts` — TS types for the bitcoind RPC surface. Imported by
  both `apps/bitcoin-mock/` (the server side) and `apps/web/` (the
  client side, Phase 3+). Single source of truth for the contract.

### `packages/shared/`

- `src/jwt.ts` — JWT issue/verify wrappers. Phase 0 ships the *clean*
  implementation (HS256 with a strong secret loaded from env, exp
  enforced, alg whitelist). Phase 1 adds the *vulnerable* v1 verifier
  in parallel — Phase 0 does not.
- `src/types.ts` — shared TS types

### `apps/worker/`

- `src/index.ts` — boots a BullMQ worker connected to Redis. Phase 0
  registers zero queues; the process just stays up and logs idle.

### `docs/`

- `docs/architecture.md` — one-page overview: containers, request flow,
  trust boundaries, where vulns will live in later phases. Lives next
  to the phase artifacts and gets revised as later phases land.
- `docs/phases/phase-0/plan.md` — this file
- `docs/phases/phase-0/architect-review.md` — produced by Gate 1
- `docs/phases/phase-0/adversarial-qa.md` — produced by Gate 3
- `docs/phases/phase-0/paranoid-qa.md` — produced by Gate 4

### `scripts/`

- `scripts/seed-framework.ts` — typed faker wrappers (`fakeUser`,
  `fakeOrder`, etc.). Phase 0 ships the framework but only `fakeUser`
  is implemented (used by Phase 1+).
- `scripts/reset-lab.sh` — wraps `docker-compose down -v && up`
- `scripts/derive-flags.ts` — CLI to print all CTF flags given the
  current `CTF_SALT`. Instructor utility.

### `Makefile` (per architect decision on open Q 4)

Thin wrapper around pnpm + docker-compose for muscle-memory parity with
typical pentest lab UX. Targets:

- `make up` → `docker-compose up -d`
- `make down` → `docker-compose down`
- `make reset` → `scripts/reset-lab.sh`
- `make seed` → `pnpm --filter @bvbe/db seed`
- `make logs` → `docker-compose logs -f web`
- `make test` → `pnpm -r test`
- `make flags` → `pnpm tsx scripts/derive-flags.ts`

## Architecture notes

- **Monorepo layout:** pnpm workspace; `apps/*` are deployables,
  `packages/*` are libraries shared between them.
- **Single origin** (per scope): everything served from `exchange.local`
  via nginx. No subdomain split.
- **JWT-only auth** is *scaffolded* in Phase 0 (`packages/shared/jwt.ts`)
  but no protected routes exist yet.
- **Trust boundaries (for later vuln placement):**
  1. Internet → nginx (request-smuggling surface, Phase 9 activation)
  2. nginx → Next.js (proxy cache for `/api/public/*`, Phase 4
     activation)
  3. Next.js → Postgres/Redis/mock-bitcoind (internal trust assumed)
- **No `/api/v1/*` namespace in Phase 0.** Phase 1 introduces v1 as
  the deliberate "legacy" mount that hosts JWT `alg=none`, `kid`
  traversal, etc. Phase 0 only mounts `/api/v2/*` (just `/health` and
  `/openapi.json`).

## VULNS.md treatment for Phase 0

VULNS.md ships in Phase 0 with the format header, category sections,
and a "Phase 0: no planted vulns" note. The first real entry lands in
Phase 1.

## Exit criteria

1. `docker-compose up -d` brings up nginx, web, worker, db, redis
2. `curl http://exchange.local/api/health` returns `{status:"ok",phase:0}`
3. Landing page renders at `http://exchange.local/` with **DO NOT
   DEPLOY** banner visible at top and bottom
4. `http://exchange.local/about/changelog` renders the initial entry
5. `http://exchange.local/docs` renders Swagger UI listing only
   `GET /api/health`
6. Prisma migration runs; `admin@bvbe.local` row exists
7. Worker process is up and idle
8. `docker-compose down -v` removes containers and named volumes
9. README + LICENSE + VULNS.md skeleton present at repo root
10. No planted vulnerabilities (Paranoid QA verifies)
11. `bitcoin-mock` service is up; reachable on its internal port from
    `web`; not exposed via nginx
12. `/api/openapi.json` is built from `openapi-registry`, not hand-written
13. `Makefile` exists; `make up`, `make seed`, `make reset`, `make test`,
    `make flags` all work
14. The "surfaces to leave clean" list above returns **zero grep hits**
    in the Phase 0 repo

## Architect resolutions (Gate 1, 2026-05-27)

All four open questions resolved. See `architect-review.md` for the
full review. Summary of decisions reflected above:

1. **bitcoin-mock containerized** as its own `apps/bitcoin-mock/` service
   (Issue 1 in the review)
2. **Apache 2.0** license (open Q 2)
3. **Swagger always public, built from a registry** at
   `lib/openapi-registry.ts` (Issue 2 / open Q 3)
4. **Makefile ships alongside pnpm scripts** (open Q 4)

Forward-looking note for **Phase 1** (Issue 3 in the review): the
vulnerable v1 JWT verifier must live in a separate file
(`packages/shared/jwt-v1.ts`), not by adding flags to the clean
`jwt.ts`. Phase 1 architect review will enforce this.

## Surfaces to leave clean (architect-enforced; Paranoid QA verifies)

Per architect review, the following must produce **zero grep hits** in
the Phase 0 repo. Each is reserved for a later phase:

- `/api/v1/` (any v1 route) — Phase 1
- `/api/v1/internal/` — Phase 8
- nginx `proxy_cache_*` directives — Phase 4
- nginx CL/TE-tolerant directives (active) — Phase 9
- WebSocket server / origin check — Phase 4
- `lodash.merge` / deep-merge utilities — Phase 8 (V-34)
- `child_process` / `exec` / `spawn` — Phase 8 (V-17)
- `eval` / `node-serialize` / unsafe deserializers — later
- Raw SQL via template literals / Prisma `$queryRawUnsafe` — Phase 8
- Deliberate `.env.example` weak-key fallbacks — Phase 1
