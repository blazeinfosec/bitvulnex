# AGENTS.md

This repository uses [`CLAUDE.md`](./CLAUDE.md) as the canonical guidance
document for all AI coding agents (Claude Code, Codex, Cursor, Aider, etc.).

**Read `CLAUDE.md` in full before making any change.** It defines:

- The project's purpose (a *deliberately vulnerable* Bitcoin exchange for
  authorized security training — never deploy, never use real funds).
- The stack (Next.js 15 + Prisma + Postgres + TypeScript).
- The four-gate workflow that every phase and subphase must pass through:
  1. **Senior Architect** review of the plan
  2. **Staff Engineer** implementation
  3. **Adversarial QA** (red-team mindset, must produce PoCs)
  4. **Paranoid QA** (blue-team mindset, must sign off on lab safety)
- The `VULNS.md` ledger format for every planted vulnerability.
- Hard rules: no real Bitcoin, no real PII, no real secrets, no outbound
  third-party calls, warning banners on every entry point.

Do not skip gates. Do not commit until Gate 4 has signed off. Do not plant
vulnerabilities that aren't allocated to the current phase by the architect.

If you are an agent that prefers `AGENTS.md` over `CLAUDE.md`, treat the two
as equivalent — `CLAUDE.md` is the source of truth and this file is a
forwarding pointer.
