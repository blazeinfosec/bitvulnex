# Phase 7 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-06-20
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 7 is the highest-stakes phase by attacker reach: it both
finishes CHAIN A (drain hot wallet) and lands the most realistic
plant in the lab (PSBT signature flaw, Bitfinex-flavor). Build-author
has earned trust through Phase 6 — clean implementation,
realistic plants, no regressions. Phase 7 is large but the four
surfaces (user withdrawal, internal transfer, withdrawal worker,
treasury coordinator) decompose cleanly and only one of them
(treasury) touches the PSBT pipeline.

The "withdrawal pipeline" is the real-world critical path: this
is where real exchanges have been drained for nine-figure sums.
Plant realism matters more here than anywhere else. **The
adversarial QA gate must complete CHAIN A end-to-end, modulo the
Phase-9 git history leak.**

## Vuln placement review

Five plants approved. Numbers V-26, V-28, V-30, V-33, V-47.

### V-26 — Withdrawal limit reset off-by-one (EASY)

**Approved.** Architect picks the **day-reset framing** (build-author's
preference): the `currentDayUtc` boundary uses `>=` where it should
use `>`, so at the exact UTC midnight second a request gets attributed
to the *new* day's ledger while a concurrent request 1ms earlier
gets the *previous* day's ledger. Two requests timed across the
boundary double-withdraw.

**Realistic root cause:** classic "day truncation includes the
boundary millisecond" off-by-one. Engineer wrote `if (request.ts >=
midnight) useNewDayLedger();` without thinking about the millisecond
that sits AT midnight.

**Important:** the planted flaw is the boundary check itself, NOT
in the ledger upsert logic. The ledger semantics are correct
otherwise — sum-of-day is accurate, the unique constraint on
`(userId, utcDate, asset)` holds. The flaw lets an attacker time a
withdrawal pair across midnight to allocate them to different
buckets.

### V-28 — Classic withdrawal race (HARD)

**Approved.** Build-author's framing matches the master plan:
balance check and debit are not in a `$transaction`. Concurrent
single-packet requests with HTTP/2 frame timing both pass the
check, both debit (going negative or pushing through both at the
balance value).

**Architect adds a structural condition:** the `submitWithdrawal`
function MUST take the balance read and the balance debit as
**two separate Prisma calls** (`findUnique` then `update`), not as
a single `update` with a conditional. The flaw must be in the
read-then-write pattern, not in a subtle conditional. Real teams
make this exact mistake.

### V-30 — Internal transfer bypass (HARD)

**Approved with structural condition.** Build-author plans an
endpoint `/api/v2/me/internal-transfer` and a lib that skips
`checkAndDebitLimit` and `requireTier`. The structural condition:
the lib MUST NOT have a comment like "TODO: add limit check" —
that's signposting. Instead, the lib's docstring should describe
internal transfers as a "fee-free peer-to-peer move within BVBE,
designed for OTC desk client servicing." A realistic feature
description that doesn't mention limits because the engineer
believed limits didn't apply to internal moves.

**Realistic root cause:** OTC desk requested internal transfers as
a workaround for clients who didn't want to broadcast on-chain.
Internal team scoped it as a P2-priority feature and the engineer
who built it (different from the user-withdraw team) didn't know
about the daily-limit ledger.

### V-33 — PSBT signature flaw (EXPERT, CHAIN A)

**Approved with several structural conditions.**

The plan's framing (cached `decodePsbtCached` vs fresh
`decodePsbt`) is OK but needs sharpening. The architect prefers
this exact mechanism:

- `coordinator.ts` has a helper `validateIntendedOutputs(draft,
  decodedPsbt)` that runs **before** the broadcast step.
- The broadcast step calls `decodePsbt(draft.psbtBase64)` ONCE and
  passes the result to `validateIntendedOutputs`. Then it calls
  `finalizepsbt(draft.psbtBase64)` on the mock to get the wire-
  format hex.
- **The flaw:** the lab's PSBT envelope `BVBE_PSBT_V1:<json>` is
  parsed by `decodePsbt` using the FIRST occurrence of `BVBE_PSBT_V1:`
  in the input (i.e., `input.indexOf("BVBE_PSBT_V1:")` + slice + JSON
  parse). The mock node's `finalizepsbt` does the SAME, also using
  the first occurrence. **However**, a polyglot envelope of the form
  `BVBE_PSBT_V1:{"outputs":[{"address":"victim","amountSat":1}],"signatures":2}\nBVBE_PSBT_V1:{"outputs":[{"address":"attacker","amountSat":1}],"signatures":2}`
  is *both* a valid first-parse (victim output) AND, when the mock's
  `finalizepsbt` strips the leading envelope before re-extracting the
  outputs, gets the second occurrence's attacker output. The lab's
  PSBT parser has a subtle preprocessing step (`.replace(/^[\s\S]*?BVBE_PSBT_V1:/, "BVBE_PSBT_V1:")`)
  that — when applied to an envelope that contains TWO `BVBE_PSBT_V1:`
  markers — strips up to (but not past) the second one, exposing the
  second JSON to the finalize/broadcast step.

This is a **realistic class of flaw**: real PSBT validation has
been fooled by exactly this kind of "first occurrence" /
"prefix-aware re-parse" mismatch (Trezor 2018 PSBT bypass; ZenGo
2020). The lab's caricature shape is acceptable because the *class*
of flaw is real.

**Required:** the polyglot must require a SIGNED PSBT. An attacker
who has not collected the second signature cannot exploit V-33 —
the broadcast endpoint refuses unsigned drafts. CHAIN A requires
the attacker to forge a treasury operator JWT (Phase 8 path —
emergency-withdraw bypasses the sign requirement; until then, V-33
is reachable only by a real treasury operator, which is the
"insider threat" framing).

**Realistic root cause:** the validation helper was added late
in development to address a code review comment ("we should
re-check outputs before broadcast"); the engineer added the
helper but did not realize the parser's preprocessing step
behaved differently on multi-envelope inputs because they tested
only with well-formed single-envelope PSBTs.

### V-47 — RBF fee refund exploit (MEDIUM)

**Approved.** Build-author's framing is clean: fee delta credited
to user's available balance on bump, replacement TX confirmation
not pinned to the credit reversal. Architect adds: the credit
happens via a regular `balance.update({ increment: feeDelta })`
call inside the bump handler, with NO scheduling of a "if
replacement drops, debit back" job. Just a fire-and-forget credit.

**Realistic root cause:** engineer building the RBF bump feature
wrote the credit code and tested with the happy path (new TX
confirms); didn't think about the failure path where the new TX
drops out of mempool because miners don't pick it up at the
lower fee. The bumped-fee semantics are inverted from common
intuition: lowering the fee can cause the replacement to be
dropped while keeping the original TX (which paid the higher
fee) settled.

## Architect resolutions for the open questions

1. **CHAIN A emergency-withdraw endpoint: Phase 8.** Confirmed.
   Phase 7 leaves the surface area for `/api/v1/internal/treasury/
   emergency-withdraw` reserved.
2. **RBF bump endpoint owner.** Approved at `/api/v2/admin/withdrawals/[id]/bump`
   with `role === "admin" || role === "treasury"`. Phase 8 may
   relocate to `/api/v1/internal/...` and add the function-level
   access plant (V-6) on top.
3. **OTC double-fill carryover.** Architect picks **option (c) —
   close as unintended bug** but DEFER the fix to Phase 8. The
   reason: planting it now would crowd the Phase 7 ledger (already
   5 plants); planting it in Phase 8 makes more sense thematically
   if at all, since Phase 8 is the admin/replay surface. Build-
   author should add a `$transaction` wrap to `acceptOtc` in
   Phase 8, not Phase 7. **Phase 7 leaves it alone.** Document this
   in `paranoid-qa.md` as a known acknowledged surface — not in
   `VULNS.md`.
4. **PSBT caricature `BVBE_PSBT_V1:<json>`.** Approved. The lab is
   upfront that this is simulated. The V-33 mechanism is a real
   *class* of flaw, even if the wire format is caricatured.
5. **`Withdrawal.amount` excludes fee.** Approved. Match Binance UX.
6. **Confirmation threshold: 1.** Approved. Lab-realistic.
7. **V-26 day-reset framing.** Approved (see V-26 above).

## Conditions for Gate 2 entry

1. ✅ Withdrawal lib uses `Prisma.Decimal` end-to-end (no `Number`
   intermediates), per Phase-4 Q-3.11 / Phase-5 discipline. The
   limit ledger uses `BigInt` cents (the migration column is
   `BIGINT`); convert via `Prisma.Decimal.toFixed(8)` carefully.
2. ✅ Withdrawal worker uses the SAME DI seam pattern as
   deposit-watcher / liquidation-watcher / yield-accrual.
3. ✅ Treasury coordinator endpoints are gated on
   `claims.role === "admin" || claims.role === "treasury"` via a
   helper `requireTreasury(claims)` exported from `apps/web/lib/kyc-tier.ts`
   (extend the same module; don't create a new file).
4. ✅ The seed step adds two treasury-role users (`treasury2@bvbe.local`,
   `treasury3@bvbe.local`) so 2-of-3 signing is reachable in the
   lab. (`treasury@bvbe.local` already exists from Phase 0 seed.)
5. ✅ Mock node PSBT methods are extended cleanly. The caricature
   envelope `BVBE_PSBT_V1:` is documented in a comment block at
   the top of `apps/bitcoin-mock/src/state.ts` (or a new
   `psbt-envelope.ts`).
6. ✅ Migration date prefix: `20260620000000_phase_7_withdrawals_treasury`.
7. ✅ Internal-transfer lib has the OTC-desk-servicing docstring,
   no signposting comments.
8. ✅ V-33 polyglot mechanism: exact form described above. Tests
   for the validator MUST cover single-envelope happy path only;
   they MUST NOT test the multi-envelope path (that would signpost
   the plant).
9. ✅ Withdrawal status state machine is documented in a comment
   block on the enum. Status transitions: `pending → approved →
   broadcasting → broadcast → confirming → confirmed`. Side
   transitions: `pending/approved → rejected`, `broadcast → bumped`,
   `broadcasting/broadcast → failed`.
10. ✅ Daily limit values: pull from `kycLimits(tier).dailyWithdrawalCents`
    which already exists. Phase 7 just reads it.
11. ✅ All five plants get a `V-NNN` entry in `VULNS.md` matching
    the existing format.

## Surfaces to leave clean — reaffirmed

- `/api/v1/internal/*` (Phase 8) — including
  `emergency-withdraw`. Phase 7 must NOT create any route under
  `/api/v1/internal/`.
- nginx CL/TE-tolerant directives (Phase 9 — CHAIN B).
- `lodash` / `_.merge`/`_.set` (Phase 8).
- `child_process` / `exec` / `spawn` (Phase 8 PDF export plant).
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8).
- Stored XSS in display name (Phase 8).
- mXSS in markdown / support tickets (Phase 8).

## Forward note for Phase 8

Phase 8 is the admin/treasury/compliance/support surface. It will:
- Add `/api/v1/internal/treasury/emergency-withdraw` and plant
  V-6 (function-level access). CHAIN A closes.
- Add the stored XSS in display name → admin panel (V-1).
- Add the SQLi blind/2nd-order (V-11, V-12).
- Add the cmd injection in PDF/CSV export (V-17).
- Add the mXSS in markdown support tickets (V-18).
- Add the prototype pollution gadget (V-34).
- Possibly add the OTC double-fill fix (option (c) from Q3).

Phase 7 must NOT pre-plant any of these surfaces.

## Forward note on chain reach

- **CHAIN A** (drain hot wallet): Phase 7 plants V-33 (PSBT) and
  the withdrawal/treasury surface. Awaits Phase 8 (V-6 +
  emergency-withdraw) and Phase 9 (git history leak →
  JWT-signing key). **CHAIN A is the dominant narrative for
  Phase 7 — adversarial QA must walk it end-to-end.**
- **CHAIN B** (admin persistence): unchanged. Phase 8 + 9.
- **CHAIN C** (mass liquidation): complete since Phase 5.
- **CHAIN D** (DB+KYC exfil): unchanged.

## Test discipline

- No `it.skip()` tests that signpost plants.
- Unit tests cover happy paths. Adversarial QA owns PoCs for
  V-26, V-28, V-30, V-33, V-47.
- One conservation test in `withdrawal-processor.test.ts`: across
  N withdrawals, sum of debited balances equals sum of hot-wallet
  output amounts. This conservation property HOLDS even with V-28
  because the race lets a single user double-debit (so total debits
  match total outputs) — but the sum of *individual user* debits
  doesn't reconcile with their balance pre-state. The test should
  check pool-level conservation, NOT per-user reconciliation. (If
  we tested per-user, we'd accidentally test V-28.)

## Gate 2 entry: GO

Build-author may proceed to Staff Eng implementation.

— Architect
