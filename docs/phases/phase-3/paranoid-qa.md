# Phase 3 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA.
> **Date:** 2026-05-30
> **Verdict:** PASS — clean for sign-off.

## Checklist

### 1. No real Bitcoin / mainnet exposure

- Phase 3 finally introduces real BTC code, but only against the
  in-memory mock chain state in `apps/bitcoin-mock/src/state.ts`.
  Chain is hardcoded `"regtest"`, address prefix is `bcrt1q`,
  pre-funded lab wallet is `bcrt1qlab...`. No mainnet RPC URLs, no
  real bitcoind container, no `bitcoinjs-lib` mainnet-network
  config.
- `grep -i 'mainnet|xpub|xprv'` against `apps/` returns one hit on
  the landing page's user-facing reassurance string ("Nothing here
  touches mainnet") — carry-forward, not a leak.
- The address validator (`packages/shared/src/btc-address.ts`)
  *accepts* mainnet HRPs in its data path — but the deposit
  generator only produces `bcrt1q...` regtest addresses; the
  mainnet-HRP acceptance is the V-24 plant for Phase 7 withdraw.
  No code path treats validated mainnet addresses as actionable in
  Phase 3.

### 2. No real PII

- No new seed data in Phase 3. Carry-forward 50 synthetic users
  from Phase 1 + Phase 2.
- New tables (`BitcoinAddress`, `Deposit`, `Balance`) are populated
  only at runtime by trainee actions.

### 3. No real secrets

- The mock-imds container's synthetic AWS placeholders carry
  forward from Phase 2 — still AWS's own published docs values.
- New `LAB_AFFORDANCES_ENABLED` env var defaults to `true` in
  this lab build (docs/changelog), behavior gated, no secret value.
- No new committed strings that match secret patterns
  (`grep -i 'api[_-]?key|secret[_-]?key|private[_-]?key|aws|AKIA[0-9A-Z]{16}'`
  returns only existing Phase-1/Phase-2 hits, none new).

### 4. No outbound calls to third parties from app code

- Web app's outbound `fetch` destinations:
  - `BITCOIN_MOCK_URL` (internal docker network, mock-bitcoind)
  - Phase 2 `/api/v2/me/kyc/import-url` user-controlled (V-40
    plant, intentional)
- Worker's outbound `fetch`:
  - `BITCOIN_MOCK_URL/watch/...` (internal)
- mock-bitcoind: no outbound network access (in-memory state only).
- No third-party CDN, telemetry, or analytics added.

### 5. Banner discipline

- New page `/account/deposit` renders inside the root layout →
  inherits DO NOT DEPLOY banner top + footer.
- Lab-affordance toolkit on the deposit page carries its own
  red "Dev / Lab only" badge in addition to the page banners.

### 6. Lab teardown destroys state

- New Postgres tables (`bitcoin_addresses`, `deposits`, `balances`)
  wiped by `docker compose down -v`.
- BullMQ `deposit-poll` queue lives in Redis (no persistence:
  `--save "" --appendonly no` from Phase 0) — wiped on Redis
  container teardown.
- mock-bitcoind chain state is in-memory (`apps/bitcoin-mock/src/state.ts`
  module-level `ChainState` instance) — wiped on container restart.
- The Phase-2 fix-up named-volume pattern for KYC uploads still in
  place; carry-forward.

### 7. VULNS.md ledger matches code

- 2 new V-NNN entries: V-24 (in `packages/shared/src/btc-address.ts`),
  V-42 (in `apps/worker/src/deposit-watcher.ts`).
- Adversarial QA confirmed both exploitable.
- Total planted: 14 (V-8, V-9, V-10, V-13, V-14, V-19, V-20, V-21,
  V-24, V-27, V-35, V-40, V-41, V-42). Master-plan budget was ~39;
  on track.

### 8. Surfaces-to-leave-clean — still clean

- `grep -E 'lodash|child_process|node-serialize|$queryRawUnsafe|proxy_cache_|new WebSocket\(|WebSocketServer|/api/v1/internal'`
  against `apps/` returns **zero hits**.
- nginx CL/TE-tolerant directives (active) — none.
- All carry-forward reservations preserved.

### 9. Phase 3 exit criteria

| # | Criterion                                                       | Status |
|---|-----------------------------------------------------------------|--------|
| 1 | All Phase 0–2 exit criteria still pass                          | ✅ unchanged |
| 2 | Tier-1+ user can generate a deposit address via the UI          | ✅ static (`/api/v2/me/deposit/address` returns or derives) |
| 3 | Lab `/test/send` adds a TX; worker picks it up; deposit appears | ✅ static (mock state + watcher + UI list wired) |
| 4 | After enough confirmations, `Balance.amount` increases          | ✅ static (`pollOnce` transaction credits balance) |
| 5 | RBF affordance demonstrably drops the TX                        | ✅ verified in `poc-scratch.mjs` (real `chain.rbfReplace`) |
| 6 | PoCs for V-24 and V-42 in adversarial-qa.md                     | ✅ |
| 7 | VULNS.md contains 2 new entries                                 | ✅ |
| 8 | Worker process stays healthy across down -v && up               | ✅ static (BullMQ queue rebuilt each boot; graceful SIGTERM handler) |
| 9 | Surfaces-to-leave-clean grep clean                              | ✅ |

### 10. Re-verifications executed

- `pnpm test` → **24/24 pass** (8 files; was 19/19 in 7 files;
  +5 from `btc-address.test.ts`)
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → succeeded
  end-to-end; all UI routes prerender; new `/account/deposit`
  registers; all 23 API routes registered (was 20 in Phase 2;
  +3 user-facing deposit endpoints).
- `pnpm tsx docs/phases/phase-3/poc-scratch.mjs` →
  V-24 (3 bypasses) + V-42 (state machine) all confirmed.

## Verdict

**PASS. Phase 3 is signed off.** Lab-safety constraints hold:
no real BTC, no mainnet exposure, no real PII, no real secrets,
no outbound third-party calls from app code. The mock-bitcoind
upgrade preserves the Phase-0 RPC contract (same `@bvbe/bitcoin-rpc-types`)
and adds in-memory regtest semantics with no persistence. The
Balance table lands cleanly for Phase-4 trading to consume.

CHAIN A (drain hot wallet) now has a usable mock-bitcoind to
exercise PSBT flows in Phase 7 — the bones of the chain ending
are in place.

— Paranoid QA
