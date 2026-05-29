# Phase 11 slice 2.x — follow-up backlog

> **Why this file exists.** Slice 2 (commit `4a7ecb8`) shipped all 44
> flags claimable, but with two acknowledged trade-offs the L7 review
> (`slice-2-l7-review.md`) flagged as Majors-by-deferral, not blockers:
>
> 1. 12 V-NNNs route through Pattern B claim instead of Pattern A
>    inline emission. The architect's plan called for Pattern A across
>    the engine/worker/shared-lib detection set.
> 2. 10 Pattern B validators are oracle-prone — a trainee reading
>    `claim.ts` can mint passing proofs without doing the work.
>
> This document tracks both backlogs so slice 3 doesn't ship without
> the architect at least ack'ing the deferrals.

## Backlog A — Pattern A wiring still owed

For each item: target plant file, why slice 2 deferred, what the
detector should look like in slice 2.x.

| V-NNN | Plant file | Defer reason | Slice 2.x detector sketch |
|-------|-----------|--------------|---------------------------|
| V-6   | `apps/web/middleware.ts` (`x-bvbe-internal-trace` bypass) | Middleware operates pre-route — emit requires a downstream marker that EVERY `/api/v1/internal/*` handler reads | Set `x-bvbe-ctf-fired: V-6` on the proxied request via `NextResponse.next({ request: { headers } })`; helper `emitFiredHeaderFlag()` in the few protected handlers reads it. |
| V-8   | `packages/shared/src/jwt-v1.ts` (`alg==="none"` branch) | Shared module; emit can't reach the response | `verifyAccessTokenV1` returns `{ claims, alg }`; `userFromAuthorization` ships `alg` back to handler; route handler emits when `alg === "none"`. |
| V-19  | `packages/shared/src/jwt-v1.ts` (HS/RS shared `loadKidKey`) | Same as V-8 | Same plumbing — tag verified alg in claims envelope. |
| V-21  | `apps/web/app/api/v2/auth/refresh/route.ts` | Detection requires DB tracking of "this refresh token was already used to mint a new pair" — schema currently has no `usedAt` (that's the plant) | Add an in-memory sidecar map keyed on `tokenHash`; first refresh records the hash; second refresh emits and clears. Bounded TTL. |
| V-23  | `apps/ws-gateway/src/server.ts` | WS message channel — different response shape | Emit as `{kind:"ctf", flag}` on the first message after a subscribe whose upgrade had no `Origin` header or a non-allowlist `Origin`. |
| V-26  | `apps/web/lib/withdrawal/limit.ts` | Detection = "two same-asset withdrawals on different UTC days within 60s wall-clock" | Add a side query in `checkAndDebitLimit`: any prior withdrawal in last 60s on a different `utcDate` for the same user+asset → emit on the submit response. |
| V-32  | `apps/web/app/api/v2/me/orders/[id]/route.ts` DELETE | Double-refund detection requires reading the locked balance pre + post — invasive | Wrap the cancel transaction's refund step; if locked went negative or the refund > previously-locked, emit. |
| V-42  | `apps/worker/src/deposit-watcher.ts` | Worker, not request-handler — no response to emit through | Emit on the next deposit list response when a deposit with `confirmations >= minConfs(tier)` but `status === "dropped"` (the no-debit anomaly) is seen. |
| V-43  | `apps/web/lib/engine/fees.ts` | Requires post-fact volume comparison | Side-by-side compute the "fair" fee tier; if `feeTierForUser` returns a tier inflated by the maker-side cancellation filter miss, emit on the next `placeOrder` response. |
| V-44  | `apps/worker/src/yield-accrual.ts` | Worker side | Same shape as V-42 — flag on next `lending/positions` response when a position opened mid-tick is credited disproportionately. |
| V-45  | `apps/web/lib/staking/claim.ts` | Engine side | Emit on the `/me/staking/claim` response when the same position was claimed twice within a tight window. |
| V-50  | `nginx/nginx.conf` + `docker-compose.yml` | Smuggled framing detection requires nginx to add a marker header for CL+TE-tolerated requests | Add `proxy_set_header x-bvbe-ctf-framing-anomaly $http_te_anomaly;` (where the variable is set from an nginx `if` block matching ambiguous CL+TE). Downstream handler emits when the header is non-empty. |

**Acceptance:** each row above lands as a small dedicated slice
2.1 / 2.2 / 2.3 commit. None unlocks until the architect signs off
on the detector sketch.

## Backlog B — Pattern B validator tightening

The L7 flagged these as oracle-prone (a trainee reading `claim.ts`
can mint passing proofs without doing the work). Each needs a
stronger validator.

| V-NNN | Current MVP validator | Tightening direction |
|-------|------------------------|----------------------|
| V-1   | `proof.trim().length > 0` | Track exfil tags: the XSS payload's `fetch('/api/v2/ctf/xss-marker?tag=…')` registers `(tag, admin-userId)` on hit; claim accepts only registered tags within a TTL window. |
| V-10  | `/^[0-9a-f]{16}$/` (any 16 hex) | Validator queries the lab's password-reset table for an actually-issued token; accepts only currently-valid tokens. |
| V-17  | `proof.trim().length > 0` | Plant a marker file the injected command must `cat`; validator checks proof matches the marker contents. |
| V-21  | `/^[A-Za-z0-9_\-]{20,}$/` | Validator must verify the proof IS a refresh token that was successfully reused — needs the V-21 detection sidecar from Backlog A. |
| V-23  | `proof.trim().length > 0` | Validator checks proof contains a server-issued subscription-id that was minted in a no-Origin-header WS handshake. |
| V-27  | `proof.trim().length > 0` | Validator checks proof matches a server-tagged tier-bypass event from a recent `requireTier` string-coerce. |
| V-28  | `proof.trim().length > 0` | Validator queries withdrawals table for an over-limit row owned by the trainee in the last hour. |
| V-30  | `proof.trim().length > 0` | Same as V-28 against internal_transfers. |
| V-32  | `/^[0-9]+$/` | Validator checks the order id corresponds to a cancel that left `Balance.locked < 0`. |
| V-35  | `proof.trim().length > 0` | Validator checks the proof is a recently-served privileged response body that the trainee's session never legitimately accessed. |
| CHAIN-C | comma-separated id pair | Validator queries Trade + Liquidation tables to confirm the linkage actually fired. |
| CHAIN-D | `kyc-bucket/user-NNN/...` shape | Validator checks the proof matches an actual `mock-s3` retrieval from a request bearing valid `mock-imds` creds in the last hour. |

The validators marked "(MVP-acknowledged)" in the slice 2 commit
body (V-1, V-10, V-21) get explicit tickets here; the rest are new
finds from the L7 review.

## Sequencing recommendation

- **Slice 2.1** — Pattern A backlog (V-6, V-26, V-32, V-43, V-45,
  V-47-already-shipped, V-51-already-shipped). Single-file detectors
  at request handlers. No new infrastructure.
- **Slice 2.2** — Pattern A backlog requiring claim-envelope changes
  (V-8, V-19, V-21). Shared-module `verifyAccessTokenV1` returns
  `alg`; route handlers emit.
- **Slice 2.3** — Pattern A backlog requiring worker → response
  bridging (V-42, V-44). Worker writes an audit row; user-facing
  list endpoints read and emit.
- **Slice 2.4** — Pattern A backlog with infra changes (V-23 WS
  message channel, V-50 nginx framing marker). Touches
  `apps/ws-gateway/src/server.ts` and `nginx/nginx.conf` — the
  paranoid QA in this slice must re-verify V-23 / V-46 / V-6 / V-50
  plants still intact after the config edits.
- **Slice 2.5** — Pattern B validator tightening (backlog B). New
  per-validator detection sidecars (exfil-tag registry, refresh-
  reuse map, etc.).

Slice 3 (the trainee `/ctf` page) can proceed in parallel with 2.x —
they touch different surfaces. But the slice-3 L7 review should
re-check that none of the slice-2x detectors regressed when the
`/ctf` UI started consuming the claim endpoint.

## Status

| Slice  | Status  | Owner            |
|--------|---------|------------------|
| 2.0    | shipped | done (commit 4a7ecb8) |
| 2.1    | open    | architect to sign off on detector sketches, then staff eng |
| 2.2    | open    | architect to sign off on envelope change, then staff eng |
| 2.3    | open    | needs design doc for worker→response audit bridge |
| 2.4    | open    | needs paranoid-QA pre-plan for nginx + ws-gateway edits |
| 2.5    | open    | needs design doc for per-validator detection sidecars |
| 3.0    | not started | gated on slice 2.0 only (per phase-11 plan); parallel-safe with 2.x |
