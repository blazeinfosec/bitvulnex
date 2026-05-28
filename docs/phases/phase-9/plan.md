# Phase 9 — Killer-chain verification, supply chain, polish

> Input to Gate 1. Phase 9 is the **final phase**. It does three
> things:
>
> 1. Plants the supply-chain entries that turn already-built primitives
>    into externally-reachable chains:
>    - **V-15** — Pinned vulnerable transitive dep with a real CVE.
>    - **V-48** — Git-history `.env.bak` leak containing the JWT
>      signing key (closes the last step of CHAIN A).
>    - **V-49** — Dependency confusion artifact (private-scope
>      package referenced without `.npmrc` pinning).
>    - **V-50** — nginx CL/TE-tolerant configuration activated
>      (CHAIN B step).
> 2. Walks all four killer chains end-to-end against a fresh
>    `docker-compose up` and records the PoCs in
>    `docs/phases/phase-9/adversarial-qa.md`.
> 3. Cleans up the Phase 8 L7 housekeeping items (V-34 PoC text
>    in VULNS.md, OpenAPI registry drift, balance-adjust 404,
>    navbar "Support" gating, admin landing Treasury sub-nav).
>
> No new V-NNN beyond V-15, V-48, V-49, V-50. Total: 37 plants.

## Goal

Phase 9 is **the finale**. After this phase:

- A zero-knowledge attacker (no insider access, no leaked
  credentials handed out) can read the repo and execute each of
  the four killer chains end-to-end against a fresh
  `docker-compose up`.
- The supply-chain trifecta — vulnerable dep, leaked secret in
  git history, dependency confusion — is in place.
- nginx is CL/TE-tolerant.
- The in-app changelog accrues diegetic hints that point trainees
  toward the planted catalog without naming it.
- The lab is "shipped." A Blaze pentester sitting down with a
  fresh checkout in CTF mode should be able to reach the
  easy/medium tier within a 2-day window without instructor
  hints.

## Deliverables

### V-15 — Vulnerable transitive dependency

Pin **`xml2js@0.4.23`** as a direct dep of `@bvbe/web`. CVE-2023-0842
is real: prototype pollution via `xml2js.parseString` when
attacker controls the XML structure. Reachable via a new
**"OFAC sanctions list import"** stub in the compliance module:

- `apps/web/lib/compliance/sanctions-import.ts` exports
  `importSanctionsXml(xml: string): Promise<{ entries: any[] }>`.
- Calls `xml2js.parseString` on the input.
- Hooked into the compliance UI as a "Beta" feature behind a
  `?beta=1` query param toggle on `/admin/compliance/cases`.
  The UI form accepts an XML blob and shows the parsed entries.
- Admin-only route at `/api/v2/admin/compliance/sanctions-import` (POST).

**Realistic root cause:** Compliance team requested an OFAC
sanctions-list importer as a future feature. Engineer pinned
xml2js@0.4.23 (the version on the docs site at the time of
research), wrote a minimal `parseString` integration, shipped it
behind a beta flag, and moved on. The CVE was published after
the integration shipped; no one ran `pnpm audit` against the
private repo before lab release.

**Exploitation:** prototype pollution via crafted XML reaches
the same `Object.prototype` surface as V-34's `for...in` reader
in `resolveFlags`. Two paths to the same pollution sink — V-34 via
hand-rolled deepMerge, V-15 via the published xml2js CVE.

### V-48 — Git-history JWT-key leak (`.env.bak`)

In a dedicated mid-Phase-9 commit, add a `.env.bak` file at the
repo root containing:
```
JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026
```
Then, in a follow-up Phase-9 commit, `git rm .env.bak` it. The
file no longer exists in HEAD but lives in git history.

**Discovery:** `git log --all -p -- .env.bak` shows the file's
contents. Or `git log --all --diff-filter=D --summary | grep delete`
to find deletions. Or just `git log --all -p | grep -i secret`.

**Realistic root cause:** Ops engineer needed a local config
for a one-off testing session, copied `.env` to `.env.bak`,
committed it by accident as part of a larger change, noticed in
review, removed it in the next commit — but the secret stays in
git history forever. Classic.

**CHAIN A:** the JWT secret discovered here is what an attacker
uses to forge admin/treasury JWTs. Without V-48, CHAIN A
requires insider access. With V-48, CHAIN A is fully external.

### V-49 — Dependency confusion artifact

Add a `package.json` reference to a private-scope package that
does NOT exist on the public npm registry, and DO NOT add a
`.npmrc` line pinning the scope to a private registry.

The candidate: `apps/web/package.json` gains a (commented-out
or unused) dependency entry for `@bvbe-internal/observability`.
But Phase 9 needs the package to actually be REFERENCED to be
realistic. Plan: add a stub
`apps/web/lib/observability.ts` that conditionally imports
`@bvbe-internal/observability` if available, and commits a
`package.json` entry under `optionalDependencies`. Build works
without the package; the dep-confusion vector is: an attacker
who publishes `@bvbe-internal/observability` to public npm will
get their package executed when a careless engineer runs
`pnpm install` outside the Blaze internal network.

**Realistic root cause:** the team's internal observability
package is hosted on Blaze's private npm registry. The repo was
never set up with a top-level `.npmrc` because "the build
machine has the right `.npmrc`." Anyone running the build
outside Blaze infra is vulnerable.

**Documentation only.** The actual attack requires publishing to
npm, which is out of lab scope. The PoC is the diff that shows
the missing `.npmrc` pin + the `optionalDependencies` reference.

### V-50 — nginx CL/TE-tolerant configuration (CHAIN B)

Phase 0's `nginx/nginx.conf` already has a comment
"Phase 9 will activate the CL/TE-tolerant block." Phase 9
delivers:

```nginx
# Header tolerance for legacy mobile-app clients that send both
# Content-Length and Transfer-Encoding. The upstream Node service
# handles both; let it decide. Documented under OPS-2024-117.
proxy_pass_request_headers on;
ignore_invalid_headers off;
underscores_in_headers on;
```

The CL/TE desync: when both headers are present, nginx prefers
`Content-Length` and forwards the full body to the upstream.
The upstream Node (Next.js) prefers `Transfer-Encoding: chunked`.
The "remainder" body after the chunked-terminator is treated as
the start of a *second* HTTP request by the upstream, smuggled
inside a legitimate first request.

**CHAIN B path:**
1. Attacker sends a smuggled request body that looks like a normal
   POST to `/login`.
2. The smuggled bytes form a second request: `POST /api/v1/internal/users/admin/promote` (hypothetical) OR — and this is the *real* CHAIN B step — `PATCH /api/v2/me` with `{role: "admin"}` (V-22 mass assignment on Server Action).
3. The smuggled request inherits the authenticated TCP connection
   from a legitimate user pipelined behind it.

**Realistic root cause:** ops added the directives to support
legacy mobile clients (one specific clue: "OPS-2024-117"), didn't
realize the desync risk, and the directives were never reviewed
by the security team.

### CHAIN A — Drain hot wallet (FINAL closure)

Walk end-to-end in `docs/phases/phase-9/adversarial-qa.md`:

1. `git log --all -p | grep -i jwt_secret` — find V-48's leaked
   secret.
2. Forge an admin or treasury JWT (HS256 with the leaked secret).
3. Use V-6 spoofable header (`x-bvbe-internal-trace: 1`) to reach
   `/api/v1/internal/treasury/emergency-withdraw`.
4. Construct a polyglot PSBT (V-33) routing one output to a
   "victim" addr (matching `intendedOutputs`) and a second to
   the attacker.
5. POST → validation passes (first envelope = victim) →
   broadcast uses last envelope (attacker) → mock node funds
   attacker UTXO set.

### CHAIN B — Become admin and persist (FINAL closure)

1. nginx CL/TE-tolerant block (V-50) enables the smuggle.
2. Smuggle `PATCH /api/v2/me` request with `{role: "admin"}` body
   into a legitimate user's connection (V-22 Server Action mass
   assignment).
3. The smuggled patch updates the user record. Attacker is now
   admin.
4. Plant a SECOND admin user via the now-reachable admin user
   management endpoints (V-1's reach lets the attacker plant a
   `displayName` payload too for persistence).
5. The attacker can now disable changelog content — but the
   changelog is a static file render; instead, demonstrate
   persistence by planting an admin row that survives a single
   `down` (no `down -v`).

### CHAIN C — Mass user takeover via oracle (already complete)

CHAIN C completed in Phase 5. Phase 9 just records the end-to-end
PoC: self-trade (V-25) → manipulated public-price cache →
liquidation worker flags positions → keeper claim (V-42 in name
only, actually the keeper rebate path) collects rebates.

### CHAIN D — Exfil DB+KYC (final closure)

1. Without V-48 leak: SSRF (V-40) via KYC URL-import →
   mock IMDS at 169.254.169.254 → mock S3 → download KYC bucket.
2. **Faster path**: V-48 → forge admin JWT → V-6 →
   `GET /api/v1/internal/users` returns the full user DB with
   password hashes, TOTP secrets, etc. CHAIN D in one curl.
3. Architect blessed the two-path setup in Phase 8.

### Diegetic hints in `/about/changelog`

Phase 9 entries in `CHANGELOG.md` add subtle hints. Examples:
- "Hardened the OTC accept handler against double-fill (Phase 8
  carryover). Audit recommendation: cross-check fee paths for
  similar concurrency issues."  (Hints at the V-46 surface area
  without naming it.)
- "Performance mode added to admin user search for >1M user
  tables. Use with care."  (Hints at V-11.)
- "OFAC sanctions importer beta now available under
  `/admin/compliance?beta=1`."  (Hints at V-15.)
- "Legacy mobile-app clients now supported on the public
  endpoint — see OPS-2024-117 for the nginx directive."
  (Hints at V-50.)
- "Internal LB header trust extended to the v1 namespace; ops
  should ensure `x-bvbe-internal-trace` is stripped at the
  perimeter." (Inverts V-6: tells you what *should* happen,
  implying it doesn't.)

### Phase 8 L7 housekeeping (must close in Phase 9)

1. **VULNS.md V-34 PoC text drift.** Update V-34's exploitation
   path to describe the NESTED payload form
   `{"config":{"a":{"__proto__":{...}}}}` — the top-level form is
   silently stripped by zod 3's `z.record(z.unknown())`. The
   plant is still exploitable; only the PoC text needs fixing.
2. **OpenAPI registry drift.** Plan promised 24 new endpoints;
   only 3 are registered. Phase 9 either:
   - Registers all 24 (correct course); OR
   - Accepts the registry as a "subset of endpoints surfaced via
     OpenAPI" (Architect to pick).
3. **balance-adjust 500 → 404 on nonexistent user.** Trivial fix
   in `apps/web/app/api/v2/admin/users/[id]/balance-adjust/route.ts`.
4. **Navbar "Support" anon gating.** Hide the link for
   unauthenticated visitors.
5. **Admin landing missing "Treasury" sub-nav link.** Trivial UI
   fix.

### Tests

- `packages/shared/src/markdown.test.ts` — already covers
  `<script>` and `on*="..."`. No change.
- `apps/web/lib/compliance/sanctions-import.test.ts` — happy
  path for benign XML; does NOT pin V-15's pollution behavior.
- `packages/shared/src/cl-te.test.ts` (new) — small unit test
  that demonstrates the upstream's preference for
  `Transfer-Encoding: chunked` when both headers are present.
  Frame as "HTTP header parsing compliance" not as smuggling.

### Mock IMDS service (CHAIN D enrichment)

The master plan refers to a mock IMDS at 169.254.169.254 for
CHAIN D. Phase 2 planted V-40 (SSRF in KYC URL-import); if the
mock IMDS isn't already wired into docker-compose, Phase 9 adds
it as a docker-compose service `mock-imds` listening on
`169.254.169.254:80` (via docker network alias) or simulated via
the bitcoin-mock container exposing a `/latest/meta-data/`
endpoint. **Open question for architect** — what's actually in
place from Phase 2?

## Open questions for the architect

1. **CHAIN B mass-assignment endpoint.** Plan refers to
   "V-22 mass assignment on Server Action" as the admin
   promotion step. Verify V-22's actual exploit surface is
   admin-promotion-compatible (i.e., the Server Action accepts
   `role` in its body). If not, plant a new V-NNN here OR
   re-route the chain through V-1 + V-22's actual reach.
2. **V-15 published-CVE choice.** xml2js@0.4.23 is the leading
   pick. Alternative: an older `serialize-javascript@3.0.0`
   (XSS) or `tar@4.4.x` (path traversal). xml2js fits the
   compliance "sanctions import" feature realistically.
3. **V-49 dependency confusion scope.** Documentation-only or
   plant a stub package on the local container's npm registry?
   Plan defaults to documentation-only — the attack vector is
   real but executing it requires publishing to public npm,
   which is out of scope for a single-host lab.
4. **CHAIN B persistence step.** Plan suggests planting a
   second admin user. Alternative: poison the seed data so a
   subsequent `down/up` re-creates the admin. Plan defaults to
   the seed-poison variant for stronger demonstration.
5. **`.env.bak` JWT secret value.** Use a specific value
   distinct from `.env.example`'s placeholder so the discovery
   is unambiguous. Plan picks
   `devsecret-do-not-use-in-prod-bvbe-2026`. Architect to OK.
6. **Two-commit vs one-commit git-history leak.** Two commits
   (add then delete) is the standard pattern. Plan picks two.

## Exit criteria

1. `docker-compose down -v && docker-compose up` brings up green.
2. CHAIN A end-to-end: zero-knowledge attacker → drains hot wallet.
3. CHAIN B end-to-end: zero-knowledge attacker → becomes admin
   and persists.
4. CHAIN C end-to-end: already complete; re-verified.
5. CHAIN D end-to-end: both paths (SSRF + V-6 shortcut) work.
6. `pnpm audit` reports the V-15 CVE.
7. `git log --all -p | grep JWT_SECRET` discovers the V-48 leak.
8. nginx CL/TE-tolerant block is active (V-50).
9. CHANGELOG.md gains the Phase 9 entry with diegetic hints.
10. Phase 8 L7 housekeeping (5 items) all closed.
11. VULNS.md reaches 37 entries.
12. `pnpm test` continues to pass (≥ 102; new tests may add a few).

## Surfaces explicitly left as final

No more planting after Phase 9. The lab is shipped.

## Lab readiness signoff (post-Phase 9)

- Each of the four killer chains has a step-by-step PoC document.
- Each PoC has been re-run against a fresh stack.
- README banner is in place.
- All UI pages have the DO NOT DEPLOY banner.
- CTF mode toggle works.
- `docker-compose down -v` destroys everything.
