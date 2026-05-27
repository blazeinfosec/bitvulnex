# Contributing to BVBE

> Read [`CLAUDE.md`](./CLAUDE.md) first. The four-gate workflow is
> non-negotiable.

## The four-gate workflow (recap)

Every phase and subphase passes four gates in order. Skipping a gate is
a process bug — stop and back up.

1. **Gate 1 — Senior Architect** reviews the phase plan. Validates
   scope, allocates which planted vulns belong in this phase, approves
   the data model and module boundaries. Output:
   `docs/phases/phase-N/architect-review.md`.
2. **Gate 2 — Staff Engineer** implements the architect-approved plan.
   Writes production-quality code, plants only architect-allocated
   vulns, updates `VULNS.md` with every planted flaw before handoff.
3. **Gate 3 — Adversarial QA** plays attacker. Produces working PoCs
   for every planted vuln; flags unintended vulns or over-obvious
   placements. Output: `docs/phases/phase-N/adversarial-qa.md`.
4. **Gate 4 — Paranoid QA** plays blue team. Verifies no real
   secrets/PII/mainnet paths; `docker-compose down -v` destroys all
   state; banners present; `VULNS.md` ledger matches code. Output:
   `docs/phases/phase-N/paranoid-qa.md`.

Only after **all four** gates pass does work get committed.

## Authoring a new planted vulnerability

1. Add a `V-NNN` entry to `VULNS.md` with the full format described
   there (category, phase, location, exploitation path, difficulty,
   realistic root cause, remediation).
2. Place the vulnerable code where a normal-but-careless team would
   plausibly have put it. **No tell comments** (`// VULN HERE`,
   `// FIXME insecure`, etc.).
3. Confirm the vuln is exploitable end-to-end and document the PoC in
   the phase's Adversarial QA file.
4. Cross-reference any chain membership: which killer chain consumes
   this vuln as a building block?

## Hard rules

- No real Bitcoin code paths. Mock/regtest only.
- No real PII in seed data (faker only).
- No real secrets. `.env.example` placeholders only; deliberate weak
  fallbacks must appear in `VULNS.md`.
- No outbound third-party network calls from app code.
- Every developer-facing surface carries the DO NOT DEPLOY banner.

## Reporting unintended bugs

Open an issue with a minimal reproduction. If your finding is already
in `VULNS.md`, it's a feature — please don't "fix" it.

## Style

- TypeScript everywhere; strict mode on.
- No comments explaining what code does — names and types do that. Use
  comments only when the *why* is non-obvious (a subtle invariant, a
  workaround, a deliberate trust boundary).
- Prefer `Decimal` (Prisma) for money; never `Number`. (Phase 4+
  intentionally violates this for V-29; that violation must be
  isolated to its planted file.)
