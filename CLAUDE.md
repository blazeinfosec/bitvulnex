# Blaze Vulnerable Bitcoin Exchange

> **AUTHORIZED SECURITY EDUCATION PROJECT.** This is a *deliberately vulnerable*
> web application built by Blaze Information Security for training,
> CTF-style exercises, and red/blue team practice. Security flaws are
> intentional. **Never deploy this to a public network. Never use real funds.
> Never reuse credentials from production systems.**

## Project goal

Build a realistic-looking Bitcoin exchange (signup, KYC, deposit, trade, order
book, withdrawal, admin, support chat) that contains planted, exploitable
vulnerabilities across four categories:

1. **OWASP Top 10 web vulns** — SQLi, XSS, CSRF, SSRF, IDOR, broken auth,
   broken access control, insecure deserialization, XXE, security misconfig.
2. **Crypto/Bitcoin-specific flaws** — withdrawal race conditions, integer
   over/underflow on balances, weak signature verification, address validation
   bypass, fee manipulation, double-spend windows, transaction replay.
3. **Business logic flaws** — negative-amount trades, price manipulation via
   stale data, KYC bypass, order book manipulation, withdrawal limit bypass,
   referral/promo abuse.
4. **Infra / supply chain / AI** — vulnerable dependencies, leaked secrets,
   weak Docker config, exposed admin endpoints, LLM prompt injection in the
   support chatbot, SSRF to cloud metadata.

Vulnerabilities must be **realistically placed** — embedded in plausible
business code, not signposted with comments like `// VULN HERE`. A reviewer
auditing the source should believe a normal-but-careless team wrote it.

## Stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **ORM / DB:** Prisma + PostgreSQL
- **Auth:** custom (intentional weaknesses) — *not* Auth.js/NextAuth
- **UI:** React 19, Tailwind CSS, shadcn/ui
- **Bitcoin:** simulated/regtest only — `bitcoinjs-lib` for address/sig logic,
  a mock node for confirmations. **No mainnet wallet code, ever.**
- **Background jobs:** BullMQ + Redis (for withdrawal processing — prime race
  condition surface)
- **Containerization:** Docker + docker-compose for the lab environment

## The implementation workflow (NON-NEGOTIABLE)

Every phase and every subphase of development passes through four gates in
order. Skipping a gate is a process bug — stop and back up.

### Gate 1 — Senior Architect review (of the plan)

Before any code is written, a Senior Architect role reviews the proposed
plan for the phase. Responsibilities:

- Validate that the phase scope maps to real exchange functionality (a real
  team would actually build this).
- Identify which planted vulnerabilities belong in *this* phase vs later.
- Approve the data model, API surface, and module boundaries.
- Reject plans where vulnerabilities are too obvious, too contrived, or
  stacked unrealistically in one file.
- Produce a short architect note appended to the phase plan: scope confirmed,
  vuln allocation, surfaces to leave clean, exit criteria.

**Invoke as:** `Agent(subagent_type=general-purpose, description="Senior architect review of phase N plan", ...)` with explicit "act as senior architect" framing, or run the role inline if a single conversation. Architect output is committed to `docs/phases/phase-N/architect-review.md`.

### Gate 2 — Staff Engineer implementation

A Staff Engineer role implements the approved plan. Responsibilities:

- Write production-quality code (clean naming, normal structure, real error
  handling on most paths) — the vulnerabilities should be the *exceptions*
  that look like ordinary mistakes, not the rule.
- Plant the vulnerabilities allocated by the architect — and **only** those.
  No bonus vulns sneaked in.
- Update `VULNS.md` (see below) with every planted flaw before handing off.
- No `// TODO: fix this`, `// insecure`, or other tells in source.

### Gate 3 — Adversarial QA (red team mindset)

A QA role plays an attacker who knows nothing about the planted vulns.
Responsibilities:

- Read the diff and the running app. Try to exploit it.
- Confirm every vulnerability the architect allocated is actually exploitable
  end-to-end. Produce a PoC (curl/HTTP/SQL/JS snippet) per finding.
- Flag *unintended* vulnerabilities introduced by the staff engineer — these
  go back to Gate 2 unless the architect explicitly accepts them.
- Flag vulns that are too obvious (e.g. literal `eval(req.body)`) — these go
  back to Gate 2 to be made more realistic.

Output: `docs/phases/phase-N/adversarial-qa.md` with PoCs and verdict.

### Gate 4 — Paranoid QA (defensive/compliance mindset)

A second QA role audits with a paranoid blue-team lens. Responsibilities:

- Verify no *unintended* secrets, real keys, real addresses, or real PII are
  in the repo.
- Verify there is no path to mainnet, no real-money code path, no outbound
  network call that could affect a third party.
- Verify the lab is self-contained: `docker-compose up` runs everything;
  `docker-compose down -v` destroys everything.
- Verify the `VULNS.md` ledger matches reality: every planted vuln listed,
  no listed vuln missing from code, no extra vuln in code.
- Verify the README warning banners are present in every developer-facing
  surface (root README, `/` page footer, login page).

Output: `docs/phases/phase-N/paranoid-qa.md` with sign-off or blocker list.

### Sign-off and commit

Only after **all four** gates pass does the work get committed. Commit message
format:

```
phase N.M: <subphase title>

Architect: approved (see docs/phases/phase-N/architect-review.md)
Adversarial QA: <N> planted vulns confirmed exploitable
Paranoid QA: clean (no real secrets, no mainnet path, ledger matches)
```

If any gate fails, loop back to the appropriate earlier gate. Never commit a
phase where a gate is marked "skipped" or "deferred."

## The VULNS.md ledger

`VULNS.md` lives at the repo root and is the **single source of truth** for
every planted vulnerability. Format per entry:

```
### V-{NNN}: <short title>
- **Category:** OWASP / Crypto / Business / Infra
- **Phase introduced:** N.M
- **Location:** path/to/file.ts:LINE (or "multiple", with list)
- **Exploitation path:** 1-3 sentence summary of how to trigger it
- **Intended discovery difficulty:** easy / medium / hard
- **Realistic root cause:** what an actual careless developer would have done to introduce this
- **Remediation:** how a real team would fix it (used by blue-team exercises)
```

`VULNS.md` is part of the lab materials but is **not** linked from any
attacker-facing page. It is for instructors, the dev loop, and post-exercise
debriefs.

## Hard rules

- **No real Bitcoin.** Regtest/mock only. No mainnet RPC endpoints, no real
  xpubs, no real signing keys for live addresses.
- **No real PII.** All seed data is synthetic. No scraped or leaked datasets.
- **No real secrets.** `.env.example` only. Any committed key is a planted
  vuln (and must appear in `VULNS.md`) or it is a process failure.
- **No outbound calls to third parties** from the app code path. SSRF demos
  target local mock services or the docker network, never the real internet.
- **Banner discipline.** Every entry point (README, landing page footer,
  login page, API root) must carry a visible "DELIBERATELY VULNERABLE — DO NOT
  DEPLOY" banner.
- **Phases ship vertically.** A phase delivers a working slice of the app
  (UI + API + DB + tests). No phase ships backend-only or frontend-only.

## Repo layout (target)

```
/
├── CLAUDE.md                  # this file
├── AGENTS.md                  # pointer to CLAUDE.md for non-Claude agents
├── README.md                  # public-facing lab readme + warning banner
├── VULNS.md                   # planted-vuln ledger
├── docs/
│   └── phases/phase-N/
│       ├── plan.md
│       ├── architect-review.md
│       ├── adversarial-qa.md
│       └── paranoid-qa.md
├── docker-compose.yml
├── app/                       # Next.js App Router
├── prisma/
├── lib/
├── tests/
└── scripts/                   # seed data, regtest helpers
```

## When you (Claude) work on this repo

1. Pick or confirm the current phase from `docs/phases/`.
2. If no plan exists for the active phase, draft one and run Gate 1.
3. Run gates in order. Do not commit until Gate 4 signs off.
4. Update `VULNS.md` as part of Gate 2, not after.
5. Keep responses tight; the gate documents are the artifacts that matter.
