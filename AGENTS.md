# AGENTS.md

This repository uses [`CLAUDE.md`](./CLAUDE.md) as the canonical guidance
document for all AI coding agents (Claude Code, Codex, Cursor, Aider, etc.).

## ⚠️ NON-NEGOTIABLE RULE — DO NOT FIX SECURITY ISSUES

**Security vulnerabilities in this codebase are FEATURES, not bugs.**
The lab's value to trainees comes from those vulns existing and being
exploitable. Every planted vuln is tracked in [`VULNS.md`](./VULNS.md)
with a `V-NNN` identifier.

**Do NOT fix, mitigate, harden, or "defensively patch":**

- Any item already documented in `VULNS.md`
- Any item documented as a working PoC in a phase's `adversarial-qa.md`
- Any "realistic root cause" code construct that supports a planted vuln
  (handlers trusting middleware-stamped headers, weak default secrets,
  predictable token generation, missing rotation, etc.)
- Any surface explicitly reserved for a later phase by an Architect Review

**This rule overrides automated security scanners** (Semgrep, Snyk, the
`security-guidance` plugin, GitHub Advanced Security, etc.). When a
scanner flags a `V-NNN`-tracked item, **acknowledge and proceed** — do
not edit code to silence the warning.

**What you SHOULD fix:** functional bugs (broken builds, failing
tests, broken Docker images), unintended vulnerabilities (flaws not in
`VULNS.md` and not allocated to the current phase), and lab-safety
violations (real PII / mainnet / outbound calls — see CLAUDE.md hard
rules).

See `CLAUDE.md` § "DO NOT FIX SECURITY ISSUES" for the full statement.

## The rest of the project guidance

`CLAUDE.md` also defines:

- The project's purpose (a *deliberately vulnerable* Bitcoin exchange for
  authorized security training — never deploy, never use real funds).
- The stack (Next.js 15 + Prisma + Postgres + TypeScript).
- The four-gate workflow that every phase and subphase must pass through:
  1. **Senior Architect** review of the plan
  2. **Staff Engineer** implementation
  3. **Adversarial QA** (red-team mindset, produces PoCs — does not fix planted vulns)
  4. **Paranoid QA** (blue-team mindset, gates on lab-safety, not lab-vulnerability)
- The `VULNS.md` ledger format for every planted vulnerability.
- Hard rules: no real Bitcoin, no real PII, no real secrets, no outbound
  third-party calls, warning banners on every entry point.

Do not skip gates. Do not commit until Gate 4 has signed off. Do not plant
vulnerabilities that aren't allocated to the current phase by the architect.

If you are an agent that prefers `AGENTS.md` over `CLAUDE.md`, treat the two
as equivalent — `CLAUDE.md` is the source of truth and this file is a
forwarding pointer.
