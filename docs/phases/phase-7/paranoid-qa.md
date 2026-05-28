# Phase 7 — Paranoid QA (Gate 4)

**Reviewer:** Paranoid QA / compliance
**Date:** 2026-05-28
**Scope:** Phase 7 — withdrawal pipeline + treasury coordinator
(`apps/web/lib/withdrawal/*`, `apps/web/lib/treasury/*`,
`apps/web/app/api/v2/me/{withdrawals,internal-transfer}/**`,
`apps/web/app/api/v2/admin/{treasury,withdrawals}/**`,
`apps/web/app/api/v2/public/treasury/hot-wallet/**`,
`apps/web/app/{withdraw,transfer,admin/treasury}/page.tsx`,
`apps/worker/src/withdrawal-processor.ts`,
`apps/bitcoin-mock/src/rpc/index.ts`, `apps/bitcoin-mock/src/state.ts`,
`packages/shared/src/psbt-envelope.ts`,
`packages/db/prisma/migrations/20260620000000_phase_7_withdrawals_treasury/migration.sql`,
`packages/db/prisma/seed.ts`)
**Verdict:** **PASS**

## Methodology

Read `CLAUDE.md`, `VULNS.md` (current 26 entries; 21 prior +
V-26 / V-28 / V-30 / V-33 / V-47 added in Phase 7),
`docs/phases/phase-7/plan.md`, `docs/phases/phase-7/architect-review.md`,
and `docs/phases/phase-7/adversarial-qa.md` including the
architect disposition addendum on U-7.1. Walked the Phase 7 diff
(`git status --short` — 12 modified + 14 new path entries).
Targeted grep for mainnet / outbound-fetch / hardcoded-secret
patterns. Verified the U-7.1 fix landed in code. Confirmed
architect's surfaces-to-leave-clean list was not touched.

## Lab-safety checks

### PII in seed data

**PASS.** `packages/db/prisma/seed.ts` adds two role accounts:
`treasury2@bvbe.local` (Treasury Ops B) and `treasury3@bvbe.local`
(Treasury Ops C), both with password
`"change-me-after-first-login"` and `kycTier: 3`. Domain
`bvbe.local` is the lab's reserved synthetic domain — not a real
deliverable mailbox. Display names are role labels, not real
people. No real names, real emails, real addresses, or real IBANs
introduced. Existing `FIRST` / `LAST` arrays (Lovelace, Torvalds,
Hopper, etc.) are computer-science luminaries used deterministically
under the `example.test` reserved TLD (RFC 6761); unchanged in
Phase 7.

### Mainnet code paths

**PASS.** Grep across the repo for
`mainnet|xpub|xprv|mempool\.space|blockstream|blockchain\.info`
(case-insensitive) returned 18 files. Cross-checked: every match
lives in docs (`docs/phases/phase-*/`, `VULNS.md`, `CLAUDE.md`,
`CONTRIBUTING.md`, `AGENTS.md`, `CHANGELOG.md`,
`apps/web/app/page.tsx` lab-banner text), in
`packages/shared/src/btc-address.ts` (Phase 3 planted-vuln —
V-24 HRP-permissive validator, owned by Phase 3 ledger, not
introduced by Phase 7), or in `docs/phases/phase-3/poc-scratch.mjs`
(Phase 3 artifact). No Phase 7 new file references mainnet, real
xpubs, or any public chain endpoint.

`apps/web/lib/treasury/coordinator.ts` talks to the mock node via
`rpc()` only (`btc-rpc-client` → `BITCOIN_MOCK_URL`
→ `http://bitcoin-mock:18443`, docker-internal). The mock-node
extensions in `apps/bitcoin-mock/src/rpc/index.ts` mutate only
the in-memory `chain` state from `../state.ts`. PSBT envelope
parsing in `packages/shared/src/psbt-envelope.ts` is pure
in-process JSON. No mainnet code path opened.

### Outbound third-party calls

**PASS.** Grep across the Phase 7 new files
(`apps/web/lib/withdrawal/*`, `apps/web/lib/treasury/*`,
`apps/worker/src/withdrawal-processor.ts`,
`packages/shared/src/psbt-envelope.ts`) for
`fetch(|axios|node-fetch|http\.get|https\.get`: **zero matches**.

All network I/O routes through `rpc()` (the existing
`btc-rpc-client` → `bitcoin-mock` over `bvbe-net`), Prisma
(`db` over `bvbe-net`), or BullMQ (Redis over `bvbe-net`). The
admin treasury UI, withdraw UI, and transfer UI all call
same-origin `/api/v2/...` via the browser. No third-party
hostnames appear anywhere in Phase 7 additions.

### Committed secrets

**PASS.** Grep across Phase 7 new files for
`api_key|apikey|secret|password|aws_|AKIA|sk_live|sk_test|BEGIN [A-Z]+ PRIVATE KEY`
(case-insensitive): no matches in
`apps/web/lib/withdrawal/*`, `apps/web/lib/treasury/*`.
`.env.example` unchanged by Phase 7 (`git diff HEAD -- .env.example`
returned empty). The new seed users
(`treasury2@bvbe.local`, `treasury3@bvbe.local`) use the same
placeholder password `"change-me-after-first-login"` as every
other role account (`admin`, `treasury`, `support1`, `support2`,
`compliance`).

Note: the architect note flagged that V-9's `changeme` default
already exists in Phase 1 plant code. Phase 7 did NOT introduce a
new fallback. Acknowledged and proceed (V-9 is a tracked planted
vuln, not a Paranoid QA concern).

### DO NOT DEPLOY banners

**PASS.** The three new UI pages
(`apps/web/app/withdraw/page.tsx`,
`apps/web/app/transfer/page.tsx`,
`apps/web/app/admin/treasury/page.tsx`) are App Router pages
under `app/` and therefore inherit `apps/web/app/layout.tsx`. The
root layout renders `<DoNotDeployBanner variant="top" />` above
`<NavBar />` and `<DoNotDeployBanner variant="footer" />` below
the `<Footer />`. None of the three pages declare their own
`layout.tsx` or `not-found` boundary that would bypass the root
layout. Banner discipline holds.

### Lab self-containment

**PASS.** `docker-compose.yml` unmodified by Phase 7 (no entry in
`git status --short`). The withdrawal worker runs inside the
existing `worker` service (the BullMQ queue is added to
`apps/worker/src/index.ts` only). The mock-node extensions land
in the existing `bitcoin-mock` service. No new docker services,
no new volumes, no new ports.

`docker-compose down -v` continues to destroy the `bvbe-db` and
`bvbe-uploads` named volumes that hold all Phase 7 state
(Withdrawal rows, WithdrawalLimitLedger, InternalTransfer,
TreasuryDraft, TreasurySignature). No host-path bind mounts hold
withdrawal data.

## VULNS.md ledger sync

| V-NNN | Code matches description? | Location accurate? |
|-------|---------------------------|--------------------|
| V-26  | yes | `apps/web/lib/withdrawal/limit.ts:33-37` (`currentDayUtc`) + `:52-95` (`checkAndDebitLimit`) — ledger keyed on `(userId, utcDate, asset)` exactly as described |
| V-28  | yes | `apps/web/lib/withdrawal/submit.ts:53-118` — `balance.findUnique` (L74) → `checkAndDebitLimit` → `balance.update` (L93) — no enclosing `$transaction` |
| V-30  | yes | `apps/web/lib/withdrawal/internal-transfer.ts:35-109` — no `checkAndDebitLimit`, no `requireTier` beyond the route-layer Tier-1 floor; the `$transaction` only fences sender debit + recipient credit, not the limit ledger |
| V-33  | yes | Validation parser at `packages/shared/src/psbt-envelope.ts:42-49` (first-marker semantics); broadcast canonicalization at `apps/bitcoin-mock/src/rpc/index.ts:118-127` (last-marker via `segs[segs.length-1]`); wiring at `apps/web/lib/treasury/coordinator.ts:118-160` (`broadcastDraft` decodes once via `decodePsbt`, validates, then passes the same `psbt` string to `finalizepsbt`) |
| V-47  | yes | `apps/web/lib/withdrawal/rbf.ts:46-69` — `feeDelta = oldFeeSat - args.newFeeSat`; positive delta immediately credits `balance.available` and `balance.amount`; no compensating watcher in `withdrawal-processor.ts` |

## U-7.1 fix verification

**Confirmed fixed; not in VULNS.md.** Per the architect
disposition addendum at the end of `docs/phases/phase-7/adversarial-qa.md`
(2026-06-20), U-7.1 (cancel double-cancel race) was FIXED as an
unintended bug, not accepted into the ledger.

Reading `apps/web/lib/withdrawal/cancel.ts`:

- The `updateMany` predicated on `status: { in: ["pending", "approved"] }`
  is present at L32-35, **inside** the `db.$transaction` at L31.
- A `count` check at L36-38 throws `CancelValidationError` when
  zero rows are affected — exactly the addendum's described shape.
- The `balance.update` refund at L39-45 runs only when the
  `updateMany` flipped a row.
- No `V-NNN` entry for the cancel race appears in `VULNS.md`
  (last entry is V-47).

Adversarial QA's PoC for U-7.1 is no longer reachable: the second
of two concurrent cancels sees `flipped.count === 0` and throws,
so the refund is issued exactly once.

## Architect's surfaces-to-leave-clean

| Surface | Status |
|---------|--------|
| `/api/v1/internal/*` (Phase 8) | clean — `ls apps/web/app/api/v1/` returns existing v1 paths only; no new `internal` mount; grep across `apps/` for `/api/v1/internal` returned zero matches in Phase 7 additions |
| lodash `_.merge` / `_.mergeWith` / `_.set` (Phase 8) | clean — grep across `apps/web/lib/withdrawal/*` and `apps/web/lib/treasury/*` returned zero matches |
| `child_process` / `exec` / `spawn` (Phase 8) | clean — zero matches in Phase 7 new code |
| `$queryRawUnsafe` / template-literal SQL (Phase 8) | clean — zero matches in Phase 7 new code; all DB access is Prisma client (`db.withdrawal.*`, `db.balance.*`, `db.treasuryDraft.*`, etc.) |
| nginx CL/TE-tolerant directives (Phase 9) | clean — `nginx/nginx.conf` not in Phase 7 diff |
| new SSRF surfaces | clean — outbound network calls in Phase 7 new code = zero |
| stored XSS in display name / mXSS (Phase 8) | clean — no new display-name render path; treasury UI renders `intentNote` through React text nodes only (no `dangerouslySetInnerHTML`); admin treasury page slices IDs/txids to short prefixes |
| OTC accept handler (architect deferred to Phase 8) | clean — `apps/web/lib/otc/accept.ts` not in Phase 7 modified list (`git status --short` confirms); last commit on file is pre-Phase-7 |

## CHAIN A status

V-33 is exploitable end-to-end at the Phase-7 boundary under the
architect's specified **insider-threat treasury operator** model.
Verified the polyglot flow is not closed by any other Phase 7
code path:

- `broadcastDraft` at `coordinator.ts:118-160` accepts the
  `overridePsbt` parameter unchanged (no schema check forbidding
  multi-envelope inputs at the route layer);
- the `decodePsbt` validation step (`coordinator.ts:143`) reads
  the FIRST marker only (`psbt-envelope.ts:42-49`);
- `finalizepsbt` (`bitcoin-mock/src/rpc/index.ts:118-127`)
  canonicalizes to `segs[segs.length - 1]` and feeds that to
  `decodePsbtShared`;
- `sendrawtransaction` at `rpc/index.ts:61-86` admits the
  `RAWTX:` envelope outputs to `chain.admitRawTx` verbatim.

No defensive code anywhere in the broadcast path collapses the
two parsers to a single canonical view. The plant lands intact.

Phase 7's CHAIN A surface is the marquee plant; awaits Phase 8
(`/api/v1/internal/treasury/emergency-withdraw` + V-6
function-level access bypass) and Phase 9 (git-history JWT
signing key leak) to lift it from insider-threat reach to
unauthenticated external reach.

## OTC double-fill carryover

**Phase 7 left it alone, as the architect required (Q3 option (c),
deferred to Phase 8).** Verified: `apps/web/lib/otc/accept.ts`
absent from the Phase 7 modified file list. Adversarial QA's
"Carryover observations" section corroborates. This is documented
here as an acknowledged surface (not a `V-NNN`); Phase 8
build-author will wrap `acceptOtc` in a `$transaction` when the
admin-replay surface lands.

## Verdict

**PASS.** No real PII, no mainnet code path, no outbound
third-party calls, no committed secrets, banners inherited on
all three new UI surfaces, lab still self-contained under
`docker-compose down -v && up`. `VULNS.md` ledger matches code
for V-26 / V-28 / V-30 / V-33 / V-47 with accurate locations.
U-7.1 fix present in `cancel.ts`, not in the ledger. Architect's
surfaces-to-leave-clean list intact.

Phase 7 cleared for commit.

— Paranoid QA
