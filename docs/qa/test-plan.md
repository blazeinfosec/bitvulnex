# BVBE Live QA Test Plan

**Owner:** L7 QA Engineering
**Target:** Functional readiness for Docker local + VPS deploy
**Date:** 2026-05-28

## Scope and non-goals

This plan tests **functional correctness** of the Blaze Vulnerable
Bitcoin Exchange against a live `docker-compose up -d` stack via
Playwright. The lab is a deliberately-vulnerable training app; the
40 planted V-NNN entries in `VULNS.md` are intentional features
and are **out of scope** for this QA pass.

**In scope:**
- Every user-visible workflow renders, completes, and persists.
- Forms validate, submit, return success.
- Pages don't crash, throw uncaught errors in the console, or
  show stack traces to users.
- Background workers (deposit watcher, liquidation, yield accrual,
  withdrawal processor, staking rewards) process queues without
  silent failure.
- Inter-service plumbing works: web ↔ db, web ↔ redis, web ↔
  bitcoin-mock, worker ↔ db, ws-gateway ↔ redis, nginx ↔ web,
  web ↔ mock-imds, web ↔ mock-s3.
- Page-to-page navigation: every link in the navbar reaches its
  page; back/forward/refresh don't break state.
- Tab and session behavior: multi-tab login, single-session logout,
  refresh-mid-flow.
- Lab-safety banners present and visible on every entry point.

**Out of scope (planted features, ignore):**
- SQL injection in `?perf=1`, mass-assignment paths, XSS, CSRF,
  request smuggling, prototype pollution, JWT alg=none, etc.
- Any V-NNN listed in `VULNS.md`.
- Race conditions that ARE planted (V-28 withdrawal, V-32 OCO,
  V-45 staking claim, etc.) — these are *features*, not bugs.

**A bug found that maps to a V-NNN: file as informational, do not
fix.**
**A bug found that does NOT map to a V-NNN: that's a functional
defect; file and fix.**

## QA personas

### QA-1: Paranoid (no stone unturned)

A senior QA who assumes the team is hiding something. Approach:

- Probe every edge case the developer wouldn't think of: empty
  inputs, max-length inputs, Unicode payloads (the *safe* kind —
  not XSS, but emoji, zero-width spaces in usernames, BIDI),
  enormous numbers, negative zero, scientific notation, leading
  zeros, very large lists, very long sessions.
- Refresh the page mid-form-submit. Open the same page in two
  tabs. Hit the back button after a successful submit. Submit a
  form twice quickly (UI double-click).
- Network: throttle to slow 3G, drop offline mid-page, watch what
  the UI does. Disconnect and reconnect during a WS subscription.
- Console: any uncaught error, any React hydration mismatch, any
  failed fetch is a finding.
- Accessibility surface: tab through every page, verify focus
  states; aria attributes on form errors; alt text on icons.
- Long-running sessions: leave a page open for 10+ min and verify
  that polling, websocket subscriptions, JWT refresh, all keep
  working.
- Mobile viewport (375×667 — iPhone SE size) and 4K (3840×2160).
- Slow database / slow Redis simulation if possible.
- Cross-browser: at minimum Chromium; spot-check Firefox/Safari
  rendering on the key flows.

Findings are written to `docs/qa/paranoid-qa-report.md` with:
- Severity (Critical / High / Medium / Low / Cosmetic)
- Repro steps (numbered, deterministic)
- Expected vs actual
- Screenshot or console log evidence
- Map-to-V-NNN if applicable (mark as IGNORE)

### QA-2: Hardcore functional (happy paths + edge cases)

A senior QA who loves seeing the green path work but tests
every variation of every flow. Approach:

- Walk every user-visible feature end-to-end as a real user
  would. Sign up, verify email (lab is auto-verify), KYC tier
  upgrade, get a deposit address, simulate a deposit via lab
  affordance, place a trade (limit + market), open a margin
  position, supply to lending, stake, take an OTC quote, list
  a P2P offer, withdraw, internal-transfer.
- For each happy path, also test:
  - The empty/null/zero variant
  - The boundary (min order size, max leverage, exactly the
    daily limit, etc.)
  - The "I changed my mind" cancel path
  - The error path (insufficient balance, invalid address,
    wrong PIN, etc.) — verify the UI shows a useful error,
    not a stack trace
- Verify admin/treasury/compliance/support workflows:
  - Admin can search users, view detail, freeze, unfreeze,
    balance-adjust
  - Compliance can open a case, resolve it, run a report
  - Support can view tickets, reply as agent, change status
  - Treasury can create a draft, sign, broadcast
- Verify static pages: landing, /about/changelog, /docs swagger,
  /login, /signup.
- Verify navigation: every navbar link works, footer links work,
  back button works.
- Verify the "DO NOT DEPLOY" banner is visible at top + bottom on
  every page.

Findings are written to `docs/qa/functional-qa-report.md` with
the same schema as Paranoid.

## Severity classification (functional defects)

- **Critical**: blocks core workflow (can't sign up, can't
  log in, can't place an order). Ship blocker.
- **High**: degrades core workflow significantly (form
  submits but shows wrong success message; navigation
  goes to wrong page). Ship blocker.
- **Medium**: noticeable defect but workflow completes
  (error message text wrong; loading state flickers).
  Should fix before VPS deploy.
- **Low**: noticeable polish issue (button label misaligned,
  table row spacing inconsistent). Nice to fix.
- **Cosmetic**: not visible to most users (CSS class typo with
  no visible effect, dev-tools-only finding).

## Test environment

- **Stack**: `docker-compose up -d` from repo root. All 10
  services come up. Wait for `db-migrate` to exit success
  before considering web ready.
- **URLs**:
  - http://localhost — nginx → web
  - http://localhost/api/v2 — REST
  - http://localhost/ws — websocket gateway
  - http://localhost/docs — Swagger UI
  - http://localhost/about/changelog — diegetic hints
  - http://localhost/admin — admin panel
- **Seed users** (password `change-me-after-first-login` for all):
  - `admin@bvbe.local` (admin)
  - `treasury@bvbe.local`, `treasury2@bvbe.local`,
    `treasury3@bvbe.local` (treasury)
  - 50 synthetic users `ada.lovelace@bvbe.local` etc.
    (Tier-0 to Tier-3 distribution)
- **Lab affordances** (dev mode only): `POST /api/v2/dev/btc/send`,
  `POST /api/v2/dev/btc/mine`, `POST /api/v2/dev/btc/rbf` —
  simulate Bitcoin events without real chain.

## Execution

Two QA subagents run in parallel against the same live stack:

1. **Paranoid QA** — covers edge cases, error states, multi-tab,
   network, accessibility, console errors.
2. **Functional QA** — covers happy paths + edge cases of each
   feature end-to-end.

Each subagent writes its findings to its own report file. After
both report, the L7 (this document's owner) triages: planted
V-NNN findings are ignored; functional defects are fixed; a
final regression pass confirms the fixes.

## Success criteria (110% functional)

- Zero **Critical** or **High** functional defects.
- All **Medium** functional defects either fixed or explicitly
  accepted with a written rationale.
- All 10 docker services come up and stay healthy for ≥ 10
  minutes.
- Every navbar/footer link resolves to a page that renders
  without a console error.
- Every form has an explicit empty-input rejection (server-side,
  not just client-side disabled-button).
- Every page shows the DO NOT DEPLOY banner.
- The four background workers (deposit-watcher,
  liquidation-watcher, yield-accrual, withdrawal-processor —
  plus staking-rewards) log "ready" within 30s of start.
- `docker compose down -v` cleanly destroys all volumes; a fresh
  `up -d` re-seeds and re-runs migrations.

## Exit deliverables

1. `docs/qa/test-plan.md` (this document)
2. `docs/qa/paranoid-qa-report.md` (QA-1 findings)
3. `docs/qa/functional-qa-report.md` (QA-2 findings)
4. `docs/qa/qa-summary.md` (combined verdict + bug list + fix
   log + final ship-readiness call)
