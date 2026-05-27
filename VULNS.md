# Planted Vulnerability Ledger

> Source of truth for every **intentional** vulnerability in BVBE.
> If a flaw exists in the code but is not listed here, it is an
> unintended bug — please open an issue. If a flaw is listed here,
> it is a feature.
>
> This file is part of the lab materials. It is **not** linked from
> any attacker-facing page. It is for instructors, the dev/QA loop,
> and post-exercise debriefs.

## Format

Each entry:

```
### V-NNN: <short title>
- Category: OWASP / Crypto / Business / Infra
- Phase introduced: N.M
- Location: path/to/file.ts:LINE (or "multiple", with list)
- Exploitation path: 1-3 sentence summary of how to trigger it
- Intended discovery difficulty: easy / medium / hard / expert
- Realistic root cause: what a careless developer would have done
- Remediation: how a real team would fix it
- Chain membership: standalone | CHAIN A | CHAIN B | CHAIN C | CHAIN D
```

---

## Phase 0 — Scaffolding & safety rails

**No planted vulnerabilities.** This phase is the clean foundation.
Paranoid QA verifies the "surfaces to leave clean" list in
`docs/phases/phase-0/plan.md` returns zero grep hits.

---

## OWASP family

_(none yet — entries land in Phases 1–8)_

## Crypto / Bitcoin family

_(none yet — entries land in Phases 3, 7)_

## Business-logic family

_(none yet — entries land in Phases 4, 6, 7)_

## Infrastructure / supply chain family

_(none yet — entries finalized in Phase 9; some staged earlier)_

---

## Killer chains

Four expert-tier chains stitch component vulnerabilities together.
Each chain's component vulns will be listed here as they are planted.

- **CHAIN A — Drain the hot wallet** (FTX/Coincheck flavor)
- **CHAIN B — Become admin and persist** (smuggling/cache flavor)
- **CHAIN C — Mass user takeover** (oracle manipulation flavor)
- **CHAIN D — Exfiltrate full user DB + KYC** (SSRF → IMDS flavor)
