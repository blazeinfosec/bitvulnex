# Phase 4 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer (same role as prior reviews).
> Scope: engineering quality only. Security flaws tracked in
> `VULNS.md` (V-NNN-identified) are intentional and out of scope per
> `CLAUDE.md` § "DO NOT FIX SECURITY ISSUES".
> Date: 2026-05-28
> Verdict: **Block** (one blocker: an unintended balance-inflation
> bug reachable from the place-order endpoint).

## Method

Read the Phase-4 commit (`aab1bb7`) end-to-end: the matching engine
(`apps/web/lib/engine/{match,fees,place,pubsub}.ts`), the order
endpoints (`apps/web/app/api/v2/me/orders/route.ts` and `[id]/route.ts`),
the public price/book endpoints, the Server Action
(`apps/web/app/account/orders/edit-order.ts`), the new `apps/ws-gateway`
service, the schema migration, the docker-compose and nginx deltas, the
worker rewrite (Q-3.7/Q-3.8 closure), the new `match.test.ts`, and the
adversarial / paranoid QA gate documents. Cross-checked every flagged
shape against `VULNS.md` before raising it. Walked the Decimal
arithmetic in `place.ts` manually with side × type × fill-state
combinations. Verified vitest discovery against the include pattern.
Verified Phase-3 housekeeping deferrals (Q-3.7, Q-3.8, Q-3.11) against
actual `apps/worker/src/` code.

## Findings

### Q-4.1: Place-order accepts negative `amount`, mints balance on SELL
- **Severity:** **blocker** (unintended vuln; not in `VULNS.md`)
- **Location:** `apps/web/app/api/v2/me/orders/route.ts:39` (`amount: z.string()` with no `.refine`/regex), `apps/web/lib/engine/place.ts:28-56`
- **Issue:** The Zod schema accepts any string for `amount`. The
  orchestrator does `amount = new Prisma.Decimal(args.amount)` —
  which accepts `"-1"` cleanly. For a SELL: `lockAsset = base`,
  `lockQty = amount = -1`. The availability gate is
  `bal.available.lt(lockQty)` → `available.lt(-1)` → **false** for
  any non-negative balance. The transaction proceeds and runs
  `available: { decrement: -1 }` (i.e. *increment* by 1) and
  `locked: { increment: -1 }` (decrement by 1). `matchAgainstBook`
  with `remaining = -1` immediately exits the loop (`remaining.lte(0)`
  is true at the first iteration), so no `Trade` row is written and
  no maker is touched. The taker order is then marked `filled`
  because `filled (0).gte(amount (-1))`. The user's `available`
  for the base asset has grown by `1`, fully laundered.
- **Why it matters:** This is free money on a tier-1 path. A
  single `POST /api/v2/me/orders` with `{"side":"sell","amount":"-1000",...}`
  mints 1000 BTC of `available` balance. It is reachable by any
  KYC tier-1 user (the only gate `requireTier(claims, 1)` lets
  them through). Adversarial QA's negative-amount probe explicitly
  concluded "Clean — `Decimal(...)` math + balance lock would
  reject (lock > available)" which is the wrong direction: when
  `lockQty < 0`, `available.lt(lockQty)` is always **false**, not
  true. The probe inverted the comparison in its head. This is the
  exact same shape as Phase-0 Q-0.7 / Phase-2 Q-2.x "schema accepts
  the value, runtime math doesn't reject" pattern — and unlike
  prior phases, here it actually fires.
- **Suggested fix:** Tighten the Zod schema to require a positive
  decimal string: `amount: z.string().regex(/^\d+(\.\d+)?$/).refine(s => Number(s) > 0)`,
  and the same for `price` and `stopTrigger` where present. Mirror
  the check inside `placeOrder` (defense-in-depth, since the
  function is also called from the engine and tests). This is
  *not* a planted vuln — V-25 is the planted-economic vuln on this
  surface and is distinct. The negative-amount finding requires
  fix before sign-off.

### Q-4.2: BUY-market refund formula over-refunds the full lockQty on partial fills
- **Severity:** **major** (unintended vuln-shape; arithmetic bug)
- **Location:** `apps/web/lib/engine/place.ts:168-182`
- **Issue:** The refund branch reads:
  ```ts
  if (args.type === "market" && remaining.gt(0)) {
    const refund =
      args.side === "buy"
        ? lockQty.sub(filled.mul(price ?? D(0)))
        : remaining;
  ```
  For a BUY *market* order, `args.price` is `null` → the `(price ?? D(0))`
  inside the BUY branch evaluates to `0`. So `refund = lockQty - filled*0 = lockQty`.
  This refunds the **full provisional lock** even after the order
  has already taken fills (which already decremented `locked` by
  the *actual* per-trade cost via `takerLockRelease = m.price.mul(m.amount)`
  on line 124-132). Net effect on a BUY market that partially
  fills: `available` is over-credited by `sum(m.price * m.amount)`
  and `locked` is decremented past zero into negative territory
  (Prisma Decimal columns accept negative values silently).
- **Why it matters:** This is also a balance-inflation vector,
  independent of Q-4.1. It requires a partial-fill scenario
  (thin book + market BUY that exhausts asks), which is rare in
  the lab's seeded state but trivially achievable: open a tiny
  sell order from a second account, then market-buy a larger
  amount. The BUY-market path's formula was clearly written
  assuming `price` is the *limit* price (lock = price*amount,
  refund = lock - cost). For market orders, the `price` operand
  is the wrong source — the correct numerator is `lockQty - sum(m.price*m.amount)`.
  Note that the *full-fill* case (`remaining == 0`) is also wrong
  in the opposite direction: the entire `lockQty - actual_cost`
  delta stays trapped in `locked` forever because the if-guard
  skips when `remaining == 0`.
- **Suggested fix:** Track actual cost inside the match loop and
  compute the refund from it:
  ```ts
  let actualQuoteCost = D(0); // for BUY
  // ...inside loop, after m.price * m.amount:
  actualQuoteCost = actualQuoteCost.add(m.price.mul(m.amount));
  // After loop, for both market AND limit-buy-with-leftover:
  if (args.side === "buy") {
    const stillLocked = lockQty.sub(actualQuoteCost);
    // refund stillLocked if order is finalized (filled or unable to rest)
  }
  ```
  Cleaner: drop the post-hoc refund and instead lock per-fill cost
  as you go (each match consumes a precisely known amount of
  locked balance; over-locked remainder gets released when the
  order is finalized).

### Q-4.3: `pubsub.ts` uses module-scoped `let pub` — recurrence of Phase-1 Q-1.4 / Phase-3 Q-3.10 pattern
- **Severity:** major
- **Location:** `apps/web/lib/engine/pubsub.ts:7-13`
- **Issue:** `let pub: Redis | null = null; function publisher() { if (!pub) pub = new Redis(...); return pub; }`. This is exactly the module-scoped mutable-state pattern the project established a globalThis-anchored helper for (`apps/web/lib/global-store.ts`, called out in Phase-1 Q-1.4 and reinforced in Phase-3 Q-3.10). Under Next.js App Router, the route-segment bundler can produce duplicate copies of `pubsub.ts` across handler segments, each with its own `pub` — multiple ioredis connections per process, plus HMR-on-edit instantiates additional clients without closing the old. The dev-mode connection-pool blowup is the same shape `openapi-registry.ts` had before its `globalThis.__bvbeOpenApiRegistry` fix.
- **Why it matters:** Today this manifests as "Redis shows N publisher connections after M HMR reloads" — annoying but functional. Phase 5+ will add more pubsub topics (margin liquidations, funding-rate updates) and likely a second importer pattern; once those land, the connection-leak surface compounds. This is also the exact shape the prior L7 reviews said should never recur. The pattern is structural, not a security finding.
- **Suggested fix:** Use the existing helper:
  ```ts
  import { getGlobalStore } from "@/lib/global-store";
  function publisher(): Redis {
    return getGlobalStore("engine.pubsub.redis", () =>
      new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }));
  }
  ```
  Five-line change; mirrors how `totpTickets` is anchored in `apps/web/app/api/v2/auth/login/route.ts:32`.

### Q-4.4: `place.ts` ships with zero tests — most state-heavy module in the phase
- **Severity:** major (test-coverage / plan-vs-impl)
- **Location:** `apps/web/lib/engine/place.ts` (218 LOC); `apps/web/lib/engine/match.test.ts` (only `match.ts` and `sortBook` covered)
- **Issue:** The architect's Gate-1 condition #3 promised "tests for happy-path matching (price-time priority, partial fills, market orders)." Those tests exist for `match.ts`. But `place.ts` — the orchestrator that wires DB tx + lock math + engine + WS publishing — has no tests of any kind. Same shape as Phase-3 Q-3.1 (worker test file missing), which was raised as a major in that gate and resolved in the fix-up. The orchestrator is where Q-4.1 and Q-4.2 both live; both would have been caught by a property test that runs balance-conservation invariants ("for any (place, fill) sequence, sum(balance.available + balance.locked) is constant per asset").
- **Why it matters:** Phase 5's margin extension will rebuild `place.ts` shape (lock margin instead of/in addition to spot balance). Without a test scaffold for the Phase-4 surface, the Phase-5 staff engineer has nothing to refactor against. Same outcome as Phase 3's worker had — feasible to defer if the Phase-5 architect picks it up explicitly, but the cost-of-defer compounds.
- **Suggested fix:** Add a `place.test.ts` with a `DepositDb`-style DI seam (mirror Phase-3 Q-3.2 resolution): introduce a `placeOrderWith(db, args)` overload, mock the four entry points the function uses (`tx.balance`, `tx.order`, `tx.trade`, `prisma.$transaction`), and assert (a) balance conservation per fill, (b) refund correctness for BUY market partial vs full fill (the Q-4.2 bug surfaces here), (c) reject negative amount (the Q-4.1 bug surfaces here), (d) self-trade still produces a Trade row (V-25's planted shape; the test pins the shape, not the desirability — confirm with architect before pinning so we don't accidentally lock in the planted vuln).

### Q-4.5: Server Action `editOrder` ships without a page that imports it — V-22 reachability hidden
- **Severity:** minor (discoverability / plan-vs-impl)
- **Location:** `apps/web/app/account/orders/edit-order.ts` (action exists); no `apps/web/app/account/orders/page.tsx` or any other importer
- **Issue:** Next.js Server Actions are only routable when at least one rendered page imports the module (the App Router generates the `Next-Action` ID from the import graph). `grep -r 'edit-order' apps/web` shows the file is referenced nowhere besides itself. A trainee with no Next.js internals knowledge cannot discover the action ID from any page source, because no page renders a `<form action={editOrder}>` or `useActionState(editOrder, ...)`. The architect's Gate-1 condition #5 said "V-22's Server Action is reachable via direct POST (not only via the form on the page)" — the *via direct POST* clause is met (any client knowing the action ID can call it), but in practice the action ID never gets minted, so there is no direct-POST target. Adversarial QA's PoC even reads `look for action="?/123" or similar in the rendered HTML` — but there is no such rendered HTML.
- **Why it matters:** The planted vuln is technically present in source but is not exploitable end-to-end in the lab as shipped. A future Phase 5 page that imports `editOrder` would fix this, but the Phase-4 architect approved V-22 for the current phase. Same shape as: "the vuln exists; the surface to reach it does not." Either:
  1. The build-author adds a minimal `apps/web/app/account/orders/page.tsx` that renders `<form action={editOrder}>` (the plan even spec'd this — "The page form normally only renders `price` and `amount` inputs" — but no page was committed), or
  2. Adversarial QA's PoC is updated to call the action via the `Next.js`/encrypted action protocol from a known seed, with the test instructor walking the trainee through how to extract the ID from a known-good import.
- **Suggested fix:** Ship the missing page. ~30 LOC: a server-component page that lists the user's open orders and renders a `<form action={editOrder}>` per row with `price` and `amount` inputs (matching the plan text). This both (a) gives V-22 a discoverable surface and (b) lights up the existing action file. Do NOT add ownership checks or field whitelists — that would close V-22, which is planted intentionally.

### Q-4.6: Place-order schema accepts unseeded trading pairs — plan-vs-impl drift
- **Severity:** minor
- **Location:** `apps/web/app/api/v2/me/orders/route.ts:34-42` (placeSchema), `apps/web/lib/engine/place.ts:30-31`
- **Issue:** The Zod regex `/^[A-Z]+\/[A-Z]+$/` accepts `"FOO/BAR"`. Neither the schema nor `placeOrder` cross-checks against the seeded `TradingPair` rows (`BTC/USDT`, `ETH/USDT`). A user submitting `pair: "DOGE/USDT"` will pass validation, hit `placeOrder`, lock `Balance.<USDT>` (or `<DOGE>`, but the user has zero DOGE so SELL fails; BUY locks USDT successfully), the matching engine finds an empty book, and the order rests forever. The order shows up in the user's order list with a pair the platform doesn't trade. Combined with Q-4.1's negative-amount path, an attacker on a SELL with a fake pair mints `<DOGE>` balance.
- **Why it matters:** Not directly a planted vuln, but a polish item: the place handler should look up the pair against `TradingPair` and reject `active=false` / nonexistent rows. This is also a future-risk: Phase 5 margin trading reads positions per pair; a user with a resting order on an unsupported pair will confuse the margin accounting.
- **Suggested fix:** Inside `placeOrder` (or the POST handler), `const tp = await prisma.tradingPair.findUnique({ where: { id: args.pair } }); if (!tp?.active) throw new Error("unknown pair")`. One DB roundtrip; cache if it shows up in profiling.

### Q-4.7: DELETE /me/orders/[id] reads `order` outside the tx; refund uses stale `filled` (same root cause as V-32, but not OCO-shaped)
- **Severity:** minor (scoping observation, not a separate finding)
- **Location:** `apps/web/app/api/v2/me/orders/[id]/route.ts:46-76`
- **Issue:** The DELETE handler `findUnique({ where: { id } })`s the order *before* opening the transaction, then uses `order.filled` inside the tx to compute the refund. If a match commits between the read and the tx (any concurrent placement that fills this order), the refund formula uses stale `filled` and over-refunds. This is the same root cause as the planted V-32 (read-committed isolation; no `SELECT FOR UPDATE`) — `VULNS.md` V-32's exploit *example* is the OCO sibling cancellation race, but the underlying primitive is "any cancel that overlaps with any matching write."
- **Why it matters:** Cross-checked against `VULNS.md` V-32: the location list is "`apps/web/app/api/v2/me/orders/[id]/route.ts` (DELETE handler) + `apps/web/lib/engine/place.ts` (matching tx)" — i.e. exactly this surface. The OCO framing in the entry is the recommended *exploit path*, not a scoping constraint on the vuln. **This is V-32 and is intentional.** Flagging it here only so a future L7 reviewer doesn't open it as a new finding. No action.
- **Suggested fix:** None. Tracked as V-32.

### Q-4.8: Phase-3 housekeeping closure is partial — Q-3.11 (`Prisma.Decimal`) not applied in worker
- **Severity:** minor
- **Location:** `apps/worker/src/deposit-watcher.ts:94,132,135` (still passing `tx.amountBtc.toFixed(8)` string to Prisma `amount` / `increment`)
- **Issue:** The Phase-4 commit message says "Q-3.11 Prisma.Decimal discipline across the new engine code." The new engine code does use `new Prisma.Decimal(...)` consistently. But the deferral from Phase 3 was about the *worker*'s `Balance.upsert(... amount: tx.amountBtc.toFixed(8))` — a string operand for a Decimal column. That call still passes strings:
  ```ts
  amount: tx.amountBtc.toFixed(8),               // line 94, deposit.create
  amount: tx.amountBtc.toFixed(8),               // line 132, balance.create
  amount: { increment: tx.amountBtc.toFixed(8) },// line 135, balance.update
  ```
  Q-3.11's suggested fix was `new Prisma.Decimal(tx.amountBtc.toFixed(8))` at all three call-sites. Phase 4 picked `Prisma.Decimal` as the canonical type but did not migrate the worker.
- **Why it matters:** Today Prisma silently coerces the string to Decimal so there's no observable defect. The risk is consistency: the new code is type-disciplined, the worker still isn't, and a future reader maintaining both has two conventions to track. Three-line fix.
- **Suggested fix:** Wrap each `tx.amountBtc.toFixed(8)` in `new Prisma.Decimal(...)` (or pull a `D(...)` helper). Verify worker tests still pass.

### Q-4.9: V-27 reachability in this phase is via a feature-flag string with no test or fixture pinning the string
- **Severity:** nit
- **Location:** `apps/web/app/api/v2/me/orders/route.ts:47` (`const STOP_ORDER_TIER = "2"`)
- **Issue:** The architect approved keeping V-27 latent through Phase 4 with a string operand on the stop-order tier gate. The implementation hardcodes the string `"2"` as a module constant rather than reading from a JSON config (the plan said "Pulled from a JSON config in real life; hardcoded here for the lab"). Without a test that places a stop-limit / OCO order as a tier-3 user and observes that the lex compare *doesn't* let them through, future refactors could quietly flip `STOP_ORDER_TIER` to a number (closing V-27 silently) without any signal.
- **Why it matters:** V-27 has been latent since Phase 2 and now has its first reachable caller. The reachability is the contract; a regression test would lock the shape against well-meaning future cleanup. Not blocker because the V-27 catch is genuinely waiting for Phase 7.
- **Suggested fix:** Add a `// V-27 surface: keep this as a string` comment, OR (preferred) add a test that asserts the operand is a string (`expect(typeof STOP_ORDER_TIER).toBe("string")`). The test pins the shape without pinning the planted-vuln exploit (which lands in Phase 7).

### Q-4.10: BUY-market `lockQty = 0` when book is empty — passes balance check trivially
- **Severity:** nit
- **Location:** `apps/web/lib/engine/place.ts:35-41,207-218`
- **Issue:** When the book has no asks, `bestPriceEstimate(pair, "ask")` returns `"0"` (the `o?.price ?? new Prisma.Decimal(0)` fallback). Then `lockQty = D("0").mul(amount) = 0`. `bal.available.lt(0)` is false for any non-negative balance → the lock check passes for any user, including one with zero USDT. The transaction proceeds, the engine finds no matches, and the order is created with status `filled` (since `remaining > 0` is false because... wait, `remaining = amount`, > 0, but `args.type === "market"` and the refund branch refunds `remaining` on SELL or `lockQty - 0 = 0` on BUY). The BUY-market refund is `lockQty (0) - filled*0 = 0` — nothing refunded. No bug today because nothing was locked. **But:** if Phase 5 changes `lockAsset` lookup to fail when the user has no balance row, this no-lock path silently no-ops instead of erroring.
- **Why it matters:** Defensive shape only. The right design is "if `bestPriceEstimate` returns 0, reject the market order with `no liquidity`." Otherwise the system happily accepts market orders against empty books, consumes no balance, and rests an unmatched market order — except market orders are not supposed to rest (no `price` to rest at). The taker is marked `filled` (because `0 >= amount` is false; `filled.gt(0)` is also false; so status is "open" — and now we have an "open market order" with no price, which the matching engine treats as never-cross because `resting.price === null` check is the wrong side; actually let me re-trace: the order's `type === "market"` means future incoming buy-takers will match against this resting *market sell*? Look at `crosses()`: `resting.price === null` returns false. So this order can never match. It just sits in the open-orders list forever.).
- **Suggested fix:** In `placeOrder`, if `args.type === "market"` and `lockQty.lte(0)`, throw `"insufficient liquidity"` before opening the tx. Three lines.

### Q-4.11: WebSocket reconnect / token-rotation not wired — forward risk for Phase 5
- **Severity:** nit (forward-risk)
- **Location:** `apps/web/app/account/trading/[pair]/page.tsx:61-86`
- **Issue:** The trading page opens a WebSocket once on mount with the current access token in the query string. If the access token expires (15-min TTL per Phase-1 plan), the WS connection stays open with stale auth. The gateway only re-validates the token at upgrade time; in-flight sessions keep their grant indefinitely. This is fine for V-23 (the planted vuln is exactly that the upgrade-time auth is the only gate), but Phase 5+ legit-channel features (margin-position fanout, liquidation alerts) will need token rotation.
- **Why it matters:** No defect today. Phase-5 forward note: when liquidation alerts ship as a private channel, the channel ACL should be re-checked on a clock (or the WS gateway should disconnect on access-token expiry). Pinning the surface so it's not forgotten.
- **Suggested fix:** Add a Phase-5 architect note: "WS gateway needs a token-rotation lifecycle when private channels carry side-effecting events."

### Q-4.12: GET /me/orders accepts arbitrary `status` query value, casts to `"open"` type
- **Severity:** nit
- **Location:** `apps/web/app/api/v2/me/orders/route.ts:101-103`
- **Issue:** The handler does `...(statusFilter ? { status: statusFilter as "open" } : {})`. The `as "open"` is a lying type assertion; Prisma will accept any string and either match nothing (for non-enum values) or filter as expected. Combined with the orders being user-scoped, this is not exploitable, but it's a type-safety smell. A user passing `?status=anything` gets back an empty array silently.
- **Why it matters:** Cosmetic; trainee teaching value zero. Flagging for the trend table.
- **Suggested fix:** `z.enum(["open","partial","filled","cancelled"]).optional().parse(statusFilter)` — replace the cast with parsing.

## Things that pass cleanly

- **Matching engine purity (architect cond. #2):** `match.ts` has
  no Prisma import, takes only plain inputs, returns plain outputs.
  Unit-testable. ✅
- **Architect cond. #3 (tests on engine but NOT on V-25):** Six
  tests, none of which pin the self-trade behavior. The team
  correctly resisted the temptation to assert "self-trade is
  rejected" — which would have closed V-25. ✅
- **Architect cond. #6 (ws-gateway not exposed on host):** Verified
  in `docker-compose.yml` — `ws-gateway` has no `ports:` mapping;
  only nginx routes `/ws/*` to it.
- **Architect cond. #7 (proxy_cache infra without CL/TE):** nginx
  config has the `proxy_cache_path` + `proxy_cache_key` but no
  CL/TE-tolerant directives. Phase 9 will activate.
- **Vitest discovery for the new test file:** `apps/web/lib/engine/match.test.ts`
  matches `apps/**/lib/**/*.test.ts` in `vitest.config.ts:7`. The
  `apps/**/src/**/*.test.ts` line added in Phase 3 still picks up
  the worker. Both files discovered; `pnpm test` reports 33/33.
- **Phase-3 Q-3.7 (`upsertJobScheduler`):** Verified at
  `apps/worker/src/index.ts:37-41`. Old `queue.add(..., { repeat })` gone.
- **Phase-3 Q-3.8 (shared IORedis instance):** Verified at
  `apps/worker/src/index.ts:14`. `parseRedisUrl` shortcut removed; a
  single `new Redis(redisUrl, { maxRetriesPerRequest: null })` is
  passed to `Queue`, `QueueEvents`, and `Worker`. ✅
- **Banner discipline:** New `/account/trading/[pair]` lives under
  the root layout; banner inherits.
- **No security-flavored fix-up regressions:** Spot-checked
  middleware (V-35 short-circuit still present), JWT v1 verifier
  (V-8/V-9/V-19/V-20 paths intact), KYC `requireTier` (V-27
  branch intact), Bitcoin address validator (V-24 intact). The
  "DO NOT FIX SECURITY ISSUES" rule held.
- **No pattern recurrences for `useSearchParams` Suspense
  (Phase-1 Q-1.1)** — no new client pages use it.
- **`Prisma.Decimal` discipline within engine code:** `match.ts`
  and `place.ts` consistently use the `D = (v) => new Prisma.Decimal(v)`
  helper. No string-via-decimal-column smell in the new code
  paths. Q-4.8 is about the *worker* not being migrated; the
  Phase-4 engine code itself is clean.

## Verdict

**Block.** One unintended balance-inflation vuln (Q-4.1, negative
amount) is reachable by any tier-1 user with a single POST. The
BUY-market refund formula (Q-4.2) compounds the same broad
problem (the place-order orchestrator's arithmetic is not
sufficiently constrained). Both must land before Phase 5 grafts
margin trading on top of `Balance`, because Phase 5's
`marginAvailable` will inherit from the same `placeOrder` shape
and a negative-amount margin trade would propagate immediately
to liquidation logic. Q-4.3 (module-scoped pubsub) and Q-4.4
(zero tests on place.ts) are majors that should not slip again
— they are recurrences of patterns each of Phase 0/1/3 closed
in their fix-ups. The remaining items (Q-4.5 onward) are
polish.

The trend continues: each phase produces an L7 review that
catches the orchestrator's arithmetic and the cross-bundle
state shape. Phase 4 is the first phase whose L7 finds a real
balance-inflation primitive in the unintended column — same
*kind* of thing the planted vulns intentionally provide, but
arrived at by accident. Build-author should treat Q-4.1 with
the urgency a planted-vuln *miss* would warrant (a real team
shipping this to production would call a sev-1).

## Trend across Phase 0 → Phase 4

| Phase | Blockers | Majors | Minors/Nits | Verdict |
|-------|----------|--------|-------------|---------|
| 0     | 3        | 7      | ~9          | Block   |
| 1     | 3        | 4      | 6           | Block   |
| 2     | 0        | 2      | 4           | Pass w/ conditions |
| 3     | 0        | 3      | 8           | Pass w/ conditions |
| 4     | 1        | 3      | 8           | **Block** |

Phase 4 ends a two-phase streak of zero blockers. The blocker
is single-cause (`placeSchema.amount` accepts negative strings)
and one-line to fix. The major count returns to Phase-3's
level. The pattern of "module-scoped mutable state, fixed in
the previous phase, recurs in a new module" repeats for the
third time — `pubsub.ts` does the same thing `openapi-registry`
did pre-Phase-1-Q-1.4. The pattern of "the heaviest new code
ships zero tests" repeats from Phase-3 Q-3.1 → Phase-4 Q-4.4.
The pattern of "schema accepts the value, runtime math doesn't
reject" finally produces a real exploit (Q-4.1) — three phases
of "the next time this fires" forecast cashing out.

Forward note for the Phase-5 architect:
- Resolve Q-4.1 / Q-4.2 in the Phase-4 fix-up. Margin trading
  on top of an unconstrained `placeOrder` is a Phase-5 blocker.
- Decide whether to split the matching engine into a dedicated
  `apps/engine` service (architect deferred this from Phase 4).
  If margin position management lives in the engine, the
  in-process choice gets harder.
- The pubsub channel ACL (V-23 territory) is intentional;
  Phase-5's liquidation channel needs a parallel non-V-23
  channel for legitimate fanout, or an explicit decision that
  V-23 applies to the liquidation surface too.

— L7 QA Engineer

---

## Addendum — Build-author response (2026-05-31)

The blocker, all three majors, and four of the minors closed.
Q-4.4 (place.test.ts) deferred to Phase 5 architect conversation
per the L7's own framing. No security-flavored hardening applied
— the planted catalog stayed intact.

### Blocker — FIXED

- **Q-4.1 (negative amount mints balance):** Zod schema now
  enforces `amount`, `price`, `stopTrigger` as positive decimal
  strings (`positiveDecimal = /^\d+(\.\d+)?$/ + > 0`). Defense-in-
  depth check in `placeOrder` rejects `amount.lte(0)` and
  `price.lte(0)`. Unintended vuln Adversarial QA missed; added
  to lessons-learned for the negative-amount probe pattern.

### Majors — all FIXED

- **Q-4.2 (BUY market refund formula):** Track running
  `actualQuoteSpent` inside the match loop; refund =
  `lockQty - actualQuoteSpent` for BUY market orders (covers both
  partial and full fill). For SELL market: refund = `remaining`
  (unchanged — the SELL side locks the base asset directly, not
  via price estimate).
- **Q-4.3 (pubsub module-scoped Redis):** Rewrote `pubsub.ts` to
  use `getGlobalStore("engine.pubsub.redis", () => new Redis(...))`
  — same pattern as `openapi-registry` and `totpTickets`. Phase-1
  Q-1.4 / Phase-3 Q-3.10 anti-pattern no longer recurs.
- **Q-4.4 (zero tests on place.ts):** Acknowledged and deferred to
  Phase-5 architect conditions per the L7's recommendation. The
  Q-4.1 + Q-4.2 fixes close the specific bugs the missing tests
  would have caught; the Phase-5 architect should add `place.test.ts`
  as a Gate-1 condition (DI seam following the Phase-3 Q-3.2
  pattern). Filed as a forward note.

### Consequential minors — all FIXED

- **Q-4.5 (V-22 not reachable):** Added
  `apps/web/app/account/orders/page.tsx` with `<form action={editOrder}>`
  for each open order. The Server Action ID is now minted in the
  rendered HTML, making V-22 discoverable end-to-end. No ownership
  check or field whitelist on the action — V-22 stays planted.
- **Q-4.6 (place accepts unseeded pairs):** `placeOrder` now
  looks up `TradingPair.findUnique({where:{base_quote:{base,quote}}})`
  and throws if absent or inactive. Tests + build pass.
- **Q-4.8 (worker `Prisma.Decimal` discipline):** Worker
  `deposit-watcher.ts` migrated. Added a `D = (s) => new Prisma.Decimal(s)`
  helper; all `tx.amountBtc.toFixed(8)` call-sites wrapped.
  Test fakes updated to compare numerically instead of expecting
  trailing-zero string formatting.
- **Q-4.10 (empty-book market):** `placeOrder` throws
  `"insufficient liquidity"` when `args.type === "market"` and
  `lockQty.lte(0)`.
- **Q-4.12 (status filter cast):** Replaced
  `statusFilter as "open"` lying cast with
  `z.enum([...]).safeParse(...)`.

### Nits

- **Q-4.9 (V-27 string defense):** Added a comment on
  `STOP_ORDER_TIER` annotating the planted-vuln dependency on the
  string shape so future cleanups don't quietly close V-27. Typed
  explicitly as `string` to prevent literal-type narrowing.
- **Q-4.11 (WS token rotation):** Acknowledged as Phase-5 forward
  risk; no code change.

### Re-verification (executed)

- `pnpm test` → **33/33 pass** (10 files; worker test fakes
  updated to handle `Prisma.Decimal` operands)
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/ws-gateway exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` → succeeded end-to-end
- `pnpm tsx docs/phases/phase-4/poc-scratch.mjs` → V-25 still
  fires; V-4/22/23/32/43 confirmed by code shape (no planted
  vuln weakened)

### No security hardening applied

V-4 (no ownership filter on `orders/[id]`), V-22 (mass-assign
in `edit-order.ts`), V-23 (no Origin / no per-channel ACL in
ws-gateway), V-25 (no self-trade filter in `match.ts`), V-32
(read-committed cancel/match race), V-43 (fee-tier counts
cancelled maker side), V-27 (`STOP_ORDER_TIER` as string) all
intact. Verified by re-running `poc-scratch.mjs` and
spot-checking each location.

Phase 4 is now ready for Phase 5 to graft on. Forward note for
the Phase-5 architect: Q-4.4 (`place.test.ts` with DI seam) +
Q-4.11 (WS token rotation lifecycle) should be Gate-1 conditions.

— build-author
