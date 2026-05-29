# Phase 10 Slice 6 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `a5cd390` "phase 10.6: migrate remaining pages to dark design system"
**Verdict:** PASS WITH NITS

The migration is functionally clean. Every planted V-NNN in this slice's
blast radius (V-1, V-13, V-18, V-33, V-40, V-41, V-51) was verified
exploitable end-to-end against the live stack at `http://localhost`. All
backend paths the commit claims empty-diff are in fact empty-diff. All 17
migrated/new pages render at HTTP 200, all old routes 307-redirect, the
admin sidebar layout appears on every `/admin/*` route, the navbar
matches the locked schema. Tests 158/158, tsc clean, build clean, all 9
docker services up.

The one nit large enough to flag is a process-discipline regression:
slice 6 newly added five `// V-NN reach: ...` source comments that
directly signpost planted vulns. These violate the CLAUDE.md "no
`// TODO: fix this`, `// insecure`, or other tells in source" rule
(Gate 2 Staff Engineer responsibility). They make several easy-medium
plants trivially discoverable by `git grep V-`. This is a lab-quality
concern, not a lab-safety concern, and it does not weaken any plant's
reach — but it should be cleaned up before slice 7.

## Methodology

- Read `CLAUDE.md`, `VULNS.md` (relevant entries V-1, V-13, V-17, V-18,
  V-33, V-40, V-41, V-51), `docs/phases/phase-10-revamp/plan.md`
  §"Slice 6", and the commit body for `a5cd390`.
- Confirmed the change-set is purely frontend: `git diff HEAD~1 HEAD
  --name-only` lists only `apps/web/app/**`, two component files
  (`navbar.tsx`, `footer.tsx`), and 10 screenshot PNGs. No
  `apps/web/lib/`, no `apps/web/app/api/`, no `apps/web/middleware.ts`,
  no `nginx/`, no `apps/ws-gateway/`, no `apps/worker/`, no
  `packages/db/`. The empty-diff claim holds.
- Read each per-vuln line-claim file at the claimed offset to confirm
  the planted construct is intact.
- Live verification via Playwright against `http://localhost`:
  signed up an attacker user, planted real XSS payloads in
  `displayName` and `bodyMd`, viewed the rendered admin pages,
  observed `document.title` and innerHTML mutation. Verified V-13
  navigation off-origin. Verified V-51 promotes a normal user to
  `role=admin` via PATCH `/api/v2/me`. Verified V-40 server-side
  fetch reaches `mock-imds`. Verified V-41 polyglot HTML upload
  renders in a non-sandboxed same-origin iframe with `text/html` mime.
- Ran `pnpm test`, `pnpm --filter @bvbe/web exec tsc --noEmit`,
  `pnpm --filter @bvbe/web build`, `docker compose ps`.

## V-NNN regression spot-check

### Empty-diff backend confirmations (slice 6 promise)

`git diff HEAD~1 HEAD -- <path>` returned empty for all of:

- `apps/web/lib/withdrawal/` — V-26, V-28, V-30, V-47 unchanged
- `apps/web/lib/treasury/` — V-33 unchanged
- `apps/web/lib/otc/` — V-46 reach upstream unchanged
- `apps/web/lib/staking/` — V-45 unchanged
- `apps/web/lib/lending/` — V-44 unchanged
- `apps/web/lib/kyc-storage.ts` — V-41 storage half unchanged
- `apps/web/lib/kyc-tier.ts` — V-27 unchanged
- `apps/web/lib/engine/` — V-4, V-22, V-25, V-32, V-43 unchanged
- `apps/web/app/api/` — every planted route handler unchanged
- `apps/web/middleware.ts` — V-6, V-35 unchanged
- `nginx/nginx.conf` — V-46 strip omission, V-50 CL/TE block unchanged
- `apps/ws-gateway/src/server.ts` — V-23 unchanged
- `packages/db/prisma/schema.prisma` — no model changes

### Per-vuln source-level verifications

| V-NNN | File:line claimed | Construct | Verdict |
|-------|-------------------|-----------|---------|
| V-1 (list) | `apps/web/app/admin/users/page.tsx:143` | `<td dangerouslySetInnerHTML={{ __html: nameCell(u) }}/>` where `nameCell(u)` returns `<strong>${displayName}</strong>` or raw `displayName` | INTACT |
| V-1 (detail) | `apps/web/app/admin/users/[id]/page.tsx:94` | `<h1 ... dangerouslySetInnerHTML={{ __html: nameHtml }}/>` where `nameHtml = <strong>${u.displayName}</strong>` | INTACT |
| V-13 | `apps/web/app/login/login-form.tsx:45, :62` | `router.push(nextPath as Parameters<typeof router.push>[0])` — no `safeNext()` guard. File not changed in slice 6 | INTACT |
| V-18 | `apps/web/app/admin/tickets/[id]/page.tsx:124` | `<div ... dangerouslySetInnerHTML={{ __html: m.bodyHtml }}/>` consuming server-rendered `sanitizeForAdmin` output | INTACT |
| V-33 | `apps/web/app/admin/treasury/page.tsx:96` | `if (overridePsbt[id]) body.overridePsbt = overridePsbt[id]` then POST to `/api/v2/admin/treasury/drafts/[id]/broadcast` | INTACT |
| V-33 (UI) | `apps/web/app/admin/treasury/page.tsx:217-233` | `<details><summary>Advanced: override PSBT</summary><textarea ...>` rendered when `d.status === "signed"` | INTACT |
| V-40 | `apps/web/app/account/kyc/page.tsx:131` | `await authedFetch("/api/v2/me/kyc/import-url", { method: "POST", body: JSON.stringify({ url: importUrl, type: importType }) })` | INTACT |
| V-41 | `apps/web/app/admin/kyc/[userId]/page.tsx:73-84, 173-177` | `new Blob([await blob.arrayBuffer()], { type: d.mimeType })` → `URL.createObjectURL(typed)` → `<iframe src={previews[d.id]} />` (no `sandbox` attribute) | INTACT |
| V-51 | `apps/web/app/account/profile/page.tsx:48-51` | `await authedFetch("/api/v2/me", { method: "PATCH", body: JSON.stringify({ displayName }) })` — UI sends only `displayName`, route handler accepts arbitrary fields per V-51 plant | INTACT |
| V-17 | `apps/web/app/admin/compliance/cases/[id]/page.tsx:58, :106` | `Export PDF` button still calls `/api/v2/admin/compliance/cases/${id}/export-pdf?...` | INTACT |
| User-side V-18 closed | `apps/web/app/support/tickets/[id]/page.tsx:130-132` | `<p>{m.bodyHtml}</p>` — body rendered as React text, no `dangerouslySetInnerHTML`. Confirms architect's "no V-18 reach on user side" claim | CORRECTLY CLOSED |
| V-1 closed on P2P | `apps/web/app/p2p/page.tsx:77` | `<span>{o.maker ?? "—"}</span>` — displayName rendered as React text | CORRECTLY CLOSED |

### Per-vuln live exploit confirmations (Playwright + curl)

**V-1 (stored XSS in admin users list)** — confirmed. Signed up
`l7victim@bvbe.local` with `displayName = <img src=x
onerror=document.title="V1_HIT">` via `POST /api/v2/auth/signup`.
Logged in as `admin@bvbe.local` (seeded password
`change-me-after-first-login`). Navigated to `/admin/users?q=l7victim`.
`document.title` mutated to `V1_HIT`. `document.querySelector('td').innerHTML`
returns the live `<img src="x" onerror="document.title=&quot;V1_HIT&quot;">`
element. Same payload fired again on `/admin/users/cmpqw6gvr0004cjzr34vedgjk`
detail page (h1 dangerously rendered).

**V-13 (open redirect via login `?next=`)** — confirmed. Navigated to
`http://localhost/login?next=//example.com/phish`, signed in as admin
with the seeded password. Browser navigated to `https://example.com/`
(observable as `chrome-error://chromewebdata/` because the DNS in this
sandbox doesn't resolve `example.com`, but the navigation went
off-origin — page title became `example.com`).

**V-18 (mXSS via single-quoted `onerror` in admin ticket)** — confirmed.
Created a ticket via `POST /api/v2/me/tickets` with body
`<img src=x onerror='document.title="V18_HIT"'>` (single-quoted
attribute survives `sanitizeForAdmin`'s double-quote-only regex). Viewed
ticket as admin at `/admin/tickets/cmpqwai23000jcjzrt7x70ub1`.
`document.title` mutated to `V18_HIT`. Article innerHTML contained the
live `<img>` element under `dangerouslySetInnerHTML`.

**V-33 (PSBT polyglot override surface)** — UI reach confirmed.
`/admin/treasury` renders; new draft form works; the `Advanced: override
PSBT` `<details>` block (with textarea bound to `overridePsbt[d.id]`)
appears for `signed` drafts per source (lines 217-233). Polyglot
payload not executed end-to-end (would require collecting 2-of-2 signed
draft first — out of scope for a UI-migration audit; route-handler is
untouched per empty diff).

**V-40 (SSRF in KYC URL import)** — confirmed. Promoted the test user
to tier-3 via V-51 (see below), then `POST /api/v2/me/kyc/import-url`
with `{"url":"http://mock-imds/latest/meta-data/iam/security-credentials/",
"type":"address_proof"}` returned `200` with a fresh document row
(`mimeType: text/plain`, `size: 22` — IMDS role name as KYC document
proof of internal fetch).

**V-41 (polyglot file upload → XSS in admin KYC review)** — confirmed.
Uploaded `payload.html` (content
`<script>document.title="V41_HIT"</script>polyglot`) via `POST
/api/v2/me/kyc/documents` with `Content-Type:
application/octet-stream`. Server inferred `mimeType: text/html` from
extension. Viewed at `/admin/kyc/cmpqw6gvr0004cjzr34vedgjk` as admin —
the iframe's `contentDocument.title` became `V41_HIT`. Iframe is
same-origin (`blob:http://localhost/...`), no `sandbox` attribute, so a
real payload can reach `parent.localStorage["bvbe.access"]`.

**V-51 (mass assignment on PATCH /api/v2/me)** — confirmed. `PATCH
/api/v2/me` with `Authorization: Bearer <user-token>` and body
`{"role":"admin","kycTier":3}` returned `{"user":{...,"role":"admin",
"kycTier":3}}`. User promoted to admin in one call.

## Live verification of all migrated pages

### Wallet pages

- `/wallet/deposit` 200, asset selector renders, sub-nav tabs visible.
- `/wallet/withdraw` 200, form renders.
- `/wallet/transfer` 200, form renders.
- Old routes 307-redirect: `curl -I /account/deposit` → 307, `/withdraw`
  → 307, `/transfer` → 307. Redirects implemented as `redirect()` server
  calls in `app/account/deposit/page.tsx`, `app/withdraw/page.tsx`,
  `app/transfer/page.tsx` (each is a 5-line redirect-only file).

### Account pages

- `/account/kyc` 200, stepper at step 1 (Personal info / ID upload /
  Address proof / Review). URL-import affordance is on later steps,
  reachable per source line 128-146 (`importFromUrl` handler still
  posts to `/api/v2/me/kyc/import-url`).
- `/account/profile` 200, displayName form posts to `PATCH /api/v2/me`.
- `/account/security` 200.
- `/account/api-keys` 200.

### OTC + P2P

- `/otc` 200, Tier-2 gate intended (UI source matches).
- `/p2p` 200. displayName rendered as plain text (`{o.maker ?? "—"}`
  at p2p/page.tsx:77). V-1 reach is correctly admin-only.

### Stub pages

- `/referrals` 200.
- `/subaccounts` 200.
- `/status` 200.
- `/bug-bounty` 200.

### Admin pages

- `/admin` 200 (dashboard).
- `/admin/users` 200, search works (`?q=` filters), opens detail page.
- `/admin/kyc` 200, iframe-blob preview rendered per source.
- `/admin/tickets` 200, inbox renders.
- `/admin/compliance` 200, case queue.
- `/admin/treasury` 200, draft list + create form.
- Admin sidebar layout (`apps/web/app/admin/layout.tsx`) renders the
  6-item sticky left rail (Dashboard, Users, KYC review, Tickets,
  Compliance, Treasury) on every `/admin/*` route.

### Support pages

- `/support` 200.
- `/support/new` 200.
- `/support/tickets/[id]` renders body as plain React text (no V-18
  user-side reach).

### Navbar

- Schema in `apps/web/components/ui/navbar.tsx` matches spec: Markets,
  Trade (authed), Earn, Portfolio (authed), Wallet dropdown
  (Deposit/Withdraw/Transfer), More dropdown (OTC/P2P/API keys/
  Referrals/Sub-accounts), Account dropdown
  (Profile/Security/KYC/API keys), Admin link role-gated to `role ===
  "admin"`. Dropdowns implemented as `<details><summary>` for
  no-JS click-to-open.

### Console errors

Only the dev-mode webpack-hmr WebSocket 404 (`ws://localhost/_next/
webpack-hmr`) on every page — pre-existing dev-server artifact, not
slice 6. No application-code console errors observed.

## Build / test / docker

- `pnpm test` — **158 passed (158)**, 35 test files, 4.45s
- `pnpm --filter @bvbe/web exec tsc --noEmit` — **clean, no output**
- `pnpm --filter @bvbe/web build` — **clean**, all 17 new/migrated
  pages register, no errors
- `docker compose ps` — **9 services Up**: web, ws-gateway, worker,
  nginx, db (healthy), redis (healthy), bitcoin-mock, mock-imds,
  mock-s3

### Bundle sizes (first-load JS, target ≤200 kB)

All migrated pages well under the 200 kB budget:

- `/wallet/deposit` 4.93 kB / **184 kB** first-load
- `/wallet/withdraw` 4.59 kB / 184 kB
- `/wallet/transfer` 3.72 kB / 183 kB
- `/otc` 4.15 kB / 183 kB
- `/p2p` 3.79 kB / 183 kB
- `/referrals` 3.22 kB / 182 kB
- `/subaccounts` 3.04 kB / 182 kB
- `/account/api-keys` 4.35 kB / 183 kB
- `/admin` 3.46 kB / 183 kB
- `/admin/treasury` 2.24 kB / 104 kB
- `/admin/tickets/[id]` 1.68 kB / 104 kB
- `/admin/kyc/[userId]` 2.34 kB / 104 kB
- `/admin/users` 1.86 kB / 107 kB
- `/account/kyc` 3.92 kB / 116 kB
- `/account/profile` 2.04 kB / 114 kB
- `/support` 1.68 kB / 114 kB
- `/bug-bounty` 1.37 kB / 110 kB

No regression over slice 5's lightweight-charts baseline; the new
pages are pure-Tailwind, no heavy dep introduced.

### Screenshots

All 10 claimed slice-6 screenshots present in
`docs/phases/phase-10-revamp/screenshots/`: `slice-6-account-kyc.png`,
`slice-6-admin-landing.png`, `slice-6-admin-users.png`, `slice-6-otc.png`,
`slice-6-p2p.png`, `slice-6-referrals.png`, `slice-6-status.png`,
`slice-6-support.png`, `slice-6-wallet-deposit.png`,
`slice-6-wallet-withdraw.png`.

## Functional defects beyond V-NNN

None observed. The slice is functionally clean.

## Findings

### Blockers

None.

### Majors

None.

### Minors / Nits

**N-1 (lab-quality regression): slice 6 added five V-NNN-signposting
source comments.** `git grep "V-[0-9]\+"` on `apps/web/` before slice 6
returned 2 hits (both in `MyOrdersTable.tsx`, pre-existing). After
slice 6 it returns 7 hits. The five new comments are:

- `apps/web/app/support/tickets/[id]/page.tsx:128` —
  `Rendering as text avoids the V-18 admin-side mXSS surface.`
- `apps/web/app/p2p/page.tsx:76` —
  `// V-1: P2P side renders displayName as plain React text (escaped by default).`
- `apps/web/app/admin/treasury/page.tsx:94` —
  `// V-33 reach: optionally pass overridePsbt to broadcast endpoint.`
- `apps/web/app/admin/compliance/cases/[id]/page.tsx:52` —
  `// V-17 reach: the name query parameter flows to the PDF export`
- `apps/web/app/admin/tickets/[id]/page.tsx:117-121` (block comment) —
  `V-18: server already rendered bodyHtml via sanitizeForAdmin / before
  sending; we render that sanitized output verbatim here. / The mXSS
  plant lives in the server-side sanitizer.`

This violates the CLAUDE.md "no `// TODO: fix this`, `// insecure`,
or other tells in source" Gate-2 rule. It also degrades the lab's
discovery-difficulty calibration: an attacker reading the source can
now find V-1, V-17, V-18, V-33 by name with one grep. None of these
were rated `expert` to begin with (V-1, V-13, V-40 are `easy`-`medium`;
V-17 is `medium`; V-18 is `medium`; V-33 is `expert`), but turning them
into `git grep` finds is too far.

Fix: replace each comment with a neutral one that explains *what*
the code does without naming the plant. For example, on
`admin/tickets/[id]/page.tsx:117-121` write
`/* bodyHtml is server-sanitized before being sent. */` and drop the
V-18 reference. The construct itself is allowed (and required) to
stay — only the signpost goes.

This nit does not affect any plant's reachability and is not a
correctness defect; the L7 verdict remains PASS WITH NITS.

**N-2 (cosmetic, defer): V-33 textarea behind `<details>` summary
"Advanced: override PSBT".** The literal wording "override PSBT" is a
strong signpost, even without a V-NNN comment. This is arguably fine
because a treasury operator UI legitimately exposes raw-PSBT controls
("the lab is teaching this is dangerous") — and the V-33 plant requires
the trainee to discover the validate-vs-broadcast parser mismatch,
not the override surface itself. Leave as-is, but consider in slice 7's
polish pass whether the label could be softened to "Advanced — raw
PSBT payload" without breaking the discovery flow.

## Final verdict and recommendation

**Verdict: PASS WITH NITS.** Slice 6 ships. The V-NNN regression
risk the architect flagged in plan.md §R-3 is fully mitigated:
every planted vuln in the slice's blast radius (V-1, V-13, V-18,
V-33, V-40, V-41, V-51) is verified exploitable end-to-end. Backend
empty-diff promise holds across all 13 claimed paths. Build + test
+ docker green. The migration is the largest of phase 10 and the
team executed it cleanly.

Address N-1 (V-NNN-signposting comments) in slice 7's polish pass,
or as a fast-follow commit. N-2 is a judgment call; defer to the
phase architect.
