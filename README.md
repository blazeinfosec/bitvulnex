# Bitvulnex — Vulnerable Bitcoin Exchange

> 🚨 **DO NOT DEPLOY.** Bitvulnex is a deliberately vulnerable application
> built by [Blaze Information Security](https://www.blazeinfosec.com/)
> for authorized security training. Security flaws are *intentional*.
> Never use real funds. Never expose to the public internet. Never
> reuse credentials from real systems. See [LICENSE](./LICENSE).

Bitvulnex is a realistic, modern Bitcoin exchange — signup, KYC, deposits,
spot trading, margin, lending/staking, OTC, P2P, withdrawals, treasury,
admin, and a support desk — seeded with **40 planted vulnerabilities**.
The flaws span the OWASP Top 10, Bitcoin-protocol and crypto-finance bugs,
business-logic abuse, and infrastructure / supply-chain weaknesses, and are
drawn from real exchange incidents (Mt. Gox, Bitfinex, FTX, Coincheck) and
real CVE shapes (e.g. the Next.js middleware bypass, HTTP request smuggling).

Every flaw is embedded in plausible business code — no `// VULN HERE`
signposting — so the app reads like something a normal, slightly careless
team shipped. The full catalog (root cause, exploitation path, and the fix a
blue team would apply) lives in [`VULNS.md`](./VULNS.md).

## Audience

- Pentester / red-team upskilling
- Capture-the-Flag exercises (CTF mode toggleable per cohort)
- Blue-team detection and incident-response practice
- Security research in isolated labs

## Status

**Feature-complete.** All planned phases have shipped through the four-gate
workflow in [`CLAUDE.md`](./CLAUDE.md). The lab contains **40 planted
vulnerabilities** (catalog: [`VULNS.md`](./VULNS.md)) and **4 end-to-end
"killer chains"** — all verified exploitable against a live stack
(receipts: [`docs/exploitation/`](./docs/exploitation/)).

| Chain | Outcome | Path |
|-------|---------|------|
| **A** | Drain the hot wallet | git-history JWT leak → forged admin → internal-namespace bypass → polyglot PSBT broadcast |
| **B** | Become admin & persist | mass-assignment on `PATCH /api/v2/me` → plant a second admin (CL/TE smuggle is the env-dependent delivery variant) |
| **C** | Mass user takeover | self-trade poisons the public price oracle → liquidation worker fires → attacker keeper claims the rebate |
| **D** | Exfiltrate user DB + KYC | internal-namespace dump of password hashes, *or* KYC URL-import SSRF → cloud metadata → mock S3 |

## Quick start

Requirements: Docker + Docker Compose. (Node 22 + pnpm 9 only needed for
local non-Docker dev.)

```bash
cp .env.example .env
make up        # docker compose up -d — builds + starts all services
               # the db-migrate container applies migrations and seeds ~54 users
open http://localhost/
```

Everything comes up self-contained — the seed runs automatically as part of
`make up`. Useful URLs once the stack is healthy:

- `http://localhost/` — landing page (with DO NOT DEPLOY banner)
- `http://localhost/about/changelog` — in-app changelog
- `http://localhost/docs` — public API documentation (Swagger)
- `http://localhost/api/health` — health check (`{"status":"ok"}`)

Seeded logins (password `change-me-after-first-login`):
`admin@bvbe.local`, `treasury@bvbe.local`, `compliance@bvbe.local`,
`mm.alpha@bvbe.local` / `mm.beta@bvbe.local` (pre-funded market makers).

Re-seed or reset the lab:

```bash
make seed      # re-run prisma seed against the running db
make reset     # docker compose down -v && up  (pristine state)
```

## Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript, React 19, Tailwind
- **DB / ORM:** PostgreSQL + Prisma
- **Auth:** custom (intentionally weak in places) — *not* Auth.js/NextAuth
- **Background jobs:** BullMQ + Redis (deposit watch, liquidations, market
  maker, yield accrual, withdrawals)
- **Bitcoin:** simulated regtest only — a JS bitcoind RPC mock. **No mainnet
  code, ever.**
- **Edge:** nginx reverse proxy. **Containerization:** Docker Compose.

## Repository layout

```
.
├── CLAUDE.md                  # canonical workflow + hard rules
├── AGENTS.md                  # pointer for non-Claude AI agents
├── VULNS.md                   # planted-vulnerability ledger (40 entries)
├── README.md                  # this file
├── LICENSE                    # Apache 2.0 + security-education notice
├── CONTRIBUTING.md            # how the 4-gate workflow operates
├── CHANGELOG.md               # mirrored at /about/changelog in-app
├── Makefile                   # thin wrapper around pnpm + docker compose
├── docker-compose.yml         # 9 services + a db-migrate init container
├── nginx/                     # reverse proxy config (the public edge)
├── apps/
│   ├── web/                   # Next.js 15 (App Router) — the exchange
│   ├── worker/                # BullMQ worker (jobs + market-maker bot)
│   ├── ws-gateway/            # WebSocket gateway (live order book / trades)
│   ├── bitcoin-mock/          # JS bitcoind RPC simulator (own container)
│   ├── db-migrate/            # one-shot migrate + seed container
│   ├── mock-imds/             # mock cloud metadata service (SSRF target)
│   └── mock-s3/               # mock S3 (KYC bucket; SSRF pivot target)
├── packages/
│   ├── db/                    # Prisma schema + seed
│   ├── shared/                # JWT, types, shared utilities
│   └── bitcoin-rpc-types/     # RPC contract types
├── docs/
│   ├── architecture.md        # request flow + trust boundaries
│   ├── phases/phase-N/         # plan, architect, adversarial, paranoid QA
│   ├── exploitation/          # live-verified PoCs + per-chain receipts
│   ├── instructor-manual/     # vuln catalog, killer chains, audit
│   └── hints/                  # per-vuln + per-chain CTF hints
└── scripts/                   # seed framework, reset, derive-flags, cohorts
```

## Running a CTF cohort

The exchange ships with a 44-target CTF mode (40 planted vulnerabilities
+ 4 killer-chain bonus flags). Set `CTF_MODE=true` in `.env` and the
trainee-facing surfaces appear:

- **`/ctf`** — trainee page. Lists every target, accepts
  `{BLAZE_BITVULNEX_...}` flag submissions, tracks per-trainee score,
  exposes an optional
  two-tier hint system (basic = category-only, verbose = lens + category,
  time-locked per the cohort's `verboseUnlockSeconds`).
- **`/admin/ctf`** — instructor console (reach by typing the URL; not
  linked from the public navbar). Create/archive/reset cohorts, toggle
  hint defaults, edit verbose-unlock windows, view per-trainee scoreboard
  + per-target reveal heat map, CSV export, instructor reveal-flag
  override (audit-logged).

### Per-cohort workflow

1. Spin up an isolated cohort: rotate `CTF_SALT` and run
   `scripts/new-cohort.sh <cohort-name> [--hints=on|off]`. The script
   logs in as admin, creates the cohort, and prints the 44-flag table
   (save to an instructor-private file — do NOT share with trainees).
2. Trainees sign up on the running stack. They auto-attach to the
   `default` cohort on first `/ctf` interaction. Move them to your
   real cohort by editing `User.cohortId` directly, OR (recommended)
   spin up a separate `docker compose` project per cohort with a
   different `CTF_SALT` and isolated DB.
3. During the exercise, monitor `/admin/ctf` → scoreboard for progress.
   The heat map highlights targets with high reveal counts as
   `warn` — useful for spotting "everyone's stuck on V-22, need to
   rephrase the hint" patterns.
4. At session end, archive the cohort (`PATCH /api/v2/admin/ctf/cohorts/<id>
   {archived:true}`). CSV-export the scoreboard for cohort post-mortem.
5. **Reset semantics**: `POST /api/v2/admin/ctf/cohorts/<id>/reset` drops
   all submissions, interactions, and hint reveals for the cohort
   (audit-logged). The cohort row itself stays so historical pointers
   remain valid.

### Flag delivery patterns

Three patterns, used per the vuln's natural exploit shape:

- **Pattern A — inline emission.** The vuln's exploit-condition is
  server-side detectable; the response includes
  `_flag: {BLAZE_BITVULNEX_...}`.
  Used by V-4, V-22, V-25, V-40, V-46, V-47, V-51 (more wiring tracked
  in `docs/phases/phase-11/slice-2x-todo.md`).
- **Pattern B — claim endpoint.** `POST /api/v2/ctf/claim` with
  `{vulnId, proof}`. Validator checks the proof's shape (a polyglot
  envelope, a smuggled HTTP frame, an SQLi payload, etc.) and returns
  the flag if it matches.
- **Pattern C — self-derivable.** The trainee discovers a static
  secret (`changeme`, `.env.bak` contents, a CVE id, a private-scope
  package name) and submits it as the proof. The flag is deterministic
  in (vulnId, secret) and does NOT involve `CTF_SALT` — the same secret
  yields the same flag across cohorts because the secret IS the
  static codebase. Pattern C plants: V-9, V-15, V-48, V-49.

The 4 killer-chain flags pay 5× a single-vuln flag in the scoreboard
weight; each requires multi-step composite proof submitted to the
claim endpoint.

### Hint authoring

Hints live in `docs/hints/V-NNN.md` (plants) and `docs/hints/CHAIN-X.md`
(chains, multi-step). Format:

```markdown
---
target: V-22
category: OWASP / Mass assignment
tier-1-basic: |
  Category-only nudge (≤ 200 chars, no file paths).
tier-2-verbose: |
  Lens + category guidance (≤ 600 chars, no file paths or payloads).
---
```

The depth-ceiling validator runs in CI (`apps/web/lib/ctf/__tests__/
hints.test.ts`) — malformed front-matter fails `pnpm -w run test`. After
editing hints in the docker dev stack, hit `POST /api/v2/admin/ctf/
reload-hints` to clear the in-process cache without restarting the web
container.

## Workflow

Every phase of development passes four sign-off gates (Senior Architect
→ Staff Engineer → Adversarial QA → Paranoid QA) before any commit.
See [`CLAUDE.md`](./CLAUDE.md) for the full process and
[`docs/phases/`](./docs/phases/) for per-phase artifacts.

## Reporting a real bug

If you find a vulnerability that is **not** documented in `VULNS.md`,
that's an unintended bug — please open an issue. If it *is* in
`VULNS.md`, that's a feature, not a bug. 🙂

## License

[Apache 2.0](./LICENSE) with a prepended security-education notice.
Forks for training use are encouraged; redistribution must preserve
the notice and the DO NOT DEPLOY banner.
