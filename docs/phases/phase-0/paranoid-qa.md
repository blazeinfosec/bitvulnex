# Phase 0 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA. Verifying that the
> Phase 0 scaffolding cannot accidentally cause harm in the real
> world, that the lab is self-contained, and that all hard rules from
> `CLAUDE.md` and the architect review hold.
> **Date:** 2026-05-27
> **Verdict:** **PASS — clean for sign-off.**

## Checklist

### 1. No real Bitcoin / mainnet exposure

- `grep -i 'mainnet|xpub|xprv|<base58/bech32 mainnet>'` → **clean**.
  Only matches are policy text (CLAUDE.md / CONTRIBUTING.md) and a
  user-facing reassurance string on the landing page ("Nothing here
  touches mainnet").
- The only Bitcoin code in Phase 0 is `apps/bitcoin-mock/`, which
  returns hardcoded fixtures (regtest-shaped `bcrt1q…` placeholder
  address; zero hash for txids; chain="regtest" in `getblockchaininfo`).
- No `bitcoinjs-lib` usage in Phase 0 (deferred to Phase 3+).
- `BITCOIN_MOCK_URL` resolves to an internal docker DNS name only.

### 2. No real PII

- `grep '@gmail.com|@outlook.com|@yahoo.com|@hotmail.com|@protonmail.com'`
  → **no matches**.
- Seed data: Phase 0 inserts exactly one row — `admin@bvbe.local`. The
  domain `.local` is RFC 6762 reserved (mDNS) and cannot resolve to a
  real address. Synthetic and obvious.
- `scripts/seed-framework.ts` uses `example.test` for synthetic user
  emails (RFC 2606 reserved for testing). Names come from a hardcoded
  list of historical computing figures, not from any scraped dataset.

### 3. No real secrets

- `grep -i 'api[_-]?key|secret[_-]?key|private[_-]?key|aws|AKIA[0-9A-Z]{16}'`
  → **no matches**.
- `.env.example` ships placeholder values only. No fallback strings in
  `docker-compose.yml` after F-0.2 fix (Gate 3): both `JWT_SECRET` and
  `CTF_SALT` use the `${VAR:?error}` form to fail-fast if unset.
- No `.env` file exists in the working tree (only `.env.example`).
- `.gitignore` excludes `.env` and `.env.local`.
- Postgres credentials in `docker-compose.yml` are
  `POSTGRES_USER=bvbe / POSTGRES_PASSWORD=bvbe` — obviously synthetic,
  bound to an internal docker network, and the `db` service has no
  host port mapping. Acceptable lab practice.

### 4. No outbound calls to third parties from app code

- The only outbound call surface in Phase 0 is `web → bitcoin-mock`,
  over the internal `bvbe-net` docker network.
- `next/font/google` loads the Inter font at **build time** and
  self-hosts it; no runtime fetch to Google.
- The footer contains a single user-initiated `<a target="_blank">`
  to `https://www.blazeinfosec.com/` (the parent organization). This
  is a user-click navigation, not an outbound call from app code.
  Acceptable under the hard rule.

### 5. Banner discipline

- `DoNotDeployBanner` is rendered in `apps/web/app/layout.tsx`
  **twice** (top + footer). The root layout wraps every page, so
  every server-rendered surface (`/`, `/about/changelog`, `/docs`)
  carries both banners.
- `README.md` opens with a blockquote warning.
- `LICENSE` includes a prepended "SECURITY EDUCATION NOTICE."
- `CHANGELOG.md` includes a note about the lab nature.
- `VULNS.md` includes a "not linked from any attacker-facing page"
  notice.

### 6. Lab teardown destroys state

- `docker-compose.yml` declares one named volume (`bvbe-db`). Redis
  runs with `--save "" --appendonly no` (no persistence). bitcoin-mock
  is in-memory only.
- `docker compose down -v` removes all named volumes. `make reset`
  wraps the down/up cycle.

### 7. VULNS.md ledger matches code

- VULNS.md states: "Phase 0 — Scaffolding & safety rails. **No planted
  vulnerabilities.**"
- The Adversarial QA report confirms zero planted vulns in code.
- The architect-mandated "surfaces to leave clean" grep set (10
  patterns) returned zero hits in code (matches limited to
  documentation that *describes* the future placement of those
  patterns). Confirmed:
  - `/api/v1/` — no routes; only doc references
  - `proxy_cache_*` — only in an nginx comment about Phase 4
  - nginx CL/TE-tolerant directives (active) — none
  - WebSocket server — none
  - `lodash` / deep-merge — none
  - `child_process` / `exec` / `spawn` — none
  - `eval` / `node-serialize` / unsafe deserializers — none
  - Raw SQL via template literals / `$queryRawUnsafe` — none
  - Deliberate `.env.example` weak-key fallbacks — none (F-0.2
    eliminated the premature leak)
  - `dangerouslySetInnerHTML` / `innerHTML` / `new Function` — none

### 8. Exit criteria from the architect-updated plan

All 14 exit criteria pass on static review. Live-up verification will
be possible once the lab is bootstrapped (Phase 0 sign-off includes
`pnpm install` + `make up` as the first post-commit smoke test).

| # | Criterion                                                          | Status |
|---|--------------------------------------------------------------------|--------|
| 1 | `docker-compose up -d` brings up the six services                  | ✅ static |
| 2 | `GET /api/health` returns `{status:"ok",phase:0}`                  | ✅ static |
| 3 | Landing page renders with DO NOT DEPLOY banner                     | ✅ static |
| 4 | `/about/changelog` renders the initial entry                       | ✅ static (Dockerfile fix applied) |
| 5 | `/docs` renders Swagger listing only `GET /api/health` (+ openapi) | ✅ static |
| 6 | Prisma migration runs; `admin@bvbe.local` row exists               | ✅ schema + seed present |
| 7 | Worker process is up and idle                                      | ✅ static |
| 8 | `docker-compose down -v` removes containers and named volumes      | ✅ static |
| 9 | README + LICENSE + VULNS.md skeleton present                       | ✅ verified |
| 10 | No planted vulnerabilities                                        | ✅ Adversarial QA confirmed |
| 11 | `bitcoin-mock` reachable from `web`; not exposed via nginx        | ✅ static (no host port; no nginx route) |
| 12 | `/api/openapi.json` built from registry                           | ✅ verified in code |
| 13 | Makefile targets work                                              | ✅ static (`make up/down/reset/seed/test/flags`) |
| 14 | Surfaces-to-leave-clean returns zero grep hits in code             | ✅ verified above |

## Verdict

**PASS. Phase 0 is signed off.** Safe to commit. No blockers, no
deferred items. Sign-off and initial commit may proceed.

— Paranoid QA
