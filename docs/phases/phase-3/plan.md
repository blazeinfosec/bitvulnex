# Phase 3 — Deposits & address management

> Input to Gate 1. Phase 3 turns the Phase-0 mock-bitcoind stubs
> into real regtest-shaped semantics and plants two vulns: V-24
> (address validation bypass, latent until Phase 7 withdraw) and
> V-42 (zero-conf deposit credit for tier-3 users → RBF double-spend).

## Goal

Stand up the full deposit lifecycle: derive a BTC deposit address
per user, watch the chain for incoming TXs, credit user balances
after a configurable confirmation threshold, expose deposit history
in the UI. Also: introduce a minimal `Balance` table that Phase 4+
trading consumes.

## Deliverables

### Schema

- `BitcoinAddress` — 1:N with User. `id`, `userId`, `address`,
  `derivationIndex` (int), `asset` ("BTC" only for now), `createdAt`.
- `Deposit` — N:1 with User. `id`, `userId`, `asset`, `address`,
  `txid`, `vout`, `amount` (Decimal(38,8)), `confirmations`,
  `status` (enum `seen` | `confirming` | `credited` | `dropped`),
  `seenAt`, `creditedAt`.
- `Balance` — unique on (userId, asset). `id`, `userId`, `asset`,
  `amount` (Decimal(38,8)), `updatedAt`. Phase 4 will extend this
  with `locked` / `available` columns when trading lands.
- Migration `20260530000000_phase_3_deposits`.

### `@bvbe/shared/btc-address.ts` (V-24 site)

Single source of truth for address validation. Used by:
- Phase 3: deposit address display (just sanity-checks our own
  generated addresses).
- Phase 7: withdrawal validation (where V-24 fires).

The validator is **deliberately permissive** about HRP / format:

```ts
export function isValidBtcAddress(addr: string): boolean {
  const a = addr.trim();
  // Accept legacy P2PKH (mainnet 1.., regtest m../n..)
  // Accept P2SH (mainnet 3.., regtest 2..)
  // Accept bech32 native segwit (mainnet bc1.., regtest bcrt1.., testnet tb1..)
  // Accept bech32m taproot
  // Mobile clients in 2022-2024 occasionally trimmed Unicode whitespace
  // or sent zero-width separators in QR-pasted addresses; we strip
  // common separators before validating.
  // ...
}
```

**V-24 bypasses present:**
1. **Testnet HRP accepted as "withdrawal target"**: `tb1...` validates
   as true. On regtest, a testnet bech32 decodes; funds sent to a
   testnet address from a regtest wallet land at... a regtest address
   anyone with the corresponding testnet private key controls. (For
   the lab: the witness-program bytes decode the same; the funds
   credit to the anyone-knows-it pubkey.)
2. **Zero-width strip**: `​`, `‌`, `‍` removed before
   validate. Attacker submits a withdrawal to
   `bc1...victim_address​<attacker_suffix>` — the strip turns it
   into a valid address that's not the victim's.
3. **OP_RETURN-shaped output**: a malformed bech32 that decodes to a
   zero-value output / unspendable script passes. Used to burn funds
   (DoS-flavor).

Phase 3 only calls `isValidBtcAddress` to sanity-check
*server-generated* addresses (never user-provided), so V-24 is
latent through Phase 6.

### Mock bitcoind upgrade (`apps/bitcoin-mock/`)

Replace the Phase-0 stubs with real regtest-shaped semantics:

- In-memory UTXO set
- Per-address watch list (so the worker can poll new TXs to deposit
  addresses)
- Mempool with **RBF** support (a TX flagged `replaceable` can be
  replaced by another TX consuming the same input with higher fee)
- Block progression (`generatetoaddress N` mints N blocks; TXs in
  mempool are included; confirmations counter advances)
- `sendtoaddress` (from a pre-funded "lab wallet" that holds
  ~10,000 BTC for trainee testing)
- `gettransaction` returns `confirmations` based on current block
  height vs inclusion height (or `0` if still in mempool, `-1` if
  dropped by RBF)
- Test affordances:
  - `POST /test/send` — sends BTC from lab wallet to any address
  - `POST /test/mine` — mines N blocks
  - `POST /test/rbf` — replaces a mempool TX with one that sends to
    a different address (the V-42 attack primitive)

The mock is still internal-only (no nginx route, no host port).
Trainees reach the test affordances via a `/api/v2/dev/btc/*` proxy
on the web app — these are clearly labelled "DEV/LAB ONLY" and gated
behind a `LAB_AFFORDANCES_ENABLED=true` env var.

### Deposit worker (`apps/worker/`)

The Phase-0 BullMQ worker finally gets a queue. New `deposit-poll`
queue with a 5-second repeating job:

1. List all `BitcoinAddress` rows.
2. For each, ask the mock bitcoind for any TXs paying that address
   (mempool + recent blocks).
3. For each new (txid, vout) not already in `Deposit`:
   - INSERT a `Deposit` row with `status = "seen"`, current
     confirmations.
4. For each existing `Deposit` row with `status` in (`seen`,
   `confirming`):
   - Re-fetch confirmations.
   - If RBF-dropped (mock returns confirmations = -1) → status =
     `dropped`.
   - If confirmations >= threshold for user's tier → status =
     `credited`, increment `Balance.amount` in same transaction.

**V-42 site** — the confirmation threshold:

```ts
function minConfirmationsForTier(tier: KycTier): number {
  // Premium tier-3 users get faster credit so they don't have to
  // wait through volatile windows. They've passed enhanced KYC,
  // we're comfortable with the small RBF risk.
  if (tier === 3) return 0;
  if (tier === 2) return 1;
  return 3;
}
```

A tier-3 user can:
1. Trigger `POST /api/v2/dev/btc/send` (lab affordance, or via the
   mock bitcoind directly) — sends a TX to their deposit address.
2. Worker sees the mempool TX, `confirmations = 0`, threshold for
   tier 3 is 0 → credits `Balance.amount += amount`.
3. Trigger `POST /api/v2/dev/btc/rbf` — RBF-replaces that TX with
   one that sends to a different address (attacker's pocket).
4. Worker re-polls, sees the original txid is dropped → marks
   `Deposit.status = "dropped"` but **does not** reverse the
   credit. (The "fix it later" reasoning is the realistic root
   cause; in production the team would write a reconciliation
   job. The lab doesn't.)
5. Balance is inflated; coins never arrived. Repeatable.

### API endpoints (v2)

User-facing under `/api/v2/me/deposit/*`:

- `GET /api/v2/me/deposit/address?asset=BTC` — returns existing or
  derives a new deposit address. Tier-0 (unverified) returns 403 ("must complete KYC to deposit").
- `GET /api/v2/me/deposits` — list deposits w/ status + confirmations.
- `GET /api/v2/me/balance` — current balance per asset.

Dev/lab affordances under `/api/v2/dev/btc/*` (gated by env var):

- `POST /api/v2/dev/btc/send` — `{ address, amount }`, sends from lab wallet
- `POST /api/v2/dev/btc/mine` — `{ blocks }`, advances chain
- `POST /api/v2/dev/btc/rbf` — `{ txid, newAddress }`, RBF-replaces a mempool TX

### UI

- `/account/deposit` — choose asset (only BTC in Phase 3), show
  deposit address with QR + copy button, list recent deposits with
  confirmations, "Generate new address" button.
- `/account` updated to link to `/account/deposit`.

If `LAB_AFFORDANCES_ENABLED=true`, the deposit page shows a "Lab
test toolkit" card with buttons for the 3 dev endpoints. The card
carries a DEV/LAB ONLY badge.

### Tests

- `packages/shared/src/btc-address.test.ts` — happy-path tests for
  valid mainnet/regtest addresses (V-24 untested per the
  no-test-pinning-vuln-behavior rule).
- `apps/worker/src/deposit-watcher.test.ts` — round-trip on the
  `seen → confirming → credited` state machine using an in-memory
  mock.

### CHANGELOG (diegetic)

"2026-05-30 — Phase 3: deposits. BTC deposit addresses, balance
tracking, automatic credit after confirmations. Premium tier-3
users receive instant credit (0-confirmation) to avoid waiting
through chain congestion."

Hints V-42 in the "instant credit" line; no hint for V-24 (latent
until Phase 7 anyway).

## Vuln allocation (planted in this phase)

| Vuln  | Category    | Difficulty | Location                                          |
|-------|-------------|------------|---------------------------------------------------|
| V-24  | Crypto/BTC  | medium     | `packages/shared/src/btc-address.ts` (latent)     |
| V-42  | Crypto/BTC  | medium     | `apps/worker/src/deposit-watcher.ts` (`minConfirmationsForTier`) + tier-3 surface |

## Exit criteria

1. All Phase 0–2 exit criteria still pass
2. Tier-1+ user can generate a deposit address via the UI
3. Lab affordances: `POST /api/v2/dev/btc/send` adds a TX paying
   that address; worker picks it up; deposit appears in user UI
4. After enough confirmations (or 0 for tier-3), `Balance.amount`
   increases
5. RBF affordance demonstrably drops the TX (mock returns
   `confirmations = -1`)
6. PoCs for V-24 (latent — read the validator code) and V-42 (end-
   to-end zero-conf-credit-then-RBF) documented in adversarial-qa.md
7. VULNS.md contains 2 new entries
8. Worker process stays healthy across `down -v && up`
9. Surfaces-to-leave-clean grep still clean

## Open questions for the architect

1. **Should the Balance table land in Phase 3 or wait for Phase 4?**
   Plan says Phase 3 with a minimal shape (no locked/available
   split). Confirm — V-42 needs *something* to credit.
2. **Should the dev/btc affordances be gated only by env var, or
   also by tier-3/admin role?** Env var only matches "lab mode";
   role gating is a half-fix that constrains exploit setup.
3. **Where does `minConfirmationsForTier` live — in the worker, in
   shared, or in web?** Plan says worker, called by the credit
   logic. Could also be in `@bvbe/shared` for cross-process reuse.
4. **Should we ship a small "address from string" parser in the
   web UI to display BTC addresses with monospace formatting and a
   warning on zero-width chars?** No — that would be a forward
   "fix" for V-24. Phase 3 does the minimum (raw display).
