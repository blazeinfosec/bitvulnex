# Phase 4 — Spot trading & order book

> Input to Gate 1. Phase 4 is the largest feature phase yet: real
> order matching, balance locking, public price feed, a WebSocket
> for the order book, and nginx caching of `/api/public/*`. Plants
> six new vulnerabilities and finally fires V-27 (planted latent in
> Phase 2).

## Goal

Stand up a working spot exchange for the BTC/USDT and ETH/USDT
pairs. Tier-1+ users can deposit (Phase 3) and now trade. Phase 5
will layer margin on top of the same `Balance` model.

## Deliverables

### Schema additions

- Extend `Balance` (additive): add `locked Decimal(38,8)` and
  `available Decimal(38,8)`. Migration backfills `available =
  amount`, `locked = 0`.
- `TradingPair` — `id`, `base` ("BTC"), `quote` ("USDT"),
  `active`, `minOrderSize` (Decimal), `priceTick` (Decimal). Seeded
  in `prisma/seed.ts` with `BTC/USDT` and `ETH/USDT`.
- `Order` — `id` (sequential Int — **V-4 site**), `userId`, `pair`,
  `side` (`buy`/`sell`), `type` (`limit`/`market`/`stop_limit`/`oco`),
  `price` (Decimal, nullable for market), `amount` (Decimal),
  `filled` (Decimal, default 0), `status` (`open`/`partial`/
  `filled`/`cancelled`), `stopTrigger` (Decimal, nullable),
  `ocoPairId` (Int, nullable, FK self-reference for OCO siblings),
  `createdAt`, `cancelledAt`.
- `Trade` — `id`, `pair`, `takerOrderId`, `makerOrderId`,
  `takerUserId`, `makerUserId`, `price` (Decimal), `amount` (Decimal),
  `takerFeeBps`, `makerFeeBps`, `executedAt`.
- `FeeTier` — seeded constants: `base` (10bps maker / 20bps taker),
  `vip` (5/10), `prime` (0/5). User's tier looked up by 30-day
  volume from `Trade`.
- Migration `20260531000000_phase_4_trading`.

### Matching engine — `apps/web/lib/engine/`

In-process matching on the web server. Reasonably real shape:

- Price-time priority for limit orders.
- Market orders cross the book until exhausted; partial fills
  allowed.
- Self-trades: the engine **does NOT** filter `makerUserId ===
  takerUserId` — that's **V-25**, exploitable to inflate the
  displayed last price (which Phase 5 margin will use as oracle).
- Balance locking: place-order locks the available balance; cancel
  unlocks; fill consumes locked + credits the counter-asset to
  available.
- All math via `Prisma.Decimal` — addresses Phase-3 Q-3.11.
- `engine/match.ts` — pure functions, easy to unit-test.
- `engine/place.ts` — orchestrates DB tx + match attempt + WS
  broadcast.

### Order endpoints

User-facing `/api/v2/me/orders/*`:

- `POST /api/v2/me/orders` — body: `{ pair, side, type, price?,
  amount, stopTrigger?, ocoSibling? }`. Locks balance, places
  order, attempts to match.
- `GET /api/v2/me/orders` — list caller's orders (filter `status`)
- `GET /api/v2/me/orders/{id}` — fetch one. **V-4 site**: the
  handler does `prisma.order.findUnique({ where: { id } })` with
  the URL int param, **does not check** `order.userId ===
  claims.sub`. Any logged-in user can read any order.
- `DELETE /api/v2/me/orders/{id}` — cancel. Same IDOR pattern as
  GET; can cancel another user's orders.
- `GET /api/v2/me/trades` — list caller's trades.

Public:

- `GET /api/v2/public/price/{pair}` — last-trade price + best
  bid/ask. **nginx caches this** (see § nginx).
- `GET /api/v2/public/book/{pair}` — top-20 bids/asks.

### Next.js Server Action (V-22)

`apps/web/app/account/orders/edit-order.ts` (`"use server"`).
Lets a user "edit advanced order fields" (originally for VIP
users; the gating got removed in a rush). Spreads the form input
into a Prisma `update`. **V-22 fires** when the client POSTs the
action with extra fields:

```ts
"use server";
export async function editOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  const data = Object.fromEntries(formData) as Record<string, unknown>;
  await prisma.order.update({ where: { id }, data });
}
```

A direct POST to the action endpoint with `feeTier=prime` or
`status=filled` mutates the order or — through Prisma's relation
mutation — the user's `feeTier`. Realistic root cause: engineer
copy-pasted a "spread the form into the update" pattern from a
prototype.

### WebSocket gateway (`apps/ws-gateway/`)

New service. Express + `ws`. Subscribes to Redis pub/sub channels
the web app publishes to. Forwards messages to connected WS
clients filtered by channel subscription.

- Connection URL: `ws://exchange.local/ws?token=<jwt>` (token in
  query string — **V-23 surface**)
- The `upgrade` handler does **not** validate `Origin` (V-23
  CSWSH).
- Channels: `book:BTC/USDT` (public, broadcast on every order
  change), `trades:BTC/USDT` (public), `private:<userId>`
  (per-user order fills, balance updates).
- The token in the URL grants subscription to `private:<userId>`
  channels — including other users' if the WS gateway trusts the
  client-sent channel name without re-verifying.

The gateway runs on its own port (3001) and is reverse-proxied
through nginx at `/ws/*`.

### nginx proxy_cache for `/api/public/*`

New nginx config block:

```nginx
proxy_cache_path /tmp/nginx-public-cache levels=1:2 keys_zone=public_cache:10m;
location /api/v2/public/ {
    proxy_cache public_cache;
    proxy_cache_valid 200 5s;
    # Cache key omits Host — Phase 9 will activate the smuggling
    # block that pairs with this to land CHAIN C's poisoning step.
    proxy_cache_key "$request_method$request_uri";
    proxy_pass http://web;
    proxy_http_version 1.1;
}
```

The cache itself is **not** the planted vuln in Phase 4 — it's
infrastructure that CHAIN C consumes in Phase 9. The vuln there
will be the Host-header-in-response that gets cached (planted in
Phase 9 alongside the CL/TE-tolerant block).

### Fee tier (V-43)

Fee-tier lookup by 30-day volume:

```ts
async function feeTierForUser(userId: string): Promise<"base" | "vip" | "prime"> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const vol = await prisma.trade.aggregate({
    where: {
      OR: [
        { takerUserId: userId },
        { makerUserId: userId },
      ],
      executedAt: { gte: since },
      // V-43 plant: no filter on `order.status` -- includes trades
      // from orders that were later cancelled (which on a real
      // exchange would not have generated any trade, but our
      // matching engine writes Trade rows BEFORE the cancellation
      // path can roll them back — race window).
    },
    _sum: { amount: true },
  });
  // ... thresholds
}
```

Actually the realistic root cause is simpler: the query joins from
`Trade` to `Order` and filters `order.status != 'cancelled'`,
but the join is via `takerOrderId`. For the **maker side**, the
maker order might be cancelled (partially filled + cancelled), but
the trade still counted. So a user can repeatedly place + partially
fill (via a sibling account or via V-25 self-trade) + cancel,
inflating their 30-day volume against `prime` tier.

### V-27 finally fires

The Phase-2 `requireTier(user, min)` lex-compare bug. Phase 4
gates advanced order types (stop-loss, OCO) behind tier 2:

```ts
// Engineers pulled the threshold from a JSON feature flag config
// that ships labels as strings.
const STOP_ORDER_TIER = FEATURE_FLAGS.stop_order_tier; // "2" (string)
requireTier(claims, STOP_ORDER_TIER);
```

A tier-3 user calling stop-loss: `"3" < "2"`? JS lex compare:
'3' > '2' → false. Passes. ✅
A tier-1 user calling stop-loss: `"1" < "2"`? '1' < '2' → true.
Rejected. ✅
A user with `kycTier === "10"` (forged): `"10" < "2"`? '1' < '2' →
true. Rejected. Not directly exploitable from KYC tier alone.

But: pair with V-35 (middleware bypass) — attacker sets
`x-bvbe-kyc-tier: 10` if any handler trusts that header. The lex
compare means `"10" < "2"` rejects them (good for the attacker who
*wants* to be high tier — wait, this is the wrong direction).

Reworking: V-27 fires the OTHER direction. The handler checks
`if (user.kycTier < min) throw`. The bug rejects a user who
*should* be allowed. So V-27's surface is "denial of service for
high-tier users" — annoying but not an escalation vuln.

Where it bites: place a string `"10"` ANYWHERE (e.g., admin sets
a user's tier to literal `"10"` via the V-35-bypassed admin
endpoint, expecting "should be highest"). The user is now ranked
below tier `"3"`. UX subtly broken.

Better firing: pair `requireTier` with a Phase-7 withdrawal limit
check that reads the tier from a *header* (`x-bvbe-kyc-tier`) for
"performance" reasons (cache the JWT claim once at middleware,
read header downstream). Phase 7 then plants the header-trust
pattern; the lex compare fires when an attacker sends `"10"` and
the limit check incorrectly says "this is the lowest tier" — wait
that's still the wrong direction.

**Phase-4 architect call:** Keep V-27 latent through Phase 4
(architect agrees the firing direction is subtle and waiting for
Phase-7 withdrawal flow to give it a real exploit shape is fine).
The Phase-4 plan **does** wire `requireTier(claims, "2")` into the
stop-order handler so the bug is reachable; the exploit pattern is
documented in adversarial-qa.md but not turned into an
end-to-end PoC.

### UI

- `/account/trading/{pair}` — trading view: order book (live via
  WS), order entry form, my open orders, recent trades
- `/account` updated with link to trading
- Public landing page ticker placeholder (existing) updated to
  fetch real prices from `/api/v2/public/price/*`

### Tests

- `apps/web/lib/engine/match.test.ts` — pure-function matching
  tests (no DB): price-time priority, partial fills, market vs
  limit. **No** tests for self-trade behavior (would pin V-25).
- `apps/web/lib/engine/fees.test.ts` — fee-tier helpers, happy
  path only (no V-43 tests).
- `apps/ws-gateway/src/origin.test.ts` — none (no test for the
  missing origin check, by design).

### Phase-3 housekeeping deferrals (per L7 Q-3.7/8/11)

- **Q-3.11 `Prisma.Decimal` discipline:** All Phase-4 arithmetic
  uses `new Prisma.Decimal(...)`. Existing Phase-3 worker code
  migrated in the same commit.
- **Q-3.7 `upsertJobScheduler`:** Phase-3 worker `queue.add(...)`
  + repeat → `queue.upsertJobScheduler(...)`. Phase 4 adds zero
  new queues but updates the existing one.
- **Q-3.8 IORedis instance reuse:** Worker passes a shared
  `new IORedis(redisUrl)` to BullMQ constructors. Drops
  `parseRedisUrl`.

### Diegetic CHANGELOG entry

"2026-05-31 — Phase 4: spot trading. BTC/USDT and ETH/USDT
pairs, limit and market orders, advanced stop-loss + OCO for
tier-2+ users. Order book via WebSocket at `wss://exchange.local/ws`.
Public price feed cached at the edge for 5 seconds. Fee tiers
recalculated on each trade."

## Vuln allocation (planted in this phase)

| Vuln  | Category     | Difficulty | Location                                          |
|-------|-------------|------------|---------------------------------------------------|
| V-4   | OWASP/IDOR  | easy       | `/api/v2/me/orders/[id]/route.ts` (GET + DELETE)  |
| V-22  | OWASP/MA    | medium     | `apps/web/app/account/orders/edit-order.ts` (Server Action) |
| V-23  | WS/CSWSH    | medium     | `apps/ws-gateway/src/server.ts` (no Origin check) |
| V-25  | Business    | medium     | `apps/web/lib/engine/match.ts` (no self-match filter) |
| V-32  | Logic/Race  | hard       | OCO sibling cancellation race (`/orders/[id]` DELETE + matching) |
| V-43  | Business    | medium     | `apps/web/lib/engine/fees.ts` (volume includes cancelled maker side) |

V-27 (Phase 2 plant) is wired in but its exploitable direction
waits for Phase 7.

## Exit criteria

1. All Phase 0–3 exit criteria still pass.
2. Tier-1+ user can place a limit order on BTC/USDT; it appears
   in the order book.
3. Two opposing orders match, generate a `Trade` row, debit both
   `Balance.locked`, credit both `Balance.available`.
4. Order book WS broadcasts the new top-of-book within ~100ms of
   the order matching.
5. Public price endpoint returns the last trade price and is
   cached by nginx for 5s.
6. Each planted vuln has a working PoC in adversarial-qa.md.
7. VULNS.md contains 6 new entries.
8. Phase-3 housekeeping deferrals all closed.

## Open questions for the architect

1. **Where does the matching engine live?** Plan says in-process
   on web. Alternative: a dedicated `apps/engine` service. The
   in-process choice is simpler and matches small-exchange
   architectures; the dedicated service is more realistic but
   bigger.
2. **Should V-27 get an end-to-end PoC in Phase 4 or wait for
   Phase 7?** Plan says wait — the exploit direction is subtle
   and benefits from Phase-7's header-trust pattern.
3. **Should the WS gateway require token-in-cookie instead of
   query string?** Query string is the V-23 surface; cookie would
   close that half-of-V-23. Plan says query string.
4. **Should OCO siblings be a separate table or a self-FK?**
   Plan says self-FK (`ocoPairId` int nullable). Simpler.
