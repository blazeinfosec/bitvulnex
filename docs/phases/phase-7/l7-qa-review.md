# Phase 7 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-28
**Scope:** commit `607c144` "phase 7: withdrawals + multi-sig treasury coordinator"
**Verdict:** **PASS**

## Methodology

Read `CLAUDE.md` (DO NOT FIX rule), `VULNS.md` (26 entries), the Phase 7
plan / architect / adversarial QA (with U-7.1 architect addendum) /
paranoid QA. Walked `git show 607c144 --stat` (43 changed files,
+4870/-10) and read every Phase-7-introduced lib, route, worker, and
mock-node file end to end:
`apps/web/lib/withdrawal/{limit,submit,cancel,internal-transfer,rbf}.ts`,
`apps/web/lib/treasury/coordinator.ts`,
`apps/web/lib/kyc-tier.ts`,
`packages/shared/src/psbt-envelope.ts`,
`apps/bitcoin-mock/src/{rpc/index.ts,state.ts}`,
`apps/worker/src/{withdrawal-processor,index}.ts`,
all 10 new route handlers, the additive migration, and the seed
diff. Diffed every prior planted-vuln file
(`middleware.ts`, `otc/accept.ts`, `engine/{match,fees,place}.ts`,
`deposit-watcher.ts`, `yield-accrual.ts`, `staking/claim.ts`,
`ws-gateway/`, `nginx/`) between `01845b9` (Phase 6) and `607c144`
to confirm no incidental modifications. Ran `pnpm install`,
`pnpm test`, `tsc --noEmit` across all five workspace packages,
and `pnpm --filter @bvbe/web build`.

## Findings

### Blockers

(none)

### Majors

(none)

### Minors / Nits

- **`api/openapi.json/route.ts` registers `/me/withdrawals/[id]/cancel`
  but the corresponding `registerEndpoint(...)` block in
  `/me/withdrawals/[id]/route.ts` only documents GET, not the cancel
  POST.** Cancel is registered inside its own route file at
  `apps/web/app/api/v2/me/withdrawals/[id]/cancel/route.ts:12` — fine,
  no doc-coverage gap. Spot-confirmed.
- **`bumpWithdrawalFee` derives `userId` from the row, but the BumpArgs
  type includes `operatorUserId`** (`apps/web/lib/withdrawal/rbf.ts:28`)
  which is never consulted inside the function — the audit trail of
  *who* bumped is lost. Not a security issue (the route already
  enforces `requireTreasury`); nit-level cleanliness.
- **`treasury/coordinator.ts` `IntendedOutput.amountSat` is `number`**
  (line 18). `Number.MAX_SAFE_INTEGER` covers ~9.0e6 BTC in sats which
  is well above lab balance ceilings, so no exploitability, but a
  future `BigInt` consideration when the lab adds real tBTC ranges.
- **`processWithdrawalOnce` confirmations loop calls
  `client.gettransaction(w.txid).catch(() => null)` and then continues
  on errors** (`withdrawal-processor.ts:75-76`). On a genuinely lost
  txid the row sits in `broadcast` forever. Lab-only; acceptable.

### Regressions of planted vulnerabilities

**(empty)** — verified Phase 7 did not touch any prior `V-NNN`
surface. Cross-reference table:

| V-NNN | Surface | Modified by Phase 7? | Status |
|-------|---------|----------------------|--------|
| V-1 (Phase 8 future) | n/a | n/a | not yet planted |
| V-4 IDOR on order GET/DELETE | `me/orders/[id]/route.ts` | no | intact |
| V-8 JWT alg=none | `jwt-v1.ts` | no | intact |
| V-9 legacy HMAC default | `env.ts` / `jwt-v1.ts` | no | intact |
| V-10 predictable reset token | `password-reset/request/route.ts` | no | intact |
| V-13 open redirect `?next=` | `login-form.tsx` | no | intact |
| V-14 KYC doc traversal | `me/kyc/doc/route.ts` | no | intact |
| V-19 HS256/RS256 confusion | `jwt-v1.ts` + JWKS | no | intact |
| V-20 kid path traversal | `jwt-v1.ts` `loadKidKey` | no | intact |
| V-21 refresh single-use | `auth/refresh/route.ts` | no | intact |
| V-22 mass assignment Server Action | `account/orders/edit-order.ts` | no | intact |
| V-23 CSWSH on WS gateway | `apps/ws-gateway/src/server.ts` | no | intact |
| V-24 BTC address bypass | `packages/shared/src/btc-address.ts` | no | intact; `submitWithdrawal` calls `isValidBtcAddress` correctly (line 60), so the bypass remains reachable through the withdraw surface |
| V-25 self-trade | `engine/match.ts` | no | intact |
| V-27 lex tier compare | `kyc-tier.ts` | no | `requireTier(claims, 1)` unchanged at L50-57; both `me/withdrawals/route.ts:57` and `me/internal-transfer/route.ts:44` invoke it. V-27 reach preserved on the new endpoints |
| V-32 OCO cancel race | `me/orders/[id]/route.ts` + `engine/place.ts` | no | intact |
| V-35 middleware bypass | `apps/web/middleware.ts` | no | intact |
| V-40 KYC SSRF | `me/kyc/import-url/route.ts` | no | intact |
| V-41 polyglot upload XSS | `me/kyc/documents/route.ts` + admin viewer | no | intact |
| V-42 zero-conf credit | `deposit-watcher.ts` | no | intact |
| V-43 fee-tier cancel-counts | `engine/fees.ts` | no | intact; the cancel surface added in Phase 7 is for `Withdrawal` rows, not `Order` rows, so the matching-engine pattern is untouched |
| V-44 lending interest off-by-one | `yield-accrual.ts` | no | intact |
| V-45 staking claim race | `staking/claim.ts` | no | intact |
| V-46 OTC desk header | `me/otc/accept/route.ts` + `nginx.conf` | no | intact (architect deferred OTC double-fill fix to Phase 8 confirmed) |

`git diff 01845b9 607c144 -- <each planted file>` returns empty for
every entry above. No accidental remediation.

## U-7.1 fix verification

`apps/web/lib/withdrawal/cancel.ts` confirmed correct:

- L31 opens `db.$transaction(async (tx) => { ... })`.
- L32-35 `tx.withdrawal.updateMany({ where: { id: w.id, status: { in: ["pending", "approved"] } }, data: { status: "rejected", ... } })`.
- L36-38 `if (flipped.count === 0) throw new CancelValidationError(...)`.
- L39-45 `tx.balance.update increment refund` inside the same transaction.

The `creditBackLimit` call at L50-58 runs *outside* the transaction
(unchanged from pre-fix). This is consistent with the architect's
addendum (no race re-introduced — the ledger credit is a per-row
upsert keyed on the same `(userId, utcDate, asset)` that's used at
submit-time; idempotency is governed by Postgres's row-level lock on
that key, and the addendum explicitly notes the limit ledger
credit-back was already outside the transaction pre-fix).

**Not** present in `VULNS.md` — last entry is V-47 (verified by reading
the entire file; no V-48). Architect's "no new V-NNN" disposition
holds.

The U-7.1 PoC (two concurrent cancels both refunding) no longer
reproduces: the predicated `updateMany` flips the row exactly once;
the loser sees `flipped.count === 0` and throws.

## Architect's Gate-2 conditions

| # | Condition | Status |
|---|-----------|--------|
| 1 | `Prisma.Decimal` end-to-end in withdrawal lib | ✅ `submit.ts`/`cancel.ts`/`rbf.ts`/`internal-transfer.ts` use `Prisma.Decimal`; ledger `BigInt(amountCents)` only at the cents boundary |
| 2 | Worker uses same DI seam pattern | ✅ `processWithdrawalOnce(client, db = prisma)` matches deposit-watcher/yield-accrual shape |
| 3 | `requireTreasury` in `kyc-tier.ts` | ✅ at `kyc-tier.ts:68-73`; all four treasury/admin routes use it |
| 4 | Seed adds `treasury2@bvbe.local`, `treasury3@bvbe.local` | ✅ `seed.ts` diff shows both, role `treasury`, kycTier 3 |
| 5 | Mock PSBT envelope documented | ✅ `packages/shared/src/psbt-envelope.ts:1-9` carries the caricature documentation block |
| 6 | Migration date `20260620000000_phase_7_withdrawals_treasury` | ✅ exact match |
| 7 | Internal-transfer OTC-desk-servicing docstring, no signposting | ✅ `internal-transfer.ts:1-8`; no `TODO`/`FIXME`/`insecure` comments anywhere in Phase 7 new code |
| 8 | V-33 polyglot mechanism (first vs last marker); tests cover happy path only | ✅ `psbt-envelope.ts:42-49` reads first marker; `bitcoin-mock/src/rpc/index.ts:118-127` `segs[segs.length - 1]` reads last; `psbt-envelope.test.ts` is round-trip + preamble-skip-on-single-marker only — no multi-envelope assertion |
| 9 | Status state machine documented on enum | ✅ `schema.prisma` comment block above `enum WithdrawalStatus` documents the full transition table |
| 10 | Daily limit pulls from `kycLimits(tier).dailyWithdrawalCents` | ✅ `limit.ts:62` |
| 11 | All five plants in `VULNS.md` with full format | ✅ V-26 / V-28 / V-30 / V-33 / V-47 entries match Category / Phase / Location / Exploitation path / Difficulty / Realistic root cause / Remediation / Chain membership shape; V-33 chain membership reads "CHAIN A — the signing flaw that routes a treasury withdrawal to an attacker-controlled address. Awaits Phase 8 ... and Phase 9 ..." |

## Surfaces to leave clean

| Surface | Verdict |
|---------|---------|
| `/api/v1/internal/*` (Phase 8) | clean — `Glob apps/web/app/api/v1/internal/**` returns no files |
| lodash `_.merge` / `_.set` (Phase 8) | clean — `Grep lodash` in `apps/web/lib/withdrawal/` and `apps/web/lib/treasury/` returns no matches |
| `child_process` / `exec` / `spawn` (Phase 8) | clean — `Grep child_process` returns no matches in Phase 7 additions |
| `$queryRawUnsafe` / template-literal SQL (Phase 8) | clean — all DB access is Prisma client |
| nginx CL/TE block (Phase 9) | clean — `nginx/` directory diff between Phase 6 and Phase 7 commits is empty |
| new SSRF surfaces | clean — no `fetch`/`axios`/`http.get` in Phase 7 libs; all I/O via `rpc()` (mock node, docker-internal) |
| Stored XSS in display name / mXSS (Phase 8) | clean — no new display-name render path; `/admin/treasury` renders strings as React text nodes only, no `dangerouslySetInnerHTML` |
| OTC accept (deferred to Phase 8) | clean — `apps/web/lib/otc/accept.ts` not in Phase 7 diff |

## CHAIN A insider-threat reach

**V-33 polyglot is exploitable end-to-end today under the
insider-treasury-operator threat model.** Walked the path against the
code:

1. Attacker treasury operator A authors a draft via
   `POST /api/v2/admin/treasury/drafts` with
   `intendedOutputs = [{address:"victim", amountSat:1}]` →
   `createDraft` writes `psbtBase64 = encodePsbt({outputs:[victim]})`,
   single envelope. (`coordinator.ts:30-77`)
2. A signs:
   `POST /api/v2/admin/treasury/drafts/<id>/sign` → first
   `TreasurySignature` row keyed on `(draftId, authorUserId)`.
   The `@@unique([draftId, signerUserId])` enforces distinct
   signers but allows author to be one of them — realistic in real
   multi-sig.
3. Treasury operator B (the second insider) signs the same draft
   → status flips to `signed` (count >= 2, `coordinator.ts:104-114`).
4. A broadcasts with the polyglot:
   `POST /api/v2/admin/treasury/drafts/<id>/broadcast`,
   body `{"overridePsbt": "BVBE_PSBT_V1:{victim}BVBE_PSBT_V1:{attacker}"}`.
   - `broadcastDraft` at `coordinator.ts:118-160` accepts the
     `overridePsbt` (zod schema at `broadcast/route.ts:28-30` lets
     it through unchanged — no multi-envelope guard).
   - `decodePsbt(psbt)` at L143 reads the **first** marker → victim
     output.
   - `validateIntendedOutputs(decoded, intended)` at L145 passes
     (victim matches stored intent).
   - `rpc("finalizepsbt", [psbt])` at L149 → mock's `finalizepsbt`
     (`bitcoin-mock/src/rpc/index.ts:118-127`) splits on
     `PSBT_MARKER` and canonicalizes to `segs[segs.length - 1]` →
     **attacker output**.
   - `rpc("sendrawtransaction", [hex])` at L150 admits the
     `RAWTX:[{attacker, 10_000_000_000}]` envelope via
     `chain.admitRawTx` (`bitcoin-mock/src/rpc/index.ts:61-86` +
     `state.ts:208-225`).
5. Drain confirmed at `GET /api/v2/public/treasury/hot-wallet`
   (`hot-wallet/route.ts`) — withdrawals aggregate sum increments
   without a matching deposit.

No defensive code anywhere in the broadcast path collapses the two
parsers to a single canonical view, and the broadcast route's zod
schema (`broadcast/route.ts:28-30`) imposes no multi-envelope check.
**The plant lands intact and is exploitable today** — Phase 8 (V-6 +
emergency-withdraw bypass of the 2-of-3 gate) and Phase 9 (git-history
JWT signing key leak) will lift it from "two real treasury insiders"
to "unauthenticated external attacker with forged JWT."

Spot-checks at the access boundary:
- `requireTreasury` at `kyc-tier.ts:68-73` accepts only
  `role === "admin"` or `role === "treasury"`. Phase 7's three
  treasury routes + bump route all call it before invoking lib
  functions. Reachable only by `treasury` or `admin` claims —
  matches the architect's insider-threat framing.
- `signDraft` does **not** enforce signer ≠ author. The unique
  `(draftId, signerUserId)` index enforces two distinct signers
  but allows author-as-signer-1. Architect noted this is realistic
  and not flagged — confirmed.

## Verification re-run

| Command | Result |
|---------|--------|
| `pnpm install --frozen-lockfile` | up to date, 0 mutations |
| `pnpm test` | **23 files / 90 tests passed**, 3.02s — matches commit message claim |
| `pnpm --filter @bvbe/shared exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/web exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/worker exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/db exec tsc --noEmit` | clean |
| `pnpm --filter @bvbe/web build` | succeeded; all 10 new routes appear in the dynamic `ƒ` build output (`/api/v2/me/withdrawals`, `[id]`, `[id]/cancel`, `/me/internal-transfer`, `/admin/treasury/drafts`, `[id]/sign`, `[id]/broadcast`, `/admin/withdrawals/[id]/bump`, `/public/treasury/hot-wallet`) plus three new ○-rendered pages `/withdraw`, `/transfer`, `/admin/treasury` |

No warnings worth flagging.

## Balance.amount invariant check

The architect-imposed `Balance.amount = available + locked` invariant
is preserved on every Phase 7 write site:

- `submit.ts:93-99` — `decrement: totalDebit` on both `available` and `amount`.
- `cancel.ts:39-45` — `increment: refund` on both.
- `internal-transfer.ts:67-91` — sender `decrement` both, recipient `increment` both (recipient via `upsert` whose `create` initialises both to `amount`).
- `rbf.ts:60-68` — `increment: refundBtc` on both.

No surface debits or credits one side only.

## Forward note for Phase 8

Phase 7 leaves the CHAIN A endpoint cleanly under
`/api/v2/admin/treasury/...` with the `requireTreasury` gate as the
only access primitive — exactly the surface Phase 8 needs to lift
to `/api/v1/internal/treasury/emergency-withdraw` and pair with V-6
(function-level access bypass). The `overridePsbt` parameter is
already exposed on the broadcast route, so the emergency-withdraw
path can re-use it without schema churn. The architect's deferred
items (V-1, V-6, V-11, V-12, V-17, V-18, V-34, OTC double-fill fix
via `$transaction`) are all untouched in Phase 7's diff — verified
by file listings — so Phase 8 starts from a clean slate. The
`bumpWithdrawalFee` location at `/api/v2/admin/withdrawals/[id]/bump`
is a candidate to relocate to `/api/v1/internal/...` in Phase 8 if
the architect wants the bump endpoint to gain V-6 reach too.

## Verdict and recommendation

**PASS.** Phase 7 ships a complete withdrawal pipeline, internal
transfer, RBF, and 2-of-3 multi-sig treasury coordinator with five
planted vulnerabilities allocated by the architect (V-26, V-28, V-30,
V-33, V-47) — all confirmed exploitable end-to-end, all realistically
placed without signposting, and all faithfully documented in
`VULNS.md`. The U-7.1 architect-disposed fix is correctly applied to
`cancel.ts` (`updateMany` predicated inside the transaction; no V-NNN
added). No prior `V-NNN` was accidentally weakened — file-level diffs
against the Phase 6 commit confirm zero modifications to V-1 / V-4 /
V-8..V-46 surfaces. The architect's surfaces-to-leave-clean list
(`/api/v1/internal/*`, lodash, `child_process`, raw SQL, nginx CL/TE,
SSRF, stored XSS, OTC accept) is fully respected. `pnpm test` is
**90/90 green**, `tsc --noEmit` is clean across every workspace
package, and `pnpm --filter @bvbe/web build` succeeds. CHAIN A's
insider-threat reach (treasury operator + V-33 polyglot) is
demonstrable today against the running app; the Phase-8/9 components
will lift it to an unauthenticated external chain. No blockers, no
majors, four minor nits not worth round-tripping. **Cleared for
commit.**

— L7 QA
