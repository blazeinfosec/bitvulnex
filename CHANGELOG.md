# Changelog

This file is the source for the in-app `/about/changelog` page. From
Phase 9 onward, entries here may contain **diegetic hints** about
planted vulnerabilities — references to "fixed" issues that hint at
adjacent unfixed ones, TODOs left in the code, etc. They are part of
the lab.

## 2026-05-28 — Phase 1: authentication

- New: signup, login, password reset, TOTP-based 2FA.
- New: scoped API keys (read / trade / withdraw).
- New: admin endpoints under `/api/v2/admin/*` for user management.
- Legacy `/api/v1/*` mount remains available for mobile-app v1.x
  clients still in the field. v1 tokens are signed with the
  `legacy-2022` key (see `/api/.well-known/jwks.json`).
- Internal: refresh-token rotation is **not** yet wired (tracking
  ticket AUTH-114).
- Internal: middleware short-circuits on `x-middleware-subrequest`
  to skip auth checks for Next.js's own internal probes.

## 2026-05-27 — Phase 0: initial scaffolding

- Repository bootstrap: pnpm workspace, Next.js 15, Prisma + Postgres,
  Redis + BullMQ, nginx reverse proxy, mock bitcoind container.
- Design system: institutional palette, Inter, shadcn/ui primitives.
- No business features yet. No planted vulnerabilities. Stay tuned.
