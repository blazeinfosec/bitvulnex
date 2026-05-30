# Hint authoring guide

Hints are two-tier, served by `apps/web/lib/ctf/hints.ts` to authed
trainees in cohorts that have `hintsDefault=true` (or for trainees who
opt in via `hintsOverride=enable`).

## Format

Each file lives at `docs/hints/<TARGET>.md` and starts with front
matter delimited by `---`. Two shapes:

### Plant hints (one V-NNN per file)

```markdown
---
target: V-22
category: OWASP / Mass assignment
tier-1-basic: |
  Some user-controlled inputs are being trusted as authoritative
  data writes. Find a place that treats form input as the source of
  truth for a server-side update.
tier-2-verbose: |
  Server Actions in Next.js receive FormData on the server. When an
  action iterates the entries and forwards them into a database
  update without an explicit allow-list, a client that sends extra
  fields can mutate columns the form never advertised. The action
  here belongs to the order-edit flow under the account area.
---
```

### Chain hints (one CHAIN-X.md, multiple steps)

```markdown
---
target: CHAIN-A
category: Crypto / Trust boundary chain
steps:
  1:
    tier-1-basic: "Recon. Look for committed credentials in non-obvious places."
    tier-2-verbose: "Operational files sometimes survive in version control even after a delete. The credential you find should match a runtime environment value."
  2:
    tier-1-basic: "Privilege gain. Some routes trust an internal-traffic marker."
    tier-2-verbose: "Look at what headers the edge does and does not strip on inbound. An internal-only header that escapes the strip list becomes a public bypass."
  3:
    tier-1-basic: "Asset broadcast. The validation step and the broadcast step may not agree on the payload."
    tier-2-verbose: "When a wallet broadcasts a transaction, multi-segment envelopes can be parsed differently by the validator and by the node. The discrepancy is in which segment is treated as canonical."
---
```

## Hard rules

The validator in `apps/web/lib/ctf/hints.ts` rejects:

- **basic > 200 chars** or **verbose > 600 chars** (length ceiling)
- **basic** containing file paths (`apps/`, `packages/`, `nginx/`),
  line numbers, CVE refs, prototype names, or shell commands.
  Basic is **category-only**.
- **verbose** containing file paths, line numbers, or shell commands.
  Verbose is **lens + category** — names what to scrutinize, never
  where the code lives.

Broken hints fail `pnpm -w run test`. They do NOT ship to runtime as
half-broken; the validator runs in CI per architect Gate-1 addendum
condition #6.

## Authoring labor

Slice 3 ships exemplars covering the major V-NNN categories:

- XSS / Auth / Crypto / Path traversal / Mass assignment / Header trust
- All 4 killer chains

The remaining ~30 V-NNN hints can land as a content-only follow-up
slice (no code changes). The validator + loader expects the file to
exist when a trainee opens that target's basic hint — until a file
ships, the trainee gets `404 unknown target` (the /ctf page surfaces
this gracefully as "no hint authored yet").

## Adding a new hint

1. Pick the target's V-NNN id or chain step.
2. Write `<TARGET>.md` (or add a step to an existing `CHAIN-*.md`).
3. Run `pnpm -w run test` — the validator catches depth-ceiling
   violations and short/long copy.
4. Cohort default `hintsDefault=true` exposes the hint immediately.
   Trainees with `hintsOverride=disable` still don't see it.

## What hints should NOT do

- **Never name the planted file.** Trainees can find that themselves.
- **Never include the exploit payload.** Hints guide *investigation*.
- **Never assume the trainee read `VULNS.md`** — that's instructor-
  only material.
