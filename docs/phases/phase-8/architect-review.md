# Phase 8 — Architect Review (Gate 1)

> **Reviewer:** Senior Architect.
> **Date:** 2026-06-25
> **Verdict:** Approved with conditions.

## Scope assessment

Phase 8 is the **catalog-heavy** phase: 7 new plants land here,
versus 3-5 in the surrounding phases. That's a calculated choice
— admin/back-office surfaces are where the bug catalog
historically concentrates (XSS, SQLi, cmd injection, broken
function-level access, mass assignment). The build-author has
earned the trust to ship many plants in one phase: Phase 6 and 7
both passed L7 with zero regressions and clean implementations.

CHAIN A closes here. V-33 is the technical climax; V-6 is the
ergonomic key that unlocks the chain. After Phase 8, the only
missing piece is the JWT-signing-key discovery (Phase 9
git-history leak). The Phase-8 adversarial QA MUST run CHAIN A
end-to-end using the `.env.example` JWT secret as a stand-in
for the leaked key.

The carryover OTC double-fill closes here as a FUNCTIONAL FIX,
not a plant. Pin the test.

## Vuln placement review

Seven plants approved. Numbers V-1, V-6, V-11, V-12, V-17, V-18, V-34.

### V-1 — Stored XSS in displayName → admin panel (EASY)

**Approved.** Build-author's framing: admin user list + detail
pages render `displayName` via
`dangerouslySetInnerHTML={{__html: displayName}}`. Realistic
root cause: engineer wanted to show **bold name** for KYC-approved
users and reached for `dangerouslySetInnerHTML` to inject the
`<strong>` wrapper. The displayName itself is included raw inside
that wrapper.

**Architect adds**: the user-facing P2P trade detail page MUST
NOT have V-1 reach. P2P renders `displayName` as plain React text
(`{displayName}`) with React's default escaping. Asymmetric
surface — admin sees raw, users see escaped. Realistic for how
real teams ship admin panels in a hurry.

### V-6 — `/api/v1/internal/*` function-level access (EASY-MEDIUM)

**Approved.** Architect picks mechanism (a): the middleware
checks for the `x-bvbe-internal-trace` header on `/api/v1/internal/*`
paths and **skips JWT auth entirely** if the header is non-empty.
This is the cleanest "internal-only" pattern bypass.

**Realistic root cause:** the v1 API was deployed behind a
private VPC nginx that always set `x-bvbe-internal-trace` from
the internal LB. The team moved to a single public nginx and
forgot to either (i) strip the header from external requests, or
(ii) update the middleware to require something stronger
(e.g., mTLS client cert). Mechanism is identical in shape to
V-46 (OTC desk header) but lands on a different code path
(middleware vs route handler) — that's instructive duplication.

**Architect adds two structural conditions:**
1. The middleware MUST gate the bypass only for `/api/v1/internal/*`,
   not the whole v1 namespace. Other v1 routes (auth, etc.) keep
   their existing behavior.
2. The nginx config gains an explicit `proxy_set_header x-bvbe-user-id "";`
   and (separately) `proxy_set_header x-bvbe-desk-role "";` from
   Phase 6 — but **does NOT** strip `x-bvbe-internal-trace`. Two
   strip omissions in two phases — realistic. Don't add a comment
   to the nginx config saying "TODO: strip internal-trace."

### V-11 — SQLi blind / time-based in admin user search (EASY-MEDIUM)

**Approved with framing condition.** Build-author's framing:
a `?perf=1&q=...` mode in `/api/v2/admin/users/search` uses
`$queryRawUnsafe` with `q` interpolated directly. **Architect
condition:** the `perf=1` mode must look like an *optimization* —
its realistic root cause is "the ILIKE-based default search was
slow on large user tables, so a senior engineer added a
'performance mode' that builds the query via `$queryRawUnsafe`
with manual string concatenation for speed." The non-perf
default path remains safe (uses Prisma's `ILIKE`-based query
with bound parameters). The flaw is reachable only with
`perf=1` — discoverable via the API docs reading the optional
parameter, OR via reading the source.

### V-12 — SQLi 2nd-order via displayName in compliance report (HARD)

**Approved.** Build-author's framing matches the catalog:
`displayName` is escaped on insert (`/me/profile` PATCH uses
Prisma's parameterized update), but is interpolated unescaped
into a `$queryRawUnsafe` in `/api/v2/admin/compliance/report`.

**Architect adds the exact query shape:** the report builds a
GROUP BY query over `users` joined with derived metrics, with
`HAVING display_name LIKE '%' || ${user.displayName} || '%'`
substituted into a raw template. The flaw is that `displayName`
was stored verbatim (user controls every byte) and the report
splats it into the HAVING clause via `$queryRawUnsafe`. A user
who sets their displayName to `' OR (SELECT pg_sleep(5)) IS NULL --`
triggers a time-based blind injection when any admin runs the
report.

### V-17 — Cmd injection in PDF export (MEDIUM)

**Approved.** Build-author's framing: `child_process.spawn` with
`shell: true` and string-concatenated argv in the PDF export
endpoint at `/api/v2/admin/compliance/cases/[id]/export-pdf`.
Query parameter `name` is concatenated into the command string
without escaping.

**Architect adds:** the mock `pdftk` script at `scripts/pdftk-mock.sh`
MUST be a no-op that exits 0 (so the happy-path test passes).
The cmd injection's *effect* in the lab is observable via:
- A side-channel like `;sleep 5;` causing a measurable delay
- A reverse shell to a docker-network host (NOT to the real
  internet)

The lab does not require a working RCE primitive in any
trainee-reachable destination. **Document this in the V-17
entry's exploitation path** — Phase 9 paranoid QA will verify
no path-to-third-party exists.

### V-18 — mXSS in markdown support ticket (MEDIUM)

**Approved with sanitizer framing.** Build-author's framing:
admin ticket-thread renderer uses a hand-rolled sanitizer that
strips `<script>` tags via regex but mishandles template-literal
attribute sinks (`<img src=x onerror="alert\`1\`">`).

**Architect adds the sanitizer shape:** the sanitizer is a small
function `sanitizeMarkdown(md: string): string` that:
1. Calls `marked.parse(md)` to get HTML.
2. Runs `html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")` to strip script tags.
3. Runs `html.replace(/on\w+\s*=\s*"[^"]*"/gi, "")` to strip
   double-quoted event handlers.
4. Returns the result.

**The mXSS flaw**: step 3's regex matches `on*="..."` but NOT
`on*='...'` (single-quoted), AND NOT `on*=...` (unquoted),
AND NOT template-literal forms `on*={...}` (which become attribute
syntax through marked's HTML pass-through). A payload like
`<img src=x onerror='alert(1)'>` (single-quoted) passes the
sanitizer.

The user-facing ticket renderer at `/support/tickets/[id]` uses
a DIFFERENT renderer that calls `marked.parse(md)` then runs a
**proper** DOMPurify-equivalent (or just escapes HTML entirely).
The mXSS reaches only the admin renderer.

### V-34 — Prototype pollution → admin escalation (HARD)

**Approved with downstream-reader pick.** Build-author's framing:
deep-merge in `/api/v1/internal/trade-debug/replay` uses lodash
`_.merge`. **Architect adds the downstream reader:** the
`/api/v2/me` endpoint resolves the caller's role via:

```ts
const role = (claims as any).role ?? (claims as any).user?.role ?? "user";
```

That pattern doesn't reach the prototype chain on `claims`
itself. The architect prefers a SPECIFIC realistic reader:

The **JWT verification helper** in `apps/web/lib/auth.ts` returns
`UserClaims`; the role-check helper `requireRole(claims, "admin")`
does:

```ts
function requireRole(claims: UserClaims, required: string): void {
  const role = claims.role ?? "user";  // <-- doesn't reach proto chain
  if (role !== required) throw new RoleError(...);
}
```

That's not exploitable.

**Architect picks**: introduce a `featureFlags` resolver used by
the admin panel landing page. The resolver does:

```ts
function resolveFlags(claims: UserClaims): Record<string, boolean> {
  const flags: Record<string, boolean> = Object.create({});
  // Defaults come from the prototype chain; per-user overrides
  // come from claims.flags. This pattern looks careless because
  // it IS — Object.create({}) creates an object whose prototype
  // is the literal `{}` (Object.prototype). Polluted properties
  // on Object.prototype show through.
  for (const k of Object.keys(claims.flags ?? {})) {
    flags[k] = (claims.flags as any)[k];
  }
  return flags;
}
```

When `Object.prototype.adminPanel = true` is polluted via V-34,
`resolveFlags(claims).adminPanel` returns `true` for any user.
The admin landing page guards via `if (flags.adminPanel) showAdminNav()`.
With pollution, every user becomes an admin from the UI
perspective. **The API still requires `claims.role === "admin"`**
for actual admin actions, but: now the user can SEE the admin
nav and CLICK admin links, and certain admin sub-routes
(specifically `/api/v1/internal/*` via V-6 spoofable header)
become reachable.

**This is structurally weaker than the master-plan "trade
endpoint route reads polluted role" framing, but the architect
judges it MORE realistic for a real Node.js app.** Build-author
should adapt.

(Actually — on reflection, the architect prefers an even
simpler framing: the admin-panel landing page reads `userFlags`
on `/api/v2/me` response. The `/api/v2/me` endpoint builds
the response with a similar object-create-via-prototype pattern.
The polluted prototype reaches the response payload, the admin
nav opens for any user, and the user clicks through to admin
routes — most of which are properly auth-guarded, EXCEPT the V-6
`/api/v1/internal/*` routes which only need the header. Chain
V-34 → V-6 → reach all internal data. Stronger demo.)

**Final V-34 framing:** the user-flags endpoint in `/api/v2/me/flags`
(new) uses an unsafe object-create pattern. The
`/api/v1/internal/trade-debug/replay` lodash-merge pollutes the
prototype. The trade-debug endpoint requires the
`x-bvbe-internal-trace` header (V-6 reach). So **V-34 requires
V-6 to plant the pollution** in the first place. That makes V-34
a **chain step**, not standalone.

**Architect classifies V-34 as a CHAIN component** for "admin
nav exposure for non-admins" — useful for a separate
exploration story (not CHAIN A/B/C/D, but stand-alone enrichment).

### CHAIN A — Emergency-withdraw terminal endpoint

**Approved.** `POST /api/v1/internal/treasury/emergency-withdraw`
calls `broadcastDraft({draftId, broadcasterUserId, overridePsbt})`
where `broadcasterUserId` is forged from the (spoofable) header
mechanism. The endpoint requires a draft in `signed` status
(treasury operators must have collected 2 signatures first).
The chain:

1. Attacker finds JWT signing key (Phase 9 git history).
2. Attacker forges an admin JWT.
3. Attacker creates a treasury draft via legitimate admin path
   (or finds an existing signed draft via list endpoint).
4. Attacker signs the draft twice using their own forged
   admin/treasury JWTs. (Or uses a draft already signed by
   legitimate operators.)
5. Attacker calls
   `POST /api/v1/internal/treasury/emergency-withdraw` with
   `x-bvbe-internal-trace: 1` and a polyglot `overridePsbt`.
6. V-33's polyglot routes the broadcast output to the attacker
   address.

**Or simpler (V-6 + V-33 only, no V-34 needed):**
1. Attacker finds JWT key (Phase 9).
2. Attacker forges admin/treasury JWT.
3. Attacker creates draft + double-signs (uses two different
   forged JWTs, one per signer). Or uses existing signed draft.
4. Calls emergency-withdraw with polyglot.

The architect prefers the simpler chain (V-6 + V-33). V-34 is
an exploration enrichment not required for CHAIN A.

## Architect resolutions for the open questions

1. **V-6 middleware mechanism: option (a) — skip JWT entirely.** Approved.
2. **Emergency-withdraw: signed draft required.** Approved. Forces
   the attacker to either find a pre-signed draft or double-sign
   one using their own forged JWTs. Realistic.
3. **V-17: shell metacharacters via `shell: true`.** Approved.
4. **V-34 downstream reader: `/api/v2/me/flags`.** Approved (see
   architect's adjusted framing above).
5. **User freeze via `AdminAuditLog`.** Approved.
6. **V-12 report query: HAVING clause with displayName via
   `$queryRawUnsafe`.** Approved.
7. **OTC double-fill closure: pin the test.** Approved.
8. **V-1 admin-only scope.** Approved.

## Conditions for Gate 2 entry

1. ✅ `/api/v1/internal/*` routes go through a dedicated
   middleware path; the existing main `middleware.ts` for v2 is
   untouched.
2. ✅ The `x-bvbe-internal-trace` header strip is missing from
   `nginx.conf` (deliberately). The existing strips for
   `x-bvbe-user-id` (Phase 6) and `x-bvbe-desk-role` (Phase 6
   absence) are unchanged.
3. ✅ All admin routes go through `requireRole(claims, "admin")`
   (NOT `requireTreasury` — treasury is a separate role with its
   own gating). The role helper is `apps/web/lib/auth-role.ts`
   (new file).
4. ✅ The OTC double-fill fix wraps `acceptOtc` in
   `$transaction` with an `updateMany` predicated on
   `status: "quoted"` and `quoteExpiresAt > now`. Idempotent.
5. ✅ The PDF export's `pdftk-mock.sh` is committed and made
   executable in the docker image. Lab uses `/usr/local/bin/
   pdftk-mock` or similar.
6. ✅ Markdown sanitizer is in `packages/shared/src/markdown.ts`
   exporting both `sanitizeForAdmin` (V-18 vulnerable) and
   `sanitizeForUser` (strict, calls DOMPurify or escapes
   everything). Tests cover happy-path stripping of
   `<script>` only.
7. ✅ The `featureFlags` resolver lives at
   `apps/web/lib/feature-flags.ts` and uses the
   `Object.create({})` pattern. The `/api/v2/me/flags` endpoint
   reads it.
8. ✅ Trade-debug-replay endpoint at
   `/api/v1/internal/trade-debug/replay` uses
   `lodash.merge` (NOT the modular `lodash/merge` import — the
   bulky `lodash` import is the realistic "engineer reached for
   the full lib" pattern). Add `lodash` as a dep.
9. ✅ Phase 8 plants 7 new V-NNNs; total in VULNS.md reaches 33.
10. ✅ Migration name: `20260625000000_phase_8_admin_compliance_support`.

## Surfaces to leave clean — reaffirmed

- nginx CL/TE-tolerant directives (Phase 9 — CHAIN B step).
- The git history secret leak (Phase 9).
- Dependency confusion artifact (Phase 9).
- V-15 pinned vulnerable dep (Phase 9).
- Any `eval`/`node-serialize`/unsafe deserializers (never).
- KYC SSRF allowlist (Phase 2; CHAIN D component reachable from
  the KYC URL-import already planted).
- WebSocket gateway origin (Phase 4; V-23 already in place).

## Forward note for Phase 9

Phase 9 is the killer-chain verification + polish phase. It:
- Plants V-15 (vulnerable transitive dep with real CVE) in
  `package.json`.
- Commits a "removed" `.env.bak` file in git history containing
  the JWT signing key — discoverable via `git log --all -p`.
- Activates the nginx CL/TE block for CHAIN B (request smuggling
  → bypass auth middleware).
- Runs all four killer chains end-to-end with PoCs.
- Adds diegetic hints to `/about/changelog`.
- No new V-NNN beyond the supply-chain entries (V-15 + the git
  leak + dependency confusion).

Phase 8 must NOT pre-plant any of these.

## Forward note on chain reach

- **CHAIN A** (drain hot wallet): completes in Phase 8. Phase 9
  adds the git-history leak; the chain is then executable by a
  zero-knowledge attacker.
- **CHAIN B** (admin persistence): partially in place after
  Phase 8 (V-1 → admin XSS reach). Phase 9 adds the nginx CL/TE
  step + V-22 mass-assignment reach (already planted Phase 4).
- **CHAIN C** (mass liquidation): complete since Phase 5.
- **CHAIN D** (DB+KYC exfil): Phase 8 adds the `/api/v1/internal/users`
  endpoint which exposes the full user DB once V-6 is exploited.
  CHAIN D was originally framed via SSRF → IMDS → S3, but Phase 8
  effectively provides a SECOND PATH (V-6 → `/api/v1/internal/users`)
  that bypasses the SSRF step entirely. Architect blesses this:
  multiple paths to the same goal is realistic.

## Test discipline

- No `it.skip()` tests that signpost plants.
- Each happy-path test for an admin endpoint covers the SAFE
  default (non-perf search, non-injection name, non-mXSS markdown).
- One conservation/equivalence test in the OTC accept test
  pinning the FIX of the double-fill carryover.

## Gate 2 entry: GO

Build-author may proceed to Staff Eng implementation.

— Architect
