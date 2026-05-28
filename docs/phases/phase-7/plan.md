# Phase 7 — Withdrawal & multi-sig treasury coordinator

> Input to Gate 1. Phase 7 lands the user-facing withdrawal flow,
> a daily-limit ledger, internal user-to-user transfers, a BullMQ
> withdrawal worker that submits transactions to the mock node,
> and a treasury coordinator that moves funds **cold → hot** via a
> 2-of-3 multi-sig PSBT pipeline. **CHAIN A** (drain the hot wallet)
> completes here: git-history secret leak (placed in Phase 9
> polish) → forged admin JWT → emergency withdraw → PSBT signing
> flaw routes treasury output to attacker.
>
> Phase 7 plants five vulns from the master catalog:
>
> - **V-26** Withdrawal limit reset off-by-one (`>=` boundary).
> - **V-28** Classic withdrawal race condition (balance check ≠
>   debit atomic).
> - **V-30** Internal user-to-user transfer bypasses limits + KYC.
> - **V-33** PSBT signature flaw in the treasury coordinator
>   (Bitfinex-flavor whitelist pre-deserialization).
> - **V-47** Fee/RBF refund exploit — bumped-fee refund credits
>   the difference between the original and replacement fee back
>   to the user's available balance, but the replacement
>   transaction's lower-priority drop is not caught.
>
> Plus **carryover** from Phase 6 L7 review:
>
> - OTC accept double-fill race (the L7 carryover that was
>   "candidate for Phase 7"). The architect must decide whether to
>   plant it as a new V-NNN or close it as an unintended bug.

## Goal

Real exchanges live or die on the withdrawal pipeline. The flow:
user submits a request → tier-gated daily limit check → balance
debit → BullMQ worker picks it up → withdrawal worker drafts a
transaction against the hot wallet UTXO set → broadcasts to the
mock node → confirmations stream back → status moves to
`confirmed`. Separately, treasury moves cold→hot via PSBT: a
treasury operator drafts a PSBT consolidating cold UTXOs, two
of three treasury signers approve, and the coordinator
broadcasts. The PSBT validation surface is where V-33 lives.

This is the **last major user-facing surface** before admin
panel + chain wrap-up. After Phase 7, CHAIN A is exploitable end
to end (modulo the git-history leak landing in Phase 9). The
master plan's CHAIN A is:

1. Git history leak → JWT signing key (Phase 9 polish)
2. Forge admin JWT → access `/api/v1/internal/treasury/emergency-withdraw` (Phase 8 + 7)
3. **V-33** PSBT signing flaw → sign withdrawal to attacker address (Phase 7 plant)
4. Final move: drain hot-wallet UTXO pool (Phase 7 implementation)

## Deliverables

### Schema additions (additive only)

```prisma
enum WithdrawalStatus {
  pending
  approved      // limit + balance checks passed; queued for worker
  broadcasting  // worker has drafted the TX; awaiting broadcast
  broadcast     // TX submitted to mock node
  confirming    // seen 1+ confirmations
  confirmed     // settled (configurable threshold, lab uses 1)
  rejected      // failed validation
  bumped        // fee-bumped via RBF — original is dropped
  failed        // unrecoverable
}

model Withdrawal {
  id            String           @id @default(cuid())
  userId        String
  asset         String
  amount        Decimal          @db.Decimal(38, 8)   // user-requested amount
  fee           Decimal          @db.Decimal(38, 8)   // network fee debited
  destAddress   String
  status        WithdrawalStatus @default(pending)
  txid          String?
  replacedByTxid String?         // set on RBF bump; points to new TX
  requestedAt   DateTime         @default(now())
  approvedAt    DateTime?
  broadcastAt   DateTime?
  confirmedAt   DateTime?
  failedReason  String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([txid])
  @@map("withdrawals")
}

model WithdrawalLimitLedger {
  // One row per user per UTC day. Maintains running total of confirmed
  // + pending withdrawals so the daily limit check is fast.
  id            String   @id @default(cuid())
  userId        String
  utcDate       DateTime @db.Date           // truncated to day
  asset         String                       // limits are per-asset, USD-equivalent for fiat-pegged
  totalCents    BigInt   @default(0)         // sum of equivalent value debited that day (cents)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, utcDate, asset])
  @@index([userId, utcDate])
  @@map("withdrawal_limit_ledger")
}

model InternalTransfer {
  id            String   @id @default(cuid())
  fromUserId    String
  toUserId      String
  asset         String
  amount        Decimal  @db.Decimal(38, 8)
  memo          String?
  createdAt     DateTime @default(now())

  fromUser User @relation("internal_transfer_from", fields: [fromUserId], references: [id], onDelete: Cascade)
  toUser   User @relation("internal_transfer_to",   fields: [toUserId],   references: [id], onDelete: Cascade)

  @@index([fromUserId])
  @@index([toUserId])
  @@map("internal_transfers")
}

enum TreasuryDraftStatus {
  drafted
  partial      // 1 of 2 signatures collected
  signed       // 2 of 2; ready to broadcast
  broadcast
  failed
}

model TreasuryDraft {
  id              String              @id @default(cuid())
  authorUserId    String              // treasury operator who created the draft
  psbtBase64      String              // current PSBT (mutates as sigs are added)
  intentNote      String?
  intendedOutputs Json                // canonical [{address, amountSat}] — validated against PSBT
  status          TreasuryDraftStatus @default(drafted)
  createdAt       DateTime            @default(now())
  broadcastTxid   String?
  broadcastAt     DateTime?

  author    User              @relation("treasury_draft_author", fields: [authorUserId], references: [id], onDelete: Restrict)
  signatures TreasurySignature[]

  @@index([status])
  @@map("treasury_drafts")
}

model TreasurySignature {
  id         String   @id @default(cuid())
  draftId    String
  signerUserId String
  signedAt   DateTime @default(now())

  draft  TreasuryDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  signer User          @relation("treasury_signature_signer", fields: [signerUserId], references: [id], onDelete: Restrict)

  @@unique([draftId, signerUserId])
  @@map("treasury_signatures")
}
```

User gets four new inverse relations (withdrawals, ledger,
internal-from, internal-to, treasury-author, treasury-signer).
No new User columns.

Migration `20260620000000_phase_7_withdrawals_treasury` — additive
only.

### Mock node extensions (apps/bitcoin-mock)

The current mock is a stub for PSBT methods. Phase 7 extends:

- `sendrawtransaction(rawHex)` — admits the hex, adds it to
  mempool, debits hot-wallet UTXOs the parser identifies as inputs.
- `decodepsbt(psbtBase64)` — returns a structured view: inputs (txid,
  vout, address, amountSat), outputs (address, amountSat), fee. The
  mock implements a lightweight PSBT parser using a simplified base64
  envelope: `BVBE_PSBT_V1:<json>` where the JSON is the canonical
  structure. **Note**: this is NOT real BIP-174 — the lab is using a
  caricature so trainees can hand-craft PSBTs. The shape is realistic
  enough for the V-33 plant.
- `walletprocesspsbt(psbtBase64)` — returns a copy of the input with
  `complete=true` and a stub `hex` field. (Real `bitcoind`
  signs-with-wallet here; the lab simulates.)
- `finalizepsbt(psbtBase64)` — returns the extracted `hex`.
- `sendmany(addressToAmount, feeSat)` — the worker uses this for
  user withdrawals (single-input-single-output style); for treasury,
  the coordinator uses raw PSBT path.
- `bumpfee(txid, newFeeSat)` — RBF: marks original as `dropped`,
  spawns a new TX in mempool with the new fee. Returns new txid.

### Withdrawal lib + routes

- `apps/web/lib/withdrawal/limit.ts` — `currentDayUtc(now: Date): Date`
  truncates to UTC midnight; `addToLedger({userId, asset, amountCents,
  utcDate})` upserts the row. `checkAndDebitLimit(...)` reads the
  current day's row, **the V-26 plant lives here** (the boundary
  check uses `<=` somewhere that should be `<`).
- `apps/web/lib/withdrawal/submit.ts` — `submitWithdrawal({userId, asset,
  amount, destAddress})`. Validates address (`isValidBtcAddress`),
  validates amount > 0, validates `requireKnownAsset`, calls
  `requireTier(claims, 1)`, calls `checkAndDebitLimit`, debits balance,
  creates `Withdrawal` row in `pending` status. **The V-28 plant
  lives here**: the balance check and the debit are not within a
  Prisma `$transaction`. The check reads `balance.available`, the
  debit decrements separately. Single-packet race wins.
- `apps/web/lib/withdrawal/internal-transfer.ts` —
  `internalTransfer({fromUserId, toUserId, asset, amount, memo})`.
  **The V-30 plant**: this lib does NOT call `checkAndDebitLimit`
  and does NOT check `requireTier`. It debits the sender, credits
  the recipient, writes an `InternalTransfer` row.
- Routes:
  - `POST /api/v2/me/withdrawals` (Tier-1+)
  - `GET /api/v2/me/withdrawals` (list own)
  - `GET /api/v2/me/withdrawals/[id]` (detail)
  - `POST /api/v2/me/withdrawals/[id]/cancel` (only if `pending`/`approved`; refund debit)
  - `POST /api/v2/me/internal-transfer` (Tier-1+) — V-30 plant in lib

### Withdrawal worker

`apps/worker/src/withdrawal-processor.ts`:
- BullMQ queue `withdrawal-process`.
- Reads `pending` withdrawals, calls `mock.sendmany(...)`,
  records `txid`, advances to `broadcast`.
- Confirmations watcher (separate sub-job in the same worker
  module): polls `mock.gettransaction(txid)` for confirmations,
  advances to `confirming` then `confirmed`.
- **V-47 plant** in a separate `rbf-bump` sub-job: when an admin
  triggers RBF via `POST /api/v1/internal/withdrawals/[id]/bump`
  (admin path — but the endpoint lives in `/api/v2/admin/...`
  for now; Phase 8 architect will relocate), the bump computes
  `feeDelta = oldFee - newFee` and credits the user's `available`
  balance with `feeDelta` (positive when newFee < oldFee). The
  V-47 flaw: the credit happens *before* the replacement TX is
  confirmed. If the replacement is dropped (mempool drop, or a
  miner doesn't include it), the user keeps both the original
  TX's settlement AND the refund credit.

### Treasury coordinator lib + routes

`apps/web/lib/treasury/coordinator.ts`:
- `createDraft({authorUserId, intendedOutputs, intentNote})` — builds
  a PSBT from current cold-wallet UTXOs (mock returns a fake "cold"
  UTXO set), records `intendedOutputs` canonically, stores PSBT.
- `signDraft({draftId, signerUserId})` — appends a signature row;
  on the second valid signer, advances status to `signed`.
- `broadcastDraft({draftId, broadcasterUserId})` — calls
  `mock.finalizepsbt` then `mock.sendrawtransaction`; advances to
  `broadcast`. **The V-33 plant lives here**: the broadcast step
  validates `intendedOutputs` against the decoded PSBT *before*
  re-deserializing the PSBT one final time. An attacker who has
  collected two signatures on a draft with output `[A:1]` can
  produce a tampered PSBT base64 whose JSON envelope has output
  `[attackerAddr:1]` but whose pre-validation copy still parses
  to `[A:1]`. (The realistic root cause: the validation function
  calls a cached `decodePsbtCached(base64)` while the broadcast
  step calls a fresh `decodePsbt(base64)` — different parsers
  side-by-side.)
- `apps/web/app/api/v2/admin/treasury/drafts/route.ts` — POST to
  create, GET to list.
- `apps/web/app/api/v2/admin/treasury/drafts/[id]/sign/route.ts`
- `apps/web/app/api/v2/admin/treasury/drafts/[id]/broadcast/route.ts`
- All gated on `role === "treasury"` (or admin). **The Phase 8
  architect's "treasury access via spoofable header" plant is
  reserved** — Phase 7 uses the proper JWT-claim path.

### Public hot-wallet view

`GET /api/v2/public/treasury/hot-wallet` — returns cumulative
deposit/withdrawal/balance summary. Static-ish. **NOT** linked
from any user-facing page; admin panel exposes it (Phase 8). This
view exists so the CHAIN A "drain confirmation" step has a place
to check. Cache key includes `?asset=...` only — no host-header
flaw here.

### Tests

- `packages/shared/src/btc-tx.test.ts` — small helpers added for
  fake-PSBT envelope parsing.
- `apps/web/lib/withdrawal/limit.test.ts` — happy-path daily-limit
  threshold; rejects when over; **does NOT pin V-26 boundary**.
- `apps/web/lib/withdrawal/submit.test.ts` — happy-path
  submit/cancel; **does NOT pin V-28 race**.
- `apps/web/lib/treasury/coordinator.test.ts` — happy-path 2-of-3
  sign + broadcast; does NOT pin V-33.
- `apps/worker/src/withdrawal-processor.test.ts` — DI seam, 3
  scenarios: pending→broadcast→confirmed advance, idempotency,
  rejection on insufficient hot-wallet UTXOs.

### UI surfaces

- `/withdraw` — withdrawal form, history table (Tier-1+).
- `/transfer` — internal transfer form (Tier-1+; reachable via
  `/withdraw` tab toggle).
- `/admin/treasury` — admin-only treasury draft list, sign/broadcast
  UI. **NOT** linked from user nav.

## Open questions for the architect

1. **CHAIN A "emergency-withdraw" admin endpoint.** Master plan
   places it under `/api/v1/internal/treasury/emergency-withdraw`.
   That path family is reserved for Phase 8. Phase 7 builds the
   regular treasury coordinator at `/api/v2/admin/treasury/...`;
   the emergency endpoint is Phase 8. Architect to confirm.
2. **RBF bump endpoint owner.** RBF bump is a treasury-operator
   action. Plan currently places it at `/api/v2/admin/withdrawals/[id]/bump`.
   Architect to confirm we don't sprinkle "admin"-flavored endpoints
   ahead of Phase 8's admin panel.
3. **OTC double-fill carryover.** Phase 6 L7 review flagged a
   double-fill race on OTC accept as a Phase 7 candidate. Architect
   should decide: (a) plant it as new V-NNN in Phase 7, (b) plant
   it in Phase 8 as an admin-side replay surface, (c) close as
   unintended bug. Plan defaults to (a) but acknowledges this
   should be the architect's call.
4. **PSBT "envelope" caricature.** Plan uses
   `BVBE_PSBT_V1:<json>` as the wire format. Real PSBTs are
   BIP-174 binary. A trainee who knows BIP-174 will recognize this
   as a caricature, but the lab is upfront ("simulated"). Architect
   to confirm this is acceptable.
5. **`Withdrawal.amount` semantics.** Plan: `amount` is the user-
   requested withdrawal amount NOT including the network `fee`.
   Total debited = `amount + fee`. This matches Binance/Coinbase
   UX. Architect to confirm.
6. **Confirmation threshold.** Plan: 1 confirmation in the lab
   advances to `confirmed`. Real exchanges require 3-6.
7. **V-26 boundary direction.** Plan: the off-by-one is the
   `>=` boundary at the *limit* (i.e., a user with `totalCents ==
   limitCents` can still withdraw `1` cent because `<=` was used
   instead of `<` somewhere). Other direction: the *day reset*
   uses `>=` instead of `>` so a single user at the second of UTC
   midnight can double-withdraw. Architect to pick. Plan
   tentatively picks the day-reset framing (more interesting attack).
7b. **V-26 single flaw, not both.** Same discipline as V-44 in
    Phase 6 — one flaw, one V-NNN.

## Exit criteria

1. `docker-compose down -v && docker-compose up` brings up green;
   `/withdraw` and `/transfer` reachable for any Tier-1+ user.
2. A Tier-1 user can request a 0.001 BTC withdrawal to a fake
   address and see it cycle pending→broadcasting→broadcast→
   confirming→confirmed after the mock node mines one block.
3. A user can submit an internal transfer to another user; the
   recipient sees the credit immediately.
4. An admin (or treasury role) can create a treasury draft,
   collect two signatures, and broadcast — the broadcast txid
   shows up in mempool then confirms.
5. `pnpm test` adds ~10 new tests; total ≥ 84.
6. V-26, V-28, V-30, V-33, V-47 each have a working PoC in
   `docs/phases/phase-7/adversarial-qa.md`.

## Surfaces explicitly left clean

- `/api/v1/internal/*` — Phase 8.
- nginx CL/TE-tolerant block — Phase 9.
- `lodash` / deep-merge gadgets — Phase 8.
- `child_process` / `exec` — Phase 8 (PDF export).
- Raw SQL via template literals — Phase 8.
- Admin panel UI proper (search, balance adjust, freeze) — Phase 8.
- Support tickets, mXSS, stored XSS in display name — Phase 8.
- KYC SSRF allowlist — already planted Phase 2 / CHAIN D.

No vuln plant should leak into these surfaces from Phase 7's
withdrawal/treasury additions.
