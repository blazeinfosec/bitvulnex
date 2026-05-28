# Phase 3 — L7 QA Engineering Review

> Reviewer: independent L7 QA Engineer (same role as Phase-0 / Phase-1 / Phase-2 reviews).
> Scope: engineering quality (build, run, reproduce, maintain, plan-vs-implementation).
> Date: 2026-05-28
> Verdict: **Pass with conditions** (0 blockers, 3 majors, 8 minors/nits).

## Method

Static audit of `b609a31` at HEAD. Read the Phase-3 plan, architect review,
adversarial QA, and paranoid QA documents; then walked every new and
modified file: the Prisma schema deltas + the hand-written migration
(`20260530000000_phase_3_deposits`), the rewritten mock-bitcoind state
machine (`apps/bitcoin-mock/src/state.ts`), the bitcoin-mock express
server (`server.ts`) and rpc dispatch (`rpc/index.ts`), the deposit
worker (`apps/worker/src/deposit-watcher.ts` + `index.ts`), the address
validator (`packages/shared/src/btc-address.ts`), the lab-affordance
routes (`/api/v2/dev/btc/{send,mine,rbf}`), the user-facing routes
(`/api/v2/me/deposit/address`, `/me/deposits`, `/me/balance`), the new
deposit page (`/account/deposit`), the test file
(`packages/shared/src/btc-address.test.ts`), the BullMQ wiring, the
docker-compose deltas (none new in Phase 3), the lab-affordance gating
in `env.ts`, and the PoC scratch.

Cross-checked each Phase-3 exit criterion. Threaded each Phase-0/1/2
L7 finding into a recurrence check. Did not execute the lab; behavior
assertions are derived from the configuration as written. Did not
flag V-24, V-42, or any of the twelve carry-forward planted vulns
(each cross-referenced against `VULNS.md`).

## Findings

### Q-3.1: `deposit-watcher.test.ts` promised by plan does not exist — worker code is wholly untested
- **Severity:** major (plan-vs-implementation drift; testing-discipline regression)
- **Location:** plan `docs/phases/phase-3/plan.md:177-179` ("`apps/worker/src/deposit-watcher.test.ts` — round-trip on the `seen → confirming → credited` state machine using an in-memory mock"); no such file on disk; `apps/worker` has zero `*.test.ts` files; root `vitest.config.ts` includes apps/worker but finds nothing to run.
- **Issue:** The Phase-3 plan explicitly lists a worker test file with a stated scope ("round-trip on the `seen → confirming → credited` state machine"). Paranoid QA section 10 reports "**24/24 pass** (8 files; was 19/19 in 7 files; +5 from `btc-address.test.ts`)" — implying the +5 tests are entirely in the address validator. There are no worker tests. The worker is the **single most state-heavy file in the phase** (`pollOnce` → `reconcile` → `Balance.upsert` with `increment`), the locus of V-42's planted bug, and the surface every Phase-4+ trading flow will depend on. Shipping it with zero tests means the next maintainer who touches `pollOnce` has no safety net.
- **Why it matters:**
  1. **Plan-vs-impl drift.** Paranoid QA's section 9 marks exit criterion #4 ("After enough confirmations, `Balance.amount` increases") ✅ "static (`pollOnce` transaction credits balance)" — i.e. by reading the code, not by exercising it. The plan called out a test file specifically because static review is the wrong tool for state-machine code.
  2. **Phase-4 will extend this file.** The architect's forward note ("`Balance` table extends additively with `locked`/`available`") means trading will read these credited rows. A regression in `pollOnce` would silently corrupt every downstream balance. One round-trip vitest case would catch the entire class.
  3. **Pattern recurrence.** Phase-1 Q-1.5 closed the "Vitest exists but isn't invoked" loop. Phase-2 Q-2.5 closed the "no test for storage logic" loop. Phase 3 reopens both: a code module with planted-vuln-adjacent state semantics that **explicitly should not** test the vuln behavior (per architect's "no tests pin V-NNN" rule) — but should test the rest. Mirrors V-27's "test the function but not the vuln" precedent from Phase 2.
  4. **`minConfirmationsForTier` is a one-liner exported from the same module.** It's tempting to test it (tier 0 → 3, tier 1 → 3, tier 2 → 1, tier 3 → 0); doing so would pin V-42's planted value. **Don't.** Test the state-machine round-trip (mock `RpcClient`, see a deposit go `seen → credited`, see `Balance` rise) and explicitly skip the threshold values. Same shape as Phase-2's "test `mimeForFilename` but don't pin the `.html` mapping behavior."
- **Suggested fix:** Add `apps/worker/src/deposit-watcher.test.ts` with the round-trip the plan called for. Roughly: spin up a Prisma test schema (or stub `prisma` via dependency injection — the current code reaches `prisma` from the module scope, which Q-3.2 also calls out), inject a fake `RpcClient` whose `watch` returns one synthetic TX, call `pollOnce`, assert `Deposit.status === "credited"` and `Balance.amount` matches. Add one more case for the RBF-drop path (watch returns empty after first credit, deposit row → `dropped`, balance unchanged — that's the planted V-42 shape; document in the test that balance stays put). Two tests, ~30 minutes. None pin a planted-vuln value.

### Q-3.2: `pollOnce` reaches `prisma` from module scope — Q-3.1's test fix is blocked until DI is added
- **Severity:** major (testability blocker, not a runtime defect)
- **Location:** `apps/worker/src/deposit-watcher.ts:4` (`import { prisma } from "@bvbe/db"`); used at lines 29, 48, 57, 71, 76, 89, 96, 103, 111-126; `apps/worker/src/index.ts:53` (calls `pollOnce(rpc)`)
- **Issue:** `pollOnce` accepts an injected `RpcClient` (good — that's the test seam for the bitcoin side) but reaches `prisma` directly from the module-scoped import. The shared `packages/db` Prisma singleton is `globalThis`-anchored, so it's a single instance per process — fine in prod. But the test in Q-3.1 either needs a real Postgres + test schema, or has to mock the entire `@bvbe/db` module via `vi.mock("@bvbe/db", ...)`. Both are heavier than the alternative: extend the function signature to take an optional `db` argument defaulting to the singleton, so the test can pass a transactional Prisma client (or a hand-rolled fake).
- **Why it matters:**
  1. **Lowers the activation energy for Q-3.1.** A `pollOnce(rpc, db = prisma)` shape lets the test file run in pure node without spinning up Postgres.
  2. **Phase 4 will likely add a second consumer of `pollOnce`-like logic** (settlement worker, withdrawal watcher) and any reuse of this shape now multiplies the testability cost.
  3. **Pattern.** Phase-1 lib functions (`safeNext` planned, then reverted) and Phase-2 (`kyc-storage`) took the explicit-DI shape. The worker module is the only Phase-3 surface that didn't.
- **Suggested fix:** Change the signature to `export async function pollOnce(rpc: RpcClient, db: Pick<typeof prisma, "bitcoinAddress" | "deposit" | "balance" | "$transaction"> = prisma): Promise<void>`. Pass `prisma` from `index.ts`. The Q-3.1 test then constructs a `db` stub. Total: ~10 minutes; unlocks Q-3.1.

### Q-3.3: Deposit page's "lab affordance enabled?" probe works *only by accident* and pollutes server logs with a guaranteed 400
- **Severity:** major (correctness drift hidden behind a UX side-effect)
- **Location:** `apps/web/app/account/deposit/page.tsx:64-69` (the probe); `apps/web/app/api/v2/dev/btc/mine/route.ts:10` (zod `z.number().int().min(1).max(100)`)
- **Issue:** The deposit page tries to detect whether `LAB_AFFORDANCES_ENABLED` is on by sending `POST /api/v2/dev/btc/mine` with `{ blocks: 0 }` and treating any non-404 as "lab enabled" (`setLabEnabled(probe.status !== 404)`). Walk the route in order:
  1. `env().LAB_AFFORDANCES_ENABLED` false → returns `jsonError(404, "not found")` → probe sees 404 → `labEnabled=false`. ✅
  2. `env().LAB_AFFORDANCES_ENABLED` true → `userFromAuthorization` runs. If the auth bearer is missing/invalid → returns 401 → probe sees 401 → `labEnabled=true`. (`authedFetch` does include the bearer, but if it's expired the page would have already redirected on the address fetch above; consistent.)
  3. With a valid bearer and lab affordances on → `readJson(req, schema)` runs with `{ blocks: 0 }` → zod rejects (`min(1)`) → returns 400. Probe sees 400 → `labEnabled=true`. ✅
  The detection produces the right answer in every case I can construct. **But** it works for a reason the author probably didn't intend: the probe relies on the route returning 404 *only* for the lab-disabled branch and any other status for the lab-enabled branch. The intentional shape of "send `blocks: 0` and check the response" is **invalid input + side-effect-free**, but every poll of the page now ships a 400-validation-failed line into the server logs (and into BullMQ-adjacent log scrapers Phase 9 will lean on). It also leaves a "lab probe" footprint in the audit log that's confusing in real exercise post-mortems ("why is the user repeatedly submitting an invalid mine request?").
- **Why it matters:**
  1. **Hidden coupling.** The probe assumes the route's first early-out is the env check — change the order (auth before env, e.g.) and the probe silently flips meaning. Any Phase-N refactor to "auth before env" (a defensible cleanup) would break the probe without anyone noticing until they wonder why the toolkit card disappeared.
  2. **Diagnostic noise.** Every deposit-page load now produces a guaranteed 400 in `make logs web`. When a trainee is debugging a real validation failure on `/dev/btc/mine`, the genuine error is buried in the page-load noise.
  3. **Pattern.** A proper feature-flag-discovery endpoint (`GET /api/v2/dev/btc/status` returning `{ enabled: true }`) is the canonical shape. We're at the point in the project where ad-hoc probes will multiply if the precedent isn't set. The page also already calls three other `/api/v2/dev/btc/*` endpoints — a status endpoint is two additional lines.
- **Suggested fix:** Add `GET /api/v2/dev/btc/status` that returns `{ enabled: env().LAB_AFFORDANCES_ENABLED }` regardless of the flag (i.e., the *status* of the flag is not itself gated by the flag — there's no leak, since the page is auth-gated and the value is observable from any failed call anyway). Have the deposit page hit that. Drop the `blocks: 0` probe. Three minutes of work; eliminates the log spam and removes the brittle coupling. Bonus: Phase 4+ can extend the status endpoint to advertise `bitcoinMockOnline: bool`, `workerLastPollAt: ISO` for similar UX needs.

### Q-3.4: `derivationCounter` in `apps/bitcoin-mock/src/rpc/index.ts` is incremented but never read; `BitcoinAddress.derivationIndex` is always `0` in DB
- **Severity:** minor (dead code + schema field that never gets a real value)
- **Location:** `apps/bitcoin-mock/src/rpc/index.ts:33-37`; `apps/web/app/api/v2/me/deposit/address/route.ts:43`
- **Issue:** `getnewaddress` does `derivationCounter += 1; return chain.newAddress("bcrt1q")` but the counter value is never returned or stored. Meanwhile the web route hardcodes `derivationIndex: 0` for every `BitcoinAddress` row it creates. The schema column is therefore always `0` and the counter is dead state. Either:
  - the RPC should return `{ address, index }` and the web route should store the index, or
  - both should be dropped.
- **Why it matters:**
  1. Phase 7 PSBT signing will likely need an HD derivation path. If `derivationIndex` ever starts being read at that point, the data is uniformly `0` — Phase 7's debug "which key signs?" answer is "always the index-0 key" regardless of which BitcoinAddress row you pull. That's a forward-risk landmine the Phase-3 staff engineer can clear with two lines now.
  2. Cosmetic: a field that exists but is always `0` is a "tell" for trainees auditing the schema. They'll either ignore it or chase it.
- **Suggested fix:** Either (a) thread the counter back through: change `getnewaddress` to return `{ address: string, index: number }` (breaking the `@bvbe/bitcoin-rpc-types` contract if it's typed there — verify) and have the web route store `derivationIndex: index`; or (b) drop the column and the counter. (a) is the right move for Phase 7. (b) is acceptable if Phase 7 is going to re-shape this anyway.

### Q-3.5: `rbfReplace` math: fee accumulates correctly but new-output formula is `total - 500n`, not `total - feeSat`
- **Severity:** minor (edge-case correctness in the mock chain; not reachable in normal lab use)
- **Location:** `apps/bitcoin-mock/src/state.ts:160-170`
- **Issue:** Walk the math:
  ```
  total   = sum of old.outputs.amountSat
  feeSat  = old.feeSat + 500n     // recorded as the new fee on the mempool entry
  outputs = [{ address: newAddress, amountSat: total - 500n }]
  ```
  The recorded `feeSat` on the replacement is `old.feeSat + 500`, but the **outputs subtract only 500** from the total. The inputs/outputs/fee accounting is therefore off by `old.feeSat` — the replacement claims a fee of `old.feeSat + 500` but only `500` sats are missing from output value vs total input value. A real bitcoind would refuse this as malformed; the lab's in-memory chain doesn't check.
  Edge cases that surface real bugs:
  - **Dust / negative outputs.** If `total < 500n` (i.e., the original send was < 500 sats — possible if a Phase-N "round-trip 1 sat for testing" knob is ever added), the replacement output amount goes negative as a `bigint` — and a UTXO with negative `amountSat` enters the map. Later code that sums UTXOs would underflow.
  - **Repeated RBF.** Each successive RBF adds 500 to `feeSat` but only deducts 500 from outputs. After N RBFs the recorded fee is `original + 500*N` but the actual missing value is still just `500*N` (correct). The output sum stays at `total - 500*N`. So actually... the math is self-consistent if you treat `old.feeSat` as a label only and `500n` as the real per-step fee delta. The bug is that the recorded `feeSat` on the mempool entry doesn't match the input/output balance. Not a numeric bug for the lab's purposes, but it does mean `chain.mempool.get(id).feeSat` is **the wrong number** if anyone reads it.
- **Why it matters:** Phase 4's adversarial QA may want to inspect fee accounting on the mock chain (fee-based MEV demos? unlikely but plausible). The reported fee diverges from reality. More immediately: Q-3.1's worker test, if it exercises `chain.confirmations` after RBF + `chain.txsToAddress`, may compare amounts and trip over the `total - 500n` formula. Set this right while the function is one screenful.
- **Suggested fix:** Either (a) match the formula to the label: `outputs = [{ amountSat: total - (old.feeSat + 500n) }]` — but then `total - old.feeSat - 500n` could go negative for the original mempool send because `labSend` itself used `feeSat = 1_000n` and `outputs.sum = collected - 1000n` is what `total` already reflects. Re-derive: `total` in `rbfReplace` is the sum of the *old outputs* (which is `collected - old.feeSat`), so subtracting `old.feeSat` again is double-charging. The clean fix is `outputs = [{ amountSat: total - 500n }]` with `feeSat = 500n` (NOT `old.feeSat + 500n`). Or (b) explicitly comment that `feeSat` is a label and the real per-step fee is hardcoded 500. (a) is the right one.

### Q-3.6: `apps/worker/Dockerfile` runs `tsx` at runtime against bind-mounted source — but `tsx` is in `dependencies`, so no harm now; flagging because the worker `package.json` `build` + `start` scripts target a `dist/` that's never produced
- **Severity:** minor (forward-risk, same shape as Phase-0 Q-0.8)
- **Location:** `apps/worker/Dockerfile:16` (`CMD ["pnpm", "tsx", "src/index.ts"]`); `apps/worker/package.json:7-9` (`"build": "tsc ..."`, `"start": "node dist/index.js"`, `"lint": "tsc ... --noEmit"`)
- **Issue:** The `package.json` advertises a `build` and `start` script that target a compiled `dist/index.js`, but the Dockerfile runs `pnpm tsx src/index.ts` instead. The build path is unused. This is the same defensible-for-dev / wrong-for-prod pattern Phase-0 Q-0.8 flagged for the bitcoin-mock container. Phase-0's fix moved `tsx` to `dependencies` — already done here, so the runtime works. But the `dist/` story is stale, and any future "production image" pass (Phase 9 polish) will trip over the same gap. Worker `tsconfig.json` (not opened, but plausibly inherits the workspace defaults) needs to actually emit JS for `pnpm --filter @bvbe/worker run build` to land a usable `dist/`.
- **Why it matters:** Forward-risk only. Phase 9 polish (per Phase-0 / Phase-2 deferrals) will need this addressed before any "compile to dist, run with node" production-shaped image is feasible.
- **Suggested fix:** Defer to Phase 9. Document in the Phase-3 fix-up that the `dist/` story is unrealized.

### Q-3.7: BullMQ `queue.add("poll", {}, { repeat: { every: 5000 } })` on every worker start — confirm dedupe survives `down -v && up`
- **Severity:** minor (forward-risk; no observed defect today)
- **Location:** `apps/worker/src/index.ts:40-48`
- **Issue:** Every time the worker process starts, it calls `queue.add` with the same `repeat` opts. BullMQ derives a repeat key from `(name, opts.repeat)` and treats `add` as upsert; running `add` repeatedly does NOT create N independent repeat schedules (verified by reading BullMQ v5's `addRepeatableJob` — the key is deterministic for the same job name and `repeat.every`). So `down -v && up` (which wipes Redis) → worker starts → adds the repeat once → fine. Worker restarts without `down -v` (just `docker compose restart worker`) → worker re-adds, dedupe kicks in, also fine. So no extant defect.
  **However**: this is `queue.add(..., { repeat })` which BullMQ v5 deprecated in favor of `queue.upsertJobScheduler` (the new pattern that makes the intent explicit). The current shape will continue to work but produces a deprecation warning on `bullmq@5.21+`. Worth noting before Phase 4 piles more queues on top.
- **Why it matters:** If Phase 4 adds 3-4 more queues (trading-engine settlement, withdrawal processor, market-maker bot), each with its own `repeat`, the deprecation warnings multiply and obscure real issues in `make logs worker`.
- **Suggested fix:** Either (a) switch to `queue.upsertJobScheduler("poll-scheduler", { every: 5000 }, { name: "poll", data: {} })` now — one-line refactor; or (b) defer and document in CHANGELOG. (a) sets the right pattern for Phase 4.

### Q-3.8: `parseRedisUrl` is fine for `redis://host:port` and `redis://user:pass@host:port`, but drops username, db-number, and TLS — fine today, fragile if `.env.example` ever grows
- **Severity:** minor (forward-risk; ioredis-via-BullMQ surface)
- **Location:** `apps/worker/src/index.ts:9-17`
- **Issue:** The shortcut `parseRedisUrl` extracts `host`, `port`, and `password`. It does NOT extract: `username` (Redis 6+ ACLs use both — `redis://default:pass@host`), `db` (path `/2` selects DB 2), or `tls` (scheme `rediss://`). Today `REDIS_URL` is `redis://redis:6379` in `.env.example` and compose, so none of these matter. But:
  - Phase 4+ may want a separate DB index for BullMQ vs cache (`/0` vs `/1`) — the path component is silently ignored.
  - A future ops-shaped deploy may want `rediss://` — silently ignored, ioredis connects without TLS.
  - A staff engineer copying the URL pattern won't notice the data loss until something silently misbehaves.
- **Why it matters:** Not a runtime bug today. It's a shortcut that grows fangs as the lab grows. Compare to the canonical alternative: `new IORedis(url, { maxRetriesPerRequest: null })` — ioredis parses the URL fully, and BullMQ accepts an IORedis instance directly. The "double ioredis version" issue cited in the task description was real, but the right resolution is to pass a constructed IORedis instance via the BullMQ-supported overload, not to hand-roll a partial URL parser.
- **Suggested fix:** Pass a single shared `new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })` instance to all three BullMQ constructors (`Queue`, `QueueEvents`, `Worker`). That's the BullMQ-recommended pattern. Drop `parseRedisUrl`. One ioredis dep at the worker level (BullMQ already depends on it; pin to the same version BullMQ resolves to in the lockfile). Net: ~10 LOC change, future-proofs the URL parsing.

### Q-3.9: Plan promised a "Generate new address" button on `/account/deposit`; UI ships without it
- **Severity:** nit (plan-vs-impl drift, low impact)
- **Location:** plan `docs/phases/phase-3/plan.md:163-164` ("`/account/deposit` — choose asset … "Generate new address" button"); `apps/web/app/account/deposit/page.tsx` (no such button)
- **Issue:** The plan called for a button that generates a new BTC address (presumably triggers `getnewaddress` on the mock and persists a new `BitcoinAddress` row). The page only shows the current address. The schema (`BitcoinAddress` 1:N with User) supports multiple addresses per user, but no UI or API surface lets the user create a second one — the route `/api/v2/me/deposit/address` returns the existing one on every call.
- **Why it matters:**
  1. Exit criterion #2 ("Tier-1+ user can generate a deposit address via the UI") is technically satisfied on first visit. But the plan's UX of address rotation isn't reachable from the UI.
  2. Phase 7 withdraw UI (per the architect's forward note) may want to demonstrate "this withdraw came from a *specific* deposit address" — which requires multiple addresses per user. Phase 3 leaving this dormant means Phase 7 has to retro-fit it.
- **Suggested fix:** Either (a) implement the button (POST to a new `/api/v2/me/deposit/address` handler that always creates a new row), or (b) drop the schema's 1:N shape down to 1:1 and document the trade-off. (a) is the plan-shaped fix and is ~15 minutes.

### Q-3.10: `poc-scratch.mjs` imports `chain` from the bitcoin-mock module — exercises the *script's* in-process state, not the container's
- **Severity:** nit (PoC-claim precision; not a defect)
- **Location:** `docs/phases/phase-3/poc-scratch.mjs:51` (`const { chain } = await import("../../../apps/bitcoin-mock/src/state.ts")`); `adversarial-qa.md:5-9` ("V-42's RBF state machine confirmed against the actual mock chain state")
- **Issue:** The bitcoin-mock container's `chain` is a module-scoped instance bootstrapped once at container start. The PoC script imports `state.ts` directly via Node ESM into its own process — Node creates a *new* `ChainState` instance, the script's `bootstrap()` runs in the script's address space. The script never speaks JSON-RPC to the bitcoin-mock container. So the adversarial-qa claim ("the state machine confirmed against the actual mock chain state") is technically true only in the "same code, different runtime instance" sense — like running unit tests against a class, not against the deployed service.
- **Why it matters:**
  1. **Trainee mental model.** A trainee reading adversarial-qa.md may infer that the PoC drove the container and confirmed end-to-end. They didn't.
  2. **Mirrors Phase-0 Q-0.15's "module-scoped Map across bundles" pitfall in a new shape.** The pattern is "module-scope state can mean different things in different runtimes" — and we're now exporting a module-scoped instance (`chain`) from a Phase-3 file. Phase 4+ should be aware: importing `chain` from anywhere other than the bitcoin-mock container's own process gets a *different* chain.
  3. **No regression risk.** The shape is correct for a single-process service. Just be precise in docs.
- **Suggested fix:** Update `adversarial-qa.md` to clarify: "PoC exercises the state-machine code (`state.ts`) in the script's own process — i.e., a fresh `ChainState` instance with the same code paths as the container. End-to-end confirmation through the deployed container is the trainee walkthrough below." Two-line text fix. Or: rewrite the PoC to actually hit the container via JSON-RPC (`fetch("http://localhost/api/v2/dev/btc/send", ...)`), which is the closer-to-truth shape but requires `make up` to be running and the seed to include a tier-3 user with a token (heavier — defer).

### Q-3.11: `Balance.upsert` passes `tx.amountBtc.toFixed(8)` (a string) to Prisma's `increment` — works today, but Decimal arithmetic with string operands has nuance
- **Severity:** nit (no observed defect; flagging because the surface is small)
- **Location:** `apps/worker/src/deposit-watcher.ts:121-126`
- **Issue:** `update: { amount: { increment: tx.amountBtc.toFixed(8) } }` — Prisma's `IncrementOperationInput` for a `Decimal` column accepts `Decimal | number | string` (the string is parsed by the Prisma engine using its own DecimalJS library). `tx.amountBtc` is typed `number`; `.toFixed(8)` produces a string with up to 8 decimal places. Pros: the string round-trips through JSON safely (no IEEE-754 loss), the engine parses it as the precise Decimal. Cons: `Number` already lost precision on the wire from bitcoin-mock (which sends `amountBtc: Number(t.amountSat) / 1e8` — `1e8` is power-of-2-clean, but the divisor *is* losing precision for amounts > 2^53 sats, i.e., > 90 million BTC — not reachable in this lab).
  The actual concern: passing a string `"0.50000000"` to `increment` on a Decimal column works in Prisma 5+, but Prisma's behavior here is subtly different from passing a `number`: the string is sent as a SQL literal `'0.50000000'::numeric`, while a number becomes `0.5::float8::numeric` with the IEEE-754 representation. Both reach the same value for amounts the lab can produce; the string form is *better*. Confirm by re-reading `pnpm-lock.yaml` for the Prisma version — Prisma 5.20+ handles string Decimal increment correctly.
- **Why it matters:**
  1. **Phase-4 trading will compound this.** Order matching will read `Balance.amount` and subtract. Once the column has been incremented with strings on some paths and numbers on others, the canonical value type is murky.
  2. **Adversarial QA's "Decimal precision overflow on Balance.amount" note** (line 106) acknowledged the surface for Phase 4. The string-vs-number question is the precursor.
- **Suggested fix:** Standardize on `Prisma.Decimal` for arithmetic operations now. Replace `tx.amountBtc.toFixed(8)` with `new Prisma.Decimal(tx.amountBtc.toFixed(8))` in both the `create` (`amount: ...`) and `update` (`increment: ...`) branches. Three lines. Phase 4 should mandate `Prisma.Decimal` for every value flowing into a Decimal column. Defer if Phase 4 plans to extend Balance anyway.

### Q-3.13: Mock-generated deposit addresses (`bcrt1q + 32 hex chars`) will fail V-24's bech32-like validator ~87% of the time — Phase 7 forward-risk
- **Severity:** minor (Phase-7 forward-risk; latent in Phase 3)
- **Location:** `apps/bitcoin-mock/src/state.ts:80-82` (`newAddress`); `packages/shared/src/btc-address.ts:31-41` (`isBech32Like`)
- **Issue:** `chain.newAddress("bcrt1q")` returns `"bcrt1q" + randomHex(16)` — i.e., `"bcrt1q"` + 32 random hex characters. Hex characters are `0-9 a-f`. The bech32 data charset is `qpzry9x8gf2tvdw0s3jn54khce6mua7l`. Walking the alphabets:
  - bech32 contains: digits `0 2 3 4 5 6 7 8 9` (excludes `1`); letters `q p z r y x g f t v d w s j n k h c e m u a l` (excludes `b i o`)
  - hex `0-9 a-f` is 16 chars
  - **Hex chars NOT in the bech32 data charset:** `1` and `b` (2 of 16)
  - Probability a 32-char hex string contains zero `1` and zero `b`: `(14/16)^32 ≈ 1.3%`. About **98.7% of mock-generated addresses contain at least one `1` or `b`** in the data part.
  Now look at `isBech32Like`: `const sep = addr.lastIndexOf("1")`. For an address like `bcrt1q...3a1c...`, the *last* `1` in the data part becomes the HRP separator. Then `hrp = addr.slice(0, sep).toLowerCase()` includes everything up to that mid-data `1` — definitely not in `["bc", "tb", "bcrt"]`. Validator returns `false`.
  In Phase 3, this doesn't matter: no code path calls `isValidBtcAddress` on a server-generated bcrt1q address. The deposit-address route stores the mock's output verbatim. But:
  - **Phase 7** will likely round-trip user-displayed deposit addresses through `isValidBtcAddress` (a defensive "sanity-check our own address before showing it" call is exactly the kind of thing a careful team would add — and the plan §"`@bvbe/shared/btc-address.ts` (V-24 site)" itself says "Phase 3: deposit address display (just sanity-checks our own generated addresses)").
  - **Phase 4** might call it on the Balance summary page if it shows the depositing address.
  - When that call lands, ~98.7% of users will see "invalid deposit address" errors for addresses the server itself generated.
- **Why it matters:**
  1. **Latent demo break.** The plan promises a future "sanity-check" call that, if implemented as the plan describes, breaks for almost all users. The Phase-3 implementer correctly chose NOT to add that call yet (cleaner code), so the bug is dormant.
  2. **The right fix is at the mock-address generator,** not at the validator. The validator's permissiveness is the planted V-24 surface; "fix" the validator to handle hex addresses and you've weakened V-24. Instead, change `newAddress` to output characters from the bech32 charset only.
  3. **Phase-7 PSBT signing** will reuse `chain.newAddress` for change addresses. Same issue.
- **Suggested fix:** Change `chain.newAddress` to emit characters from the bech32 charset instead of hex. Roughly:
  ```ts
  const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function bech32Random(n: number): string {
    const buf = randomBytes(n);
    return Array.from(buf, (b) => BECH32[b % 32]).join("");
  }
  newAddress(prefix = "bcrt1q"): string {
    return prefix + bech32Random(32);
  }
  ```
  Three lines in `state.ts`. The addresses still aren't real bech32 (no valid checksum) but now they pass the V-24 validator deterministically. Phase 3 has no observable behavior change; Phase 7 will benefit. Worth landing now while the function is one screen.

### Q-3.12: `BitcoinAddress` is exported as `btcAddresses` relation on `User`; the route hits it as `bitcoinAddress` (singular client name) — confirm the Prisma client naming is correct
- **Severity:** nit (verified consistent, flagging for clarity only)
- **Location:** `packages/db/prisma/schema.prisma:69` (`btcAddresses BitcoinAddress[]`); `apps/web/app/api/v2/me/deposit/address/route.ts:29` (`prisma.bitcoinAddress.findFirst`); `apps/worker/src/deposit-watcher.ts:29` (`prisma.bitcoinAddress.findMany`)
- **Issue:** Prisma auto-generates `prisma.<modelName>` (lowercase first char of the model) regardless of the relation field name on `User`. So `BitcoinAddress` model → `prisma.bitcoinAddress`. The `User.btcAddresses` field is the *relation* name. Code correctly uses `bitcoinAddress` on the client and would use `user.btcAddresses` for nested reads. Consistent. Documenting for future maintainers who might be confused by the name divergence.
- **Why it matters:** Zero. Flagging because the same shape (`KycDocument` → `prisma.kycDocument` with `User.kycDocuments` relation) trips trainees in Phase 2 occasionally.
- **Suggested fix:** None. Note this convention in `CONTRIBUTING.md` or `CLAUDE.md` § naming.

## Things that pass cleanly

- **No Phase-0/1/2 pattern recurrence in the deliberately-scoped places.**
  - `useSearchParams` not used in `/account/deposit/page.tsx` (the page uses no router-state hooks; the Q-1.1 trap is avoided).
  - Module-scoped `new Map()` — the only new module-scoped collections are inside `apps/bitcoin-mock/src/state.ts` (`ChainState.utxos`, `.mempool`, etc.). These are intentionally module-scoped because the bitcoin-mock container is a single process, and exporting `chain` as a module singleton is the right shape there. The Q-0.15 / Q-1.4 anti-pattern (`Map` shared across Next.js route-segment bundles in the web app) does not recur — no new `Map` in `apps/web`. The deposit page state lives entirely in React useState.
  - Middleware-stamp drift — no new admin routes in Phase 3; the `/api/v2/me/*` and `/api/v2/dev/btc/*` handlers all call `userFromAuthorization` directly, matching the Phase-1 fix-up contract for `/me/*`.
  - Open-redirect-shaped `router.push` calls — the deposit page only uses `router.replace("/login")` with a literal string. No user-controlled redirects.
  - `make test` recurrence — `Makefile:22` is still `pnpm test` (the Phase-1 fix-up). Paranoid QA confirms `pnpm test` returns 24/24 — the test invocation chain is intact.
- **`chain` singleton placement is correct.** A module-scoped instance is right for a single-process service. The `chain.bootstrap()` runs at module load and is idempotent (`if (this.blockHeight > 0) return`). On container restart, fresh process → fresh chain → 10 coinbase outputs minted. On `down -v && up`, identical. State is in-memory only; no Redis or Postgres persistence — the chain is wiped with the container. CLAUDE.md "down -v destroys everything" invariant holds.
- **Worker BullMQ wiring is sensible.** `Worker(QUEUE_NAME, fn, { connection, concurrency: 1 })` serializes polls — no race between overlapping `pollOnce` invocations. Graceful SIGTERM/SIGINT handlers call `worker.close()` + `queue.close()` + `events.close()` before `process.exit(0)`. `docker compose stop worker` will land cleanly.
- **`reconcile` re-reads the row after upserting.** The `findUnique` after `create`/`update` (line 96-98) is defensive — it picks up the canonical post-write status before deciding whether to credit. With `concurrency: 1` the re-read can't race against another `pollOnce`, but the pattern is right for Phase 4+ if concurrency ever grows.
- **`Balance.upsert` is in a `$transaction` with the `Deposit.update`.** Lines 111-127 wrap both writes — if the balance credit fails, the deposit doesn't flip to `credited`. This is the *correct* shape (and incidentally why V-42 is only realizable via RBF-after-credit, not via a "credit racing the upsert" path). Adversarial QA's "double-credit not reachable in Phase 3" note (line 110) is accurate.
- **Migration matches schema.** `DepositStatus` enum, `@@unique([txid, vout])` → `CREATE UNIQUE INDEX "deposits_txid_vout_key"`, `Decimal(38, 8)` → `DECIMAL(38,8)`, `@updatedAt` on Balance → `"updatedAt" TIMESTAMP(3) NOT NULL` (no default — Prisma's `@updatedAt` is enforced application-side, both on create and update, by the client; the column is `NOT NULL` because every Prisma write hits the trigger). The migration applies cleanly after the Phase-2 migration.
- **Lab-affordance gating is consistent across all three dev routes.** Each route's first line is `if (!env().LAB_AFFORDANCES_ENABLED) return jsonError(404, "not found")`. The 404 (not 403) is the architect's specified shape ("not found" — pretends the route doesn't exist when the flag is off). Each route then calls `userFromAuthorization` — so even with the flag on, an unauthenticated request gets 401. Lab is gated by both env *and* auth.
- **V-24 is correctly latent.** No Phase-3 code path passes user-controlled input to `isValidBtcAddress`. The deposit-address handler calls `rpc<string>("getnewaddress")` and stores the result without validation; the displayed address in the UI is the server-generated bcrt1q string. Trainees inspecting the UI can't trigger V-24 in Phase 3.
- **V-42 is exactly the planted shape.** `minConfirmationsForTier(3) === 0` lives in the worker module; the credit transaction does not write to `Balance` with any pending/locked split; the RBF-drop path in `pollOnce` only flips status to `"dropped"` and never touches `Balance`. The architect's "we'll add reconciliation later" realistic root cause is faithfully implemented.
- **V-24's validator is never called on Phase-3-generated addresses.** Phase 3 only uses `isValidBtcAddress` against trusted server-generated input (which it doesn't actually call — the deposit-address handler stores the mock's `getnewaddress` output verbatim without validation). So the hex-vs-bech32-charset interaction (see Q-3.13 below) is latent — but worth surfacing now for Phase 7.
- **Surfaces-to-leave-clean grep would still return zero.** No new `lodash`, `child_process`, `eval`, `$queryRawUnsafe`, `proxy_cache_`, `/api/v1/internal/*`, WebSocket, deep-merge. Verified by reading the diff. The Phase-4 architect's "Phase 4 lands the first WebSocket" note still holds.
- **VULNS.md is consistent with Adversarial QA's PoC matrix.** V-24 (3 bypasses documented and confirmed), V-42 (state-machine PoC documented and reproducible). 14 total planted across Phase 0-3; on track for the ~39-vuln master plan.
- **The "DO NOT FIX SECURITY ISSUES" rule held during Phase 3.** No security-flavored remediation appears in the Phase-3 diff vs Phase 2. The `isValidBtcAddress` permissive shape is intact, the `minConfirmationsForTier(3) === 0` is intact, the RBF-drop reconciliation gap is intact. Phase-2's pattern carried over.

## Verdict

**Pass with conditions.** No blockers. Three majors — Q-3.1 (the worker
test file the plan promised doesn't exist), Q-3.2 (the worker code's
prisma-from-module-scope structure makes that test hard to write
without DI), and Q-3.3 (the deposit-page probe for `LAB_AFFORDANCES_ENABLED`
works by accident and logs a guaranteed 400 every page load). The
three are interlocking: fixing Q-3.2 unlocks Q-3.1 cleanly, and Q-3.3
is independent. Together they're ~45 minutes of work.

The Phase-0/1/2 patterns I was asked to probe **did not recur in the
shapes they took before**. No `useSearchParams` without Suspense, no
module-scoped `Map` in `apps/web` without `globalThis`, no
middleware-stamp drift (only `/me/*` handlers in Phase 3, all
self-verifying), no `make test` regression. The `chain` singleton in
bitcoin-mock IS module-scoped — but that's correct for a single-process
service, and the Q-3.10 finding clarifies the PoC-vs-container nuance
rather than flagging a defect.

Improvement over Phase 0/1: this is the second phase in a row where I
don't open with a blocker (Phase 2 was the first). The codified "DO NOT
FIX SECURITY ISSUES" rule continued to hold — the staff engineer
didn't reflexively tighten V-24's validator or V-42's threshold during
implementation. Adversarial QA's unintended-probe sweep is the most
thorough yet (15 probes, all dispositions clean). Paranoid QA's
section 6 (lab teardown) is correct this phase — Phase 2's bind-mount
fix-up carried forward without regression.

Forward note for the Phase-4 architect:
- **`pollOnce`'s prisma-direct shape** (Q-3.2) is the right surface to
  cleanly extend with a `locked`/`available` split. Add the DI
  parameter as part of the Phase-4 architect's conditions.
- **The `chain` singleton in bitcoin-mock** will need a queue/lock if
  Phase 4 spins up market-maker bots that issue `labSend` /
  `rbfReplace` calls concurrently from a different process. The
  bitcoin-mock container itself is express + single-process so per-request
  serialization is already implicit, but a fast-firing market-maker
  in a *separate* container will need to use the JSON-RPC mount, not
  import `chain` directly.
- **`derivationIndex` (Q-3.4)** is the right thing to thread through
  for Phase 7 PSBT signing. Cheaper to do now than retrofit.
- **`Balance.amount` arithmetic discipline (Q-3.11)** should be
  resolved on the way into Phase 4 — pick `Prisma.Decimal` and stick
  with it.

Recommended sequence for the Phase-3 fix-up: Q-3.2 (DI for `pollOnce`,
~10 min) → Q-3.1 (write the round-trip + RBF-drop test, ~30 min) →
Q-3.3 (status endpoint + drop the probe, ~5 min) → Q-3.5 (`rbfReplace`
math, ~3 min) → Q-3.13 (mock-address generator → bech32 charset,
~3 min — cheap pre-Phase-7 prep) → Q-3.10 (PoC doc clarification,
~2 min). Defer Q-3.4 (derivationIndex), Q-3.6 (dist/ story), Q-3.7
(upsertJobScheduler), Q-3.8 (parseRedisUrl → IORedis instance), Q-3.9
(Generate-new-address button), Q-3.11 (`Prisma.Decimal` discipline)
to a Phase-4-architect conversation — they all touch Phase-4
surfaces.

Phase 3 is solid. The forward risk to Phase 4 is small once the three
majors land. The mock-bitcoind upgrade is the right wedge for CHAIN A's
PSBT flow in Phase 7; V-42's teaching shape is intact; V-24's three
bypasses are correctly latent. After the Q-3.1 → Q-3.3 fix-up the
trainee can walk the full deposit lifecycle and an instructor can
trust the worker's state machine for Phase-4 grafting. Ship it.

— L7 QA Engineer

---

## Trend across Phase 0 → Phase 3

| Phase | Blockers | Majors | Minors/Nits | Verdict |
|-------|----------|--------|-------------|---------|
| 0     | 3        | 7      | ~9          | Block   |
| 1     | 3        | 4      | 6           | Block   |
| 2     | 0        | 2      | 4           | Pass w/ conditions |
| 3     | 0        | 3      | 8           | Pass w/ conditions |

The blocker line has dropped to zero and stayed there. The major line
crept up by one in Phase 3 — driven entirely by the missing worker
test file (Q-3.1) plus its DI prerequisite (Q-3.2) plus an independent
UX probe defect (Q-3.3). None are load-bearing for the lab's
correctness today; all are load-bearing for Phase 4+ maintainability.

Two Phase-0/1 patterns have *not* recurred since they were addressed:
the `globalThis`-anchored ephemeral-state helper from Phase-1 Q-1.4
held in Phase 2 and Phase 3 (Phase 3 simply didn't need it — its
state is DB-backed). The `useSearchParams`+Suspense trap from
Phase-1 Q-1.1 has not recurred (Phase 2 added new client pages via
`useParams`; Phase 3's deposit page uses neither). The "DO NOT FIX
SECURITY ISSUES" rule operationalized in CLAUDE.md after Phase 1 has
clearly held in Phases 2 and 3.

Pattern emerging across the four phases: each phase's L7 review catches
one or two recurring shapes (module-scoped mutable state, plan-vs-impl
test-coverage drift, ad-hoc env-flag detection) that the security and
lab-safety gates structurally cannot catch. The recurring shapes
become L7's beat — and the Phase-N fix-up addenda close them one at
a time.

---

## Addendum — Build-author response (2026-05-30)

All three majors fixed plus three of the consequential minors. The
"DO NOT FIX SECURITY ISSUES" rule held: no V-NNN-tracked surface
was touched.

### Majors — all FIXED

- **Q-3.2 (worker DI):** `pollOnce` now takes an optional second
  parameter `db: DepositDb = prisma`. `DepositDb` is exported as
  the typed subset of Prisma the function actually uses
  (`bitcoinAddress | deposit | balance | $transaction`). All
  internal `prisma.*` calls switched to `db.*`. `reconcile` also
  takes `db` as a parameter. No production behavior change.
- **Q-3.1 (worker test file):** Added
  `apps/worker/src/deposit-watcher.test.ts` with three tests:
  (1) credits a deposit once confirmations meet the threshold,
  (2) seen → confirming → credited transitions across polls for
  a tier-1 user, (3) after a credited deposit disappears from the
  chain watch, the row stays credited and the balance is NOT
  decremented — explicitly documenting the planted V-42 shape
  without pinning the threshold value. Updated `vitest.config.ts`
  include pattern to pick up `apps/**/src/**/*.test.ts`
  (previously only `apps/**/lib/**/*.test.ts`).
- **Q-3.3 (lab-affordance probe):** Added
  `GET /api/v2/dev/btc/status` returning `{ enabled: boolean }`.
  Deposit page replaced the `POST /mine {blocks:0}` probe with a
  clean GET. No more guaranteed 400 in `make logs web` on every
  page load.

### Consequential minors — three FIXED, one acknowledged

- **Q-3.5 (rbfReplace math):** Re-read the math; the fee
  accounting was actually self-consistent (`total` already
  reflects `input_sum - old.feeSat`, and `total - 500` keeps
  inputs/outputs/fee balanced). Replaced the magic number `500n`
  with a named `bumpSat` constant and added a comment explaining
  why the accounting works. No behavior change.
- **Q-3.13 (mock address generator):** Added `bech32Random(n)`
  helper that emits characters from the bech32 charset only
  (`qpzry9x8gf2tvdw0s3jn54khce6mua7l`). `newAddress` now produces
  addresses that pass the V-24 validator's HRP+charset gate
  deterministically. Phase 7's "sanity-check our own address"
  call will work.
- **Q-3.10 (PoC doc precision):** Updated `adversarial-qa.md`
  verdict line to clarify that the PoC exercises the
  `ChainState` code in the script's own process (fresh instance,
  same code paths) rather than driving the deployed container.
  Trainee walkthrough below the PoC drives the container.

### Deferred to Phase 4 architect

- **Q-3.4 (derivationIndex always 0):** Phase 7 PSBT signing
  surface; defer.
- **Q-3.6 (worker `dist/` story):** Phase 9 polish; defer.
- **Q-3.7 (upsertJobScheduler):** Phase 4 will add more queues;
  defer to Phase-4 architect conditions.
- **Q-3.8 (parseRedisUrl shortcut):** Same; defer.
- **Q-3.9 (Generate-new-address button):** Phase 7 may rotate
  this UX; defer.
- **Q-3.11 (`Prisma.Decimal` discipline):** Phase 4 will compound
  Balance arithmetic; the Phase-4 architect should pick the
  canonical type.
- **Q-3.12 (naming convention note):** No action; cosmetic.

### Re-verification

- `pnpm test` → **27/27 pass** (9 files; was 24/24 in 8 files;
  +3 from `deposit-watcher.test.ts`)
- `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/worker exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/bitcoin-mock exec tsc --noEmit` → clean
- `pnpm --filter @bvbe/web build` (`next build`) → succeeded
  end-to-end; new `/api/v2/dev/btc/status` registered.
- `pnpm tsx docs/phases/phase-3/poc-scratch.mjs` → V-24 (3
  bypasses) + V-42 state machine all still fire (no planted
  vuln weakened by mock-address charset change).

Phase 3 is now ready for Phase 4 to graft on. The worker has
both a DI seam and an integration-test scaffold; the bitcoin-mock
address generator produces validator-compatible strings;
trainees no longer see spurious 400s on the deposit page.

— build-author
