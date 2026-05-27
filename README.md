# Blaze Vulnerable Bitcoin Exchange (BVBE)

> 🚨 **DO NOT DEPLOY.** This is a deliberately vulnerable application
> built by [Blaze Information Security](https://www.blazeinfosec.com/)
> for authorized security training. Security flaws are *intentional*.
> Never use real funds. Never expose to the public internet. Never
> reuse credentials from real systems. See [LICENSE](./LICENSE).

A realistic, modern Bitcoin exchange (signup, KYC, deposit, spot
trading, margin, lending, OTC, withdrawal, admin, treasury) seeded
with ~39 planted vulnerabilities spanning OWASP Top 10,
PortSwigger / James-Kettle-class tricks, Bitcoin-protocol flaws, and
business-logic bugs drawn from real incidents (Mt. Gox, Bitfinex,
FTX, Coincheck).

## Audience

- Pentester / red-team upskilling
- Capture-the-Flag exercises (CTF mode toggleable per cohort)
- Blue-team detection and IR practice
- Security research in isolated labs

## Status

**Phase 0 — scaffolding & safety rails.** No planted vulnerabilities
yet. Feature phases land per the workflow in [`CLAUDE.md`](./CLAUDE.md).

## Quick start

Requirements: Docker + Docker Compose, Node 22, pnpm 9.

```bash
cp .env.example .env
make up        # docker-compose up -d
make seed      # prisma migrate + seed admin user
open http://exchange.local/        # add to hosts: 127.0.0.1 exchange.local
```

Then:

- `http://exchange.local/` — landing page (with DO NOT DEPLOY banner)
- `http://exchange.local/about/changelog` — in-app changelog
- `http://exchange.local/docs` — public API documentation (Swagger)
- `http://exchange.local/api/health` — health check

Reset the lab:

```bash
make reset     # docker-compose down -v && up
```

## Repository layout

```
.
├── CLAUDE.md                  # canonical workflow + hard rules
├── AGENTS.md                  # pointer for non-Claude AI agents
├── VULNS.md                   # planted-vulnerability ledger
├── README.md                  # this file
├── LICENSE                    # Apache 2.0 + security-education notice
├── CONTRIBUTING.md            # how the 4-gate workflow operates
├── CHANGELOG.md               # mirrored at /about/changelog in-app
├── Makefile                   # thin wrapper around pnpm + docker-compose
├── docker-compose.yml         # 6 services
├── nginx/                     # reverse proxy config
├── apps/
│   ├── web/                   # Next.js 15 (App Router)
│   ├── worker/                # BullMQ worker
│   └── bitcoin-mock/          # JS bitcoind RPC simulator (own container)
├── packages/
│   ├── db/                    # Prisma schema + seed
│   ├── shared/                # JWT, types, shared utilities
│   └── bitcoin-rpc-types/     # RPC contract types
├── docs/
│   ├── architecture.md        # request flow + trust boundaries
│   └── phases/phase-N/        # plan, architect, adversarial, paranoid QA
└── scripts/                   # seed framework, reset, derive-flags
```

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
