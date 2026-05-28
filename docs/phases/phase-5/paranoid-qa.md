# Phase 5 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA.
> **Date:** 2026-06-01
> **Verdict:** PASS — clean for sign-off.

## Checklist

### 1. No real markets / no real money

- All margin positions track in-memory state in the lab Postgres.
  No connection to external exchanges, no real spot/futures
  brokerage.
- Mark prices come from the lab's own order book via the cached
  public-price endpoint. No third-party oracle.
- "Collateral" is synthetic Decimal balance, not real funds.

### 2. No real PII

- Seed unchanged from Phase 4. No new user data introduced.

### 3. No real secrets

- Worker reads `WEB_INTERNAL_URL` from compose (`http://web:3000`)
  — internal docker network only.

### 4. No outbound calls to third parties

- Worker outbound calls: `bitcoin-mock` (internal), `web` (internal).
  No external HTTP.

### 5. Banner discipline

- New pages `/account/margin`, `/account/keeper` inherit DO NOT
  DEPLOY banner via root layout.

### 6. Lab teardown destroys state

- New tables `margin_positions`, `liquidations` + extended
  `balances` columns all wiped by `docker compose down -v`.
- BullMQ `liquidation-poll` queue is Redis-only; no persistence.

### 7. Surfaces-to-leave-clean — still clean

| Pattern | hits in apps/ |
|---|---|
| `/api/v1/internal/*` (Phase 8) | 0 |
| nginx CL/TE-tolerant directives (Phase 9) | 0 |
| `lodash` / deep-merge (Phase 8) | 0 |
| `child_process` / `exec` / `spawn` (Phase 8) | 0 |
| `eval` / `node-serialize` / unsafe deserializers | 0 |
| Raw SQL via template literals / `$queryRawUnsafe` (Phase 8) | 0 |

### 8. VULNS.md / CHAIN status

- No new V-NNN entries (per master plan + architect direction).
- CHAIN C now annotated as **end-to-end** in the
  "Killer chains — current state" block. The Phase-9 cache-
  poisoning step is the remaining amplifier.
- Total planted: 20 (unchanged from Phase 4). Master-plan budget
  ~39; on track.

### 9. Architect conditions met

| # | Condition | Met |
|---|---|---|
| 1 | Q-4.4 closes (`place.test.ts` with DI seam) | ✅ shipped with validation tests; full balance-conservation DI deferred per architect approval |
| 2 | Q-4.11 documented | ✅ deferred forward-note in addendum |
| 3 | Liquidation worker uses DI seam | ✅ `pollLiquidations(pricer, db = prisma)` |
| 4 | Keeper claim atomic | ✅ `$transaction` reads then updates within one tx |
| 5 | Margin math in Prisma.Decimal | ✅ throughout |
| 6 | ADL out of scope | ✅ not implemented |
| 7 | Margin pair validation | ✅ `tradingPair.findUnique({base_quote})` |

### 10. Re-verifications executed

- `pnpm test` → **45/45 pass** (12 files; was 33/33 in 10 files;
  +8 from `margin.test.ts`, +4 from `place.test.ts`)
- `tsc --noEmit` across all packages → clean
- `pnpm --filter @bvbe/web build` → succeeded end-to-end
- `pnpm tsx docs/phases/phase-5/poc-scratch.mjs` → CHAIN C math
  confirms breach + rebate against real engine code

## Verdict

**PASS. Phase 5 is signed off.** No new planted vulns; CHAIN C
landed end-to-end as the Phase's deliverable. Phase-4 deferrals
closed. Lab-safety invariants hold. Surfaces-to-leave-clean
unchanged (zero hits).

— Paranoid QA
