# Phase 4 — Paranoid QA (Gate 4)

> **Reviewer role:** Blue-team / lab-safety QA.
> **Date:** 2026-05-31
> **Verdict:** PASS — clean for sign-off.

## Checklist

### 1. No real markets / no mainnet exposure

- All trades are mock-internal. No outbound price-feed fetches from
  any real exchange API. No mainnet RPC URLs.
- Trading pairs are seeded (`BTC/USDT`, `ETH/USDT`) but the only
  way to obtain a balance is via the Phase-3 mock-bitcoind deposit
  flow. No fiat on-ramp.
- The matching engine is in-process; no third-party market data
  vendor.

### 2. No real PII

- No new seed data; carry-forward from Phase 1.

### 3. No real secrets

- ws-gateway uses the same `JWT_SECRET` as the web app. Required to
  be ≥32 chars and ships with `${VAR:?}` form in docker-compose —
  fails fast if unset.

### 4. No outbound calls to third parties from app code

- Web app: outbound to bitcoin-mock (internal) and mock-imds via
  the V-40 surface (intentional, gated by user input). Phase-4
  additions: outbound Redis publish to redis (internal).
- ws-gateway: Redis subscribe (internal). No outbound HTTP.
- Worker: Redis (internal), bitcoin-mock (internal).
- No external HTTP destinations.

### 5. Banner discipline

- New page `/account/trading/[pair]` lives under root layout →
  inherits DO NOT DEPLOY banner top + footer.

### 6. Lab teardown destroys state

- New tables (`trading_pairs`, `orders`, `trades`) + extended
  `balances` columns wiped by `docker compose down -v`.
- BullMQ queue state in Redis is wiped (no persistence — Phase 0
  `--save "" --appendonly no`).
- nginx cache lives in `/tmp/nginx-public-cache` inside the nginx
  container; wiped when the container is recreated. No host bind
  mount.

### 7. Surfaces-to-leave-clean — updated for Phase 4

The architect's Gate-1 review explicitly retired "WebSocket
server" from the reserved list (Phase 4 ships the first WS). The
remaining hard-rule reservations:

- `/api/v1/internal/*` (Phase 8) — **0 hits** in `apps/`
- nginx CL/TE-tolerant directives **active** (Phase 9) — **0 hits**
  (the new `proxy_cache_path` is NOT a CL/TE directive)
- `lodash` / deep-merge (Phase 8) — **0 hits**
- `child_process` / `exec` / `spawn` (Phase 8) — **0 hits**
- `eval` / `node-serialize` / unsafe deserializers (later) — **0 hits**
- Raw SQL via template literals / `$queryRawUnsafe` (Phase 8) — **0 hits**

The Phase-4 `proxy_cache_path` in `nginx.conf` is the planned
infrastructure for CHAIN C; the cache-poisoning *attack* lands in
Phase 9 when CL/TE-tolerance activates. The plan and the
architect review both document this.

### 8. VULNS.md matches code

- 6 new entries: V-4, V-22, V-23, V-25, V-32, V-43. Each maps to
  the code location stated.
- Adversarial QA confirmed all 6 exploitable.
- Total planted: 20 (V-4, V-8, V-9, V-10, V-13, V-14, V-19, V-20,
  V-21, V-22, V-23, V-24, V-25, V-27, V-32, V-35, V-40, V-41, V-42,
  V-43). Master plan budget ~39; on track.
- V-27 (Phase 2 plant) is wired into the place-order handler with a
  numeric tier check (no fire) and a string tier check for stop-
  order types (no exploit direction in Phase 4). Architect-approved
  to keep V-27 latent through Phase 4.

### 9. CHAIN status update

- **CHAIN C (mass user takeover)** now has its first concrete
  components: V-25 (self-trade → oracle manipulation) + nginx
  `proxy_cache` infrastructure ready for Phase 9 poisoning.
  Phase 5 will land the margin liquidation engine that consumes
  the manipulated oracle.

### 10. Re-verifications executed

- `pnpm test` → **33/33 pass** (10 files; was 27/27 in 9 files;
  +6 from `match.test.ts`)
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/ws-gateway exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → succeeded
  end-to-end; trading UI route prerendered; 26 API routes
  registered (was 23 in Phase 3; +3 from orders/price/book).
- `pnpm tsx docs/phases/phase-4/poc-scratch.mjs` → V-25 fires
  end-to-end against real engine code; V-4/22/23/32/43 confirmed
  by code shape.

## Verdict

**PASS. Phase 4 is signed off.** Lab-safety constraints hold;
six planted vulns are exploitable and tracked; CHAIN C lands
its first wedge. Phase-3 housekeeping deferrals (Q-3.7
upsertJobScheduler, Q-3.8 IORedis instance reuse, Q-3.11
Prisma.Decimal discipline) all closed in the same commit. The
WS gateway is now the project's first WebSocket — and was
deliberately not validated for origin (V-23).

— Paranoid QA
