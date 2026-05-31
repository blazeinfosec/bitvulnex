# Bitvulnex — End-to-End Functional Test Plan

> **Scope:** Functional verification of every user-facing surface in
> the Bitvulnex. **Out of scope:** verifying
> that planted vulnerabilities (V-NNN) are exploitable — that lives
> in each phase's `adversarial-qa.md` and in `HOLISTIC-L7-REVIEW.md`.
>
> This plan covers what the *legitimate* user sees and does. The
> goal is "no surprise broken buttons, no broken flows, no 500s,
> no missing data" — not "vulnerabilities are still exploitable."
>
> **Last refreshed:** 2026-05-29 (post phase-10-revamp).

## Table of contents

1. [Objectives](#objectives)
2. [Test environment](#test-environment)
3. [Test accounts](#test-accounts)
4. [Tier matrix](#tier-matrix)
5. [Smoke suite — 15 minutes](#smoke-suite)
6. [Full functional suites](#full-functional-suites)
   - [A. Authentication](#a-authentication)
   - [B. KYC](#b-kyc)
   - [C. Wallet (deposit / withdraw / transfer)](#c-wallet)
   - [D. Trading](#d-trading)
   - [E. Earn (lending + staking)](#e-earn)
   - [F. Margin](#f-margin)
   - [G. Portfolio + dashboard](#g-portfolio)
   - [H. P2P](#h-p2p)
   - [I. OTC desk](#i-otc-desk)
   - [J. API keys](#j-api-keys)
   - [K. Referrals](#k-referrals)
   - [L. Sub-accounts](#l-sub-accounts)
   - [M. Support tickets](#m-support-tickets)
   - [N. Admin surfaces](#n-admin-surfaces)
   - [O. Public + dev surfaces](#o-public--dev-surfaces)
7. [Cross-cutting suites](#cross-cutting-suites)
   - [P. Mobile (375×667)](#p-mobile)
   - [Q. Accessibility](#q-accessibility)
   - [R. Error paths](#r-error-paths)
   - [S. WS / real-time](#s-ws--real-time)
8. [Exit criteria](#exit-criteria)
9. [Out of scope](#out-of-scope)
10. [Appendix: test data conventions](#appendix-test-data-conventions)

## Objectives

This plan exists so that any reviewer — instructor, contributor,
release engineer — can answer "does the lab work end-to-end?"
without having to know the planted-vuln catalog. It is a
*regression net*: when phase 11+ work changes something, the
relevant section(s) tell you what to re-run.

Each test case has:

- **ID** — `<Suite>.<N>` (e.g. `A.3`, `D.12`).
- **Priority** — **P0** (must pass for the lab to ship), **P1**
  (must pass before external cohort), **P2** (nice to have; cosmetic
  or rare paths).
- **Pre** — preconditions (account tier, seeded state).
- **Steps** — what to do, in user terms.
- **Expected** — what should happen.
- **Edges** — adjacent cases worth checking in the same session.

## Test environment

- **Bring-up:** `docker compose down -v && docker compose up -d`,
  wait for `web` health check to pass.
- **Stack:** 9 services — `bitcoin-mock`, `db`, `redis`,
  `mock-imds`, `mock-s3`, `nginx`, `web`, `worker`, `ws-gateway`.
- **Base URL:** `http://localhost`.
- **Auth model:** access-token in `localStorage`; refresh-token
  cookie; bearer header for direct API.
- **Tests assume:** seed has run (`packages/db/prisma/seed.ts`
  populates synthetic users, market-maker accounts `mm.alpha` /
  `mm.beta`, base `Pair` + `MarketMaker` rows).

## Test accounts

Seeded by `packages/db/prisma/seed.ts` (synthetic; no real PII).
For external use, instructors mint additional accounts as needed.

| Account            | Email                              | Role     | KYC tier | Purpose                        |
|--------------------|------------------------------------|----------|----------|--------------------------------|
| `anon`             | —                                  | —        | —        | Unauthenticated browse / 401   |
| `T0` (just-signed-up)  | `linus.stroustrup.0@example.test`      | user     | 0        | Tier-0; password `lab-password-0` |
| `T1` (alan, in plan)   | `alan.hopper.14@example.test`          | user     | 1        | Tier-1; password `lab-password-14` |
| `T2`                   | (synth user at index 25)               | user     | 2        | Tier-2; password `lab-password-25` |
| `T3 whale`             | `whale1@example.test`                  | user     | 3        | Tier-3; password `Sup3rLong-Whale-Pass-001` |
| `admin`                | `admin@bvbe.local`                     | admin    | 3        | `change-me-after-first-login` |
| `treasury`             | `treasury@bvbe.local`                  | treasury | 3        | `change-me-after-first-login` |
| `compliance`           | `compliance@bvbe.local`                | compliance | 3      | `change-me-after-first-login` |
| `support`              | `support1@bvbe.local`                  | support  | 3        | `change-me-after-first-login` |
| `mm.alpha / mm.beta`   | `mm.alpha@bvbe.local`, `mm.beta@bvbe.local` | user | 3   | Market-maker accounts. **Do not touch** — destabilizes the seed market. |

**Whale accounts are not pre-funded with balance** — only `mm.alpha` /
`mm.beta` get seeded balances. To run trade/lend/stake cases, either:

1. **Admin-credit**: log in as admin, POST `/api/v2/admin/users/[id]/balance-adjust`
   with `{ asset, delta, reason }`. This is the fastest setup for tests.
2. **Deposit flow**: use `/api/v2/dev/btc/send` + `/api/v2/dev/btc/mine`
   to fund via a real (regtest) deposit. Slower but exercises C.2.

Common test credentials are in `packages/db/prisma/seed.ts`. Mint
additional accounts via `/signup` if a clean per-test fixture is
desired.

## Tier matrix

What each tier can do (used to validate gating in B.* and D.*):

| Action                            | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
|-----------------------------------|--------|--------|--------|--------|
| Browse markets, view book/chart    | ✅     | ✅     | ✅     | ✅     |
| Place spot trade                   | ❌     | ✅     | ✅     | ✅     |
| Place stop-limit / OCO advanced    | ❌     | ❌     | ✅     | ✅     |
| Deposit (crypto)                   | ✅     | ✅     | ✅     | ✅     |
| Withdraw — small (<$1k/day)        | ❌     | ✅     | ✅     | ✅     |
| Withdraw — large (>$1k/day)        | ❌     | ❌     | ✅     | ✅     |
| Internal transfer                  | ❌     | ✅     | ✅     | ✅     |
| Lend / borrow                      | ❌     | ✅     | ✅     | ✅     |
| Stake                              | ❌     | ✅     | ✅     | ✅     |
| Margin (open positions)            | ❌     | ❌     | ✅     | ✅     |
| OTC desk                           | ❌     | ❌     | ❌     | ✅     |
| P2P offers                         | ❌     | ✅     | ✅     | ✅     |
| Create API keys                    | ❌     | ✅     | ✅     | ✅     |
| Open support ticket                | ✅     | ✅     | ✅     | ✅     |

When a tier-gated action is attempted by a too-low tier, the UI
should show the existing **InlineMessage** "KYC Tier N required"
copy (anon users get the slice-7 sign-in CTA instead — see D.1).

## Smoke suite

Run this list (≈15 minutes) on any PR that touches a customer-facing
surface. If anything here fails, ship is blocked.

| ID    | Surface         | Case                                                                                                                                            | Priority |
|-------|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| SM.1  | Landing         | `GET /` → 200, DO NOT DEPLOY banner visible (top + footer), live ticker chyron updates within 5s.                                                | P0       |
| SM.2  | Auth            | Sign up new user, log in, log out, log in again. Verify access-token in localStorage between login and logout.                                  | P0       |
| SM.3  | Markets         | `GET /markets` → 200, ≥3 pair rows render with live last/24h-change/volume.                                                                       | P0       |
| SM.4  | Trade view      | `GET /trade/BTC-USDT` → 200, book + chart + form all render. WS pill is "live" within 3s.                                                        | P0       |
| SM.5  | Place order     | As `bob` (Tier 1): place a limit buy for 0.01 BTC at 0.5×last; verify it appears in "Open" tab; cancel it; verify it disappears.                | P0       |
| SM.6  | Wallet deposit  | As `bob`: navigate `/wallet/deposit`, request BTC address, verify a tb1*/bcrt1* address renders and copies to clipboard.                         | P0       |
| SM.7  | Earn            | `GET /earn` → 200, lending + staking sections both render with live APYs.                                                                        | P0       |
| SM.8  | Portfolio       | As `bob`: `GET /portfolio` → 200, equity curve renders (may be flat for new user), BalancesTable shows funded assets.                            | P0       |
| SM.9  | Admin           | As `admin`: `GET /admin` (direct URL — not in navbar) → 200, admin sidebar present, dashboard loads.                                            | P0       |
| SM.10 | Mobile          | At 375×667, hamburger opens MobileNav drawer, ESC + backdrop close work, links navigate.                                                         | P0       |
| SM.11 | Themed errors   | `GET /not-a-page` → themed 404 with Wordmark + CTAs.                                                                                             | P1       |
| SM.12 | OpenAPI         | `GET /api/openapi.json` → 200, valid JSON, contains DO NOT DEPLOY in `info.description`.                                                          | P1       |

## Full functional suites

### A. Authentication

| ID   | Pri | Case |
|------|-----|------|
| A.1  | P0  | **Signup happy path.** `/signup` with new email + 12+-char password → redirected to /login (or /account, depending on flow). User row exists in DB with `kycTier=0`. |
| A.2  | P0  | **Login happy path.** `/login` with seeded `bob` creds → redirected to `next` param or `/account`. Access token stored. |
| A.3  | P0  | **Logout.** `/account` → click "Log out" → access token cleared, redirect to `/` (or `/login`), subsequent authed API calls 401. |
| A.4  | P1  | **Password reset request.** `/forgot` with `bob`'s email → "If an account exists" message. Reset link printed to server console. |
| A.5  | P1  | **Password reset confirm.** Use the reset link from console → `/reset?token=…` → set new password → can log in with new password, old password fails. |
| A.6  | P1  | **2FA enroll.** `/account/security` → enroll TOTP → scan QR or copy secret → enter 6-digit code → 2FA confirmed. Subsequent login asks for TOTP. |
| A.7  | P1  | **2FA login.** Log out + log back in with 2FA-enabled account → prompted for TOTP → correct code → logged in. Wrong code → rejected with copy. |
| A.8  | P1  | **2FA disable.** With 2FA enabled, `/account/security` → disable 2FA after providing valid TOTP → next login skips TOTP step. |
| A.9  | P1  | **Refresh token rotation.** Let access token expire (or force via devtools); next authed request should silently refresh and succeed. |
| A.10 | P2  | **Invalid creds.** Login with wrong password → error InlineMessage, no token issued, no redirect. |
| A.11 | P2  | **Already-authed visiting `/login`.** Should bounce to `/account` or stay safely without breaking. |
| A.12 | P2  | **Cross-tab logout.** Log out in tab 1; tab 2 should reflect anon state on its next interaction (storage event). |

### B. KYC

| ID   | Pri | Case |
|------|-----|------|
| B.1  | P0  | **Tier-0 status.** `/account/kyc` as `alice` (T0) → page renders, shows "Tier 0" + CTA to upgrade. |
| B.2  | P0  | **Tier 0 → 1 (basic info).** Submit name, DOB, address → backend writes KYC profile → tier flips to 1 on next page load. |
| B.3  | P1  | **Tier 1 → 2 (document upload).** Upload synthetic ID image (`apps/web/uploads/` accepts) → admin queue picks up → admin approves → tier flips to 2. |
| B.4  | P1  | **Document import via URL.** `/account/kyc` → import-by-URL → enter a URL pointing at a synthetic file on `mock-s3` → file fetched into uploads. (V-40 surface; functional test asserts the happy-path import works.) |
| B.5  | P1  | **Admin KYC queue.** As `admin`: `/admin/kyc` → see pending submissions → click row → review documents → approve or reject. |
| B.6  | P1  | **KYC document render.** Admin viewing `/admin/kyc/[userId]` sees uploaded docs render (image/PDF) under the displayed user. |
| B.7  | P2  | **KYC tier change reflected across surfaces.** After approval, the affected user's `/trade` form unlocks the appropriate tier badge, `/wallet/withdraw` raises the limit, `/earn` enables actions, etc. |

### C. Wallet

| ID   | Pri | Case |
|------|-----|------|
| C.1  | P0  | **Deposit address generation.** As `bob`: `/wallet/deposit` → select BTC → click "Get address" → regtest address renders + copies. Refreshing the page returns the same address (sticky). |
| C.2  | P1  | **Deposit confirmation.** Send a regtest deposit to that address via `/api/v2/dev/btc/send` + `/api/v2/dev/btc/mine`. Within a few worker ticks, the deposit appears in `/portfolio` ActivityFeed and balance updates. |
| C.3  | P0  | **Withdraw submit (small).** As `bob`: `/wallet/withdraw` → select asset, paste a synthetic BTC address, amount within daily limit → submit → row appears in pending list. |
| C.4  | P0  | **Withdraw cancel.** Click "Cancel" on the just-submitted pending withdrawal → status flips to `cancelled`, locked balance returns to available. |
| C.5  | P1  | **Withdraw confirm + broadcast (treasury).** As `treasury`: `/admin/treasury` → see the draft → sign → broadcast → status walks through `signed → broadcasted → confirmed`. |
| C.6  | P1  | **Withdraw — over limit.** Tier-1 attempts withdraw > $1k/day → InlineMessage "Daily limit exceeded" or "Tier 2 required." |
| C.7  | P1  | **Internal transfer.** As `bob`: `/wallet/transfer` → send 0.001 BTC to `carol@example.test` → balance debited, recipient balance credited; transfer row in both users' ActivityFeed. |
| C.8  | P2  | **RBF bump.** As `bob`: trigger a pending withdrawal that supports RBF (or `/api/v2/dev/btc/rbf` for the lab affordance) → fee bump path completes. |
| C.9  | P2  | **Withdraw address validation.** Submitting an obviously malformed address (random letters) → frontend rejects before submit, or backend rejects with clear copy. |

### D. Trading

| ID    | Pri | Case |
|-------|-----|------|
| D.1   | P0  | **Anon view + sign-in CTA.** `/trade/BTC-USDT` as anon → book + chart render; OrderForm shows "Sign in to trade" panel + Sign-in / Create-account CTAs (per slice-7). |
| D.2   | P0  | **Tier-0 trade gate.** Tier-0 user sees "KYC Tier 1 required" InlineMessage in OrderForm; submit button disabled. |
| D.3   | P0  | **Limit buy place + appear in book.** As `bob` (T1): place limit buy at price ABOVE current best ask × 0.99 → order resting in book; appears in "Open" tab of MyOrdersTable. |
| D.4   | P0  | **Limit sell place + match.** As `bob`: place limit sell at price BELOW current best bid × 1.01 → order matches; appears in "Trades" tab; book updates. |
| D.5   | P0  | **Market buy fill.** As `bob`: market buy small qty → order fills against book; balance updates; row in Trades tab. |
| D.6   | P0  | **Cancel resting order.** Place limit, cancel via "Cancel" button → status `cancelled`, locked balance refunded to available. |
| D.7   | P1  | **Stop-limit place (T2 only).** As `carol`: place stop-limit; verify it appears as "open" pending stop trigger. As `bob` (T1): same attempt → "Tier 2 required." |
| D.8   | P1  | **OCO place (T2 only).** Same as D.7 for OCO order type. |
| D.9   | P0  | **Book renders live.** Subscribe via WS; place a new resting order; verify book updates within 1s. |
| D.10  | P0  | **Recent trades render live.** Trigger a market order; verify Trades tab and the in-page recent-trades component update within 1s. |
| D.11  | P0  | **Candle chart renders.** Chart shows ≥1 candle for the current pair; tf switch (1m / 5m / 1h / 1d) re-queries `/api/v2/public/chart/[pair]/[tf]` and re-renders. |
| D.12  | P1  | **MyOrders tabs.** Open / History / Trades / Positions tabs all render content for an account with relevant data; tabs are roving-tabindex keyboard navigable. |
| D.13  | P1  | **WS reconnect.** Kill the `ws-gateway` container; WsStatusPill flips to "reconnecting" (after 500ms debounce); restart the container; pill returns to "live"; subscriptions auto-restore. |
| D.14  | P1  | **BalancePill accuracy.** BalancePill on OrderForm shows current available for the side's quote/base asset; after a trade, it updates without page reload. |
| D.15  | P2  | **Pair switch.** Switch from BTC-USDT to a different pair via URL → book/chart/form all reset to the new pair without leaked state. |
| D.16  | P2  | **Fence-post boundaries (programmatic — already covered in `confirm.test.ts`).** Confirm-dialog triggers at exactly 10% slippage and at exactly $1000 notional. |

### E. Earn

| ID   | Pri | Case |
|------|-----|------|
| E.1  | P0  | **Earn dashboard renders.** `/earn` → unified lending + staking panels load; APYs in monospace; "no rewards yet" friendly copy when zero. |
| E.2  | P1  | **Supply (lend).** As `bob`: `/earn` → click "Supply" on USDT row → SupplyModal opens → enter amount → confirm → position appears in MyPositions; balance debited. |
| E.3  | P1  | **Withdraw supply.** Click "Withdraw" on a supply position → WithdrawModal → confirm → position reduced/removed; balance credited. |
| E.4  | P1  | **Borrow.** As `bob`: `/earn` → click "Borrow" on a supported asset → BorrowModal → enter amount under LTV limit → confirm → borrow position appears; balance credited. |
| E.5  | P1  | **Borrow over LTV.** Same as E.4 but request > LTV ceiling → modal shows error before submit, OR backend rejects with clear copy. |
| E.6  | P1  | **Repay.** As `bob`: open RepayModal on an existing borrow → enter amount → confirm → borrow reduced. |
| E.7  | P1  | **Stake.** As `bob`: click "Stake" on a staking program → enter amount → confirm → stake position appears. |
| E.8  | P1  | **Unstake.** Open UnstakeModal → confirm → cooldown or immediate (depending on program) → position reduced. |
| E.9  | P1  | **Claim rewards.** When `accrued > 0`: ClaimModal → confirm → reward credited to balance, accrued resets. When `accrued == 0`: ClaimModal shows friendly "no unclaimed rewards yet" copy (per slice-7 N-3 already-defer fix). |
| E.10 | P2  | **APY refresh.** Worker tick updates yield; reload `/earn` and verify the displayed APY moved (or stayed stable as expected). |

### F. Margin

| ID   | Pri | Case |
|------|-----|------|
| F.1  | P1  | **Margin transfer.** As `carol` (T2): `/account/margin` → transfer spot → margin → margin sub-account balance increases, spot decreases. |
| F.2  | P1  | **Open margin position.** Place a leveraged trade from `/trade/[pair]` (when wired through margin) → position appears in MyOrders "Positions" tab. |
| F.3  | P1  | **Close margin position.** Close a position → realized PnL credited/debited; position disappears. |
| F.4  | P2  | **Liquidation.** Force a position into liquidation territory via price manipulation (mock-feed knob, NOT V-25 self-trade — this is a function test, not an exploit test). Keeper claims liquidation; position closes. |
| F.5  | P2  | **Tier-1 attempt to margin.** `bob` (T1) navigates `/account/margin` → either redirected with a "Tier 2 required" message, or the page renders read-only. |

### G. Portfolio

| ID   | Pri | Case |
|------|-----|------|
| G.1  | P0  | **Empty-state.** As `alice` (T0, brand-new): `/portfolio` → WelcomeCard renders with onboarding steps; equity curve area shows empty-state hint. |
| G.2  | P0  | **Funded user.** As `bob`: `/portfolio` → equity curve shows ≥2 snapshot points; BalancesTable lists held assets with USD values; 24h delta computes. |
| G.3  | P1  | **Activity feed.** ActivityFeed shows recent deposit/withdraw/trade/transfer/lend/stake events with correct icons and timestamps. |
| G.4  | P1  | **Show-zero toggle.** BalancesTable "Show zero" toggle includes/excludes zero-balance rows. |
| G.5  | P1  | **Live update on trade.** Place a trade in another tab; `/portfolio` should reflect new balance/activity within one snapshot tick or on next navigation. |
| G.6  | P2  | **Activity "Load more".** Activity feed defaults to 50 rows; pagination/"Load more" (if implemented post-phase-10 N) returns additional rows. Currently capped — verify cap copy is present (slice-5 M-5 carry-forward). |
| G.7  | P1  | **Margin + lending in totals.** With open margin or lending position, equity total reflects them (slice-5 M-1 fix via `computeUserEquityUsd`). |

### H. P2P

| ID   | Pri | Case |
|------|-----|------|
| H.1  | P1  | **Browse offers.** `/p2p` → public offers list renders. |
| H.2  | P1  | **Create offer.** As `bob`: create an offer → offer appears in public list with bob's handle. |
| H.3  | P1  | **Accept offer.** As `carol`: accept bob's offer → trade row created; status `open`. |
| H.4  | P1  | **Mark paid.** Buyer marks paid → status `paid`. |
| H.5  | P1  | **Release.** Seller releases → status `released`; funds move. |
| H.6  | P2  | **Cancel before payment.** Cancel an `open` trade before mark-paid → status `cancelled`, escrow returned. |

### I. OTC desk

| ID   | Pri | Case |
|------|-----|------|
| I.1  | P1  | **Quote request.** As `dave` (T3): `/otc` → request quote for sell 1 BTC → quote returned with rate + expiry. |
| I.2  | P1  | **Quote accept.** Accept within expiry → trade executes; balance updates. |
| I.3  | P1  | **Quote expiry.** Wait past expiry → accept fails with "expired" copy. |
| I.4  | P1  | **Lower tier blocked.** `bob` (T1) attempts OTC → "Tier 3 required" or 403. |

### J. API keys

| ID   | Pri | Case |
|------|-----|------|
| J.1  | P1  | **Create key.** As `bob`: `/account/api-keys` → "Create" → name + permissions → secret displayed once (with copy + warning). |
| J.2  | P1  | **Use key.** Use the secret to authenticate a `curl` against any `/api/v2/me/*` → 200 with same data the web view shows. |
| J.3  | P1  | **Revoke key.** Click "Revoke" → key disappears; subsequent `curl` with that key → 401. |
| J.4  | P2  | **Per-key permissions.** Create read-only key; attempt POST → forbidden. |

### K. Referrals

| ID   | Pri | Case |
|------|-----|------|
| K.1  | P2  | **Referral link.** `/referrals` → user's referral link renders, copies to clipboard. |
| K.2  | P2  | **Refer new signup.** Open referral link in incognito, complete signup → referral attribution recorded. |
| K.3  | P2  | **Referral rewards (if any).** Confirm reward mechanic per current product spec. |

### L. Sub-accounts

| ID   | Pri | Case |
|------|-----|------|
| L.1  | P2  | **Create sub-account.** `/subaccounts` → new sub → list updates. |
| L.2  | P2  | **Transfer between subs.** Move balance between main and sub → both balances reflect. |

### M. Support tickets

| ID   | Pri | Case |
|------|-----|------|
| M.1  | P1  | **Create ticket.** `/support/new` → submit subject + body → ticket appears in `/support` list. |
| M.2  | P1  | **View ticket thread.** Click ticket → `/support/tickets/[id]` → conversation renders. |
| M.3  | P1  | **Reply.** Post a reply → renders inline within seconds. |
| M.4  | P1  | **Admin view + reply.** As `admin`: `/admin/tickets` → see queue → click → reply → status change (open / pending / closed). |
| M.5  | P2  | **Ticket status changes.** Admin sets status → user sees updated status in `/support`. |

### N. Admin surfaces

Admin pages are no longer linked from the public nav (per
2026-05-29 navbar cleanup). Reachable by typing `/admin` directly
or following an admin-internal link.

| ID   | Pri | Case |
|------|-----|------|
| N.1  | P0  | **Admin landing.** As `admin`: `/admin` → dashboard renders with stats and sidebar (Users / KYC / Treasury / Compliance / Tickets). |
| N.2  | P0  | **Non-admin blocked.** As `bob` (regular user): `GET /admin` directly → 403 / redirect to / with "admin only" message. (Functional access-control check, *not* an attempt to bypass middleware.) |
| N.3  | P1  | **Users list.** `/admin/users` → list renders with pagination. Click row → `/admin/users/[id]` detail. |
| N.4  | P1  | **User search.** Search by email / handle → results filter. |
| N.5  | P1  | **Freeze / unfreeze user.** `/admin/users/[id]` → Freeze → user state updates; user's authed flows respond appropriately on next request. Unfreeze restores. |
| N.6  | P1  | **Balance adjust (admin).** `/admin/users/[id]` → adjust balance with a reason → balance row reflects; ActivityFeed entry created. |
| N.7  | P1  | **KYC queue review.** `/admin/kyc` → pending queue → click row → see docs → Approve/Reject. |
| N.8  | P1  | **Treasury drafts.** `/admin/treasury` → list of drafts with statuses (pending / signed / broadcasted). Sign → status updates. Broadcast → status updates. |
| N.9  | P2  | **Treasury — advanced (override PSBT).** The `<details>` "Advanced — raw PSBT payload" surface is present (intentional, per slice-6 N-2 architect decision). |
| N.10 | P1  | **Compliance cases.** `/admin/compliance` → cases list → open one → see details → Resolve. |
| N.11 | P2  | **Compliance report.** `/admin/compliance` → "Run report" → results render. |
| N.12 | P2  | **Sanctions import.** `/admin/compliance/sanctions-import` → file upload UI present; happy-path benign XML import succeeds. |
| N.13 | P1  | **Tickets queue.** Covered by M.4. |

### O. Public + dev surfaces

| ID   | Pri | Case |
|------|-----|------|
| O.1  | P0  | **Markets API.** `GET /api/v2/public/markets` → 200, JSON with `markets[].{pair,base,quote,last,change24h,vol24h,high24h,low24h}`. |
| O.2  | P0  | **Chart API.** `GET /api/v2/public/chart/BTC-USDT/1m` → 200, JSON with candles. tf switch (`5m`, `1h`, `1d`) all 200. |
| O.3  | P0  | **Book API.** `GET /api/v2/public/book/BTC-USDT` → 200, bids+asks arrays. |
| O.4  | P0  | **Price API.** `GET /api/v2/public/price/BTC-USDT` → 200, last price. |
| O.5  | P1  | **Lending pools / staking programs.** `GET /api/v2/public/lending/pools` and `/staking/programs` → 200, list of supported assets. |
| O.6  | P1  | **P2P public offers.** `GET /api/v2/public/p2p/offers` → 200, public offers visible. |
| O.7  | P1  | **Treasury hot-wallet info.** `GET /api/v2/public/treasury/hot-wallet` → 200, displays the synthetic public hot-wallet balance. |
| O.8  | P1  | **`/docs`.** `GET /docs` → API docs render against the OpenAPI registry. |
| O.9  | P1  | **`/status`.** `GET /status` → status page renders; lights for each service. |
| O.10 | P2  | **`/bug-bounty`.** `GET /bug-bounty` → information page renders. |
| O.11 | P0  | **Health.** `GET /api/health` → 200 JSON. |
| O.12 | P1  | **OpenAPI JSON.** `GET /api/openapi.json` → 200, valid OpenAPI 3.x. |
| O.13 | P0  | **JWKS.** `GET /api/.well-known/jwks.json` → 200, valid JWKS. |
| O.14 | P2  | **Dev BTC affordances.** `/api/v2/dev/btc/{mine,rbf,send,status}` → respond appropriately (lab-only helpers). |

## Cross-cutting suites

### P. Mobile

Run every P0 + P1 surface at viewport 375×667. Specific cases:

| ID   | Pri | Case |
|------|-----|------|
| P.1  | P0  | **MobileNav drawer.** Hamburger opens drawer; ESC closes; backdrop click closes; Tab cycles within drawer; focus restores on close. |
| P.2  | P0  | **Trade view bottom sheet.** `/trade/[pair]` on mobile: bottom sheet for order form opens via toggle; chart + book stack vertically. |
| P.3  | P0  | **No horizontal scroll.** No page below 375 width should require horizontal scroll. |
| P.4  | P0  | **Modals fit viewport.** All modals (Supply, Borrow, Repay, Stake, Unstake, Claim, Withdraw, Confirm) fit and scroll within the viewport. |
| P.5  | P1  | **Markets header chips.** Markets page header pill row doesn't overflow. |
| P.6  | P1  | **Forms usable.** OrderForm, Withdraw form, KYC forms all usable with the mobile keyboard (inputs not hidden by the keyboard). |
| P.7  | P1  | **Status pills shrink-0.** WsStatusPill on trade view and Markets header pills don't get cropped. |

### Q. Accessibility

| ID   | Pri | Case |
|------|-----|------|
| Q.1  | P0  | **Skip to main.** Press Tab from any page; first focus is "Skip to main content"; activating jumps focus past the nav. |
| Q.2  | P0  | **Modal focus trap.** Open any modal (e.g. Confirm trade); Tab + Shift+Tab cycle within; focus does not escape; close restores focus to opener. |
| Q.3  | P1  | **Tab roving for tab UIs.** MyOrdersTable + MobileSecondary use `tabIndex={0}` for active, `-1` for inactive; arrow keys do not bind tablists in this codebase, only Tab/Shift+Tab. |
| Q.4  | P1  | **Focus-visible rings.** Tab to any interactive element shows accent-ring focus indicator. |
| Q.5  | P1  | **Aria labels.** Nav hamburger, modal close buttons, all icon-only buttons have `aria-label`. |
| Q.6  | P2  | **Screen-reader pass.** NVDA or VoiceOver navigation of `/`, `/markets`, `/trade/BTC-USDT`, `/portfolio`, `/earn` — landmarks, headings, button names are sensible. |
| Q.7  | P2  | **Color contrast.** Body text, link colors, button states all meet WCAG AA against the dark palette (already audited in design-system foundation). |

### R. Error paths

| ID   | Pri | Case |
|------|-----|------|
| R.1  | P0  | **404 themed.** `/not-a-page` → `not-found.tsx` with Wordmark + "Back to markets" / "Home" CTAs. |
| R.2  | P0  | **Error boundary themed.** Force a React error in a route (e.g. via injected throw in devtools) → `error.tsx` renders Wordmark + Try again + Back to markets. |
| R.3  | P1  | **API 500 surfaces friendly copy.** When a backend route throws, the client component shows an InlineMessage rather than a blank screen. |
| R.4  | P1  | **Network offline.** Kill the network (devtools throttle to offline) → trade view + portfolio show "reconnecting" pills, not blank states; restore network → state resumes. |
| R.5  | P1  | **401 silent gate.** Any authed table (`MyOrdersTable`, ActivityFeed, BalancesTable) when called as anon → empty state with "Sign in" copy, no console errors. |
| R.6  | P2  | **Form validation.** Each form rejects obviously-invalid input client-side first; server-side rejection still produces friendly copy. |

### S. WS / real-time

| ID   | Pri | Case |
|------|-----|------|
| S.1  | P0  | **Live ticker chyron.** `/` landing chyron updates every 2s with mock-feed prices. |
| S.2  | P0  | **Book + trades live.** Place an order in tab A; tab B's `/trade/[pair]` book + trades update within 1s. |
| S.3  | P0  | **Ticker:all subscription.** Markets page rows update live without page reload. |
| S.4  | P1  | **WS reconnect after gateway restart.** Restart `ws-gateway`; clients reconnect with exponential backoff (1s → 2s → 4s → … → 10s cap); subscriptions auto-restore. |
| S.5  | P1  | **Debounced "reconnecting" pill.** A brief WS bounce (<500ms) does NOT flicker the pill through "reconnecting" — debounce works (slice-7 nit closed). |
| S.6  | P2  | **WS token in query.** Authenticated subscriptions carry the access token via `?token=` (NOTE: this is V-23 plant — functional test only verifies the wire works, not that it's secure). |

## Exit criteria

The full plan passes when:

1. ✅ Smoke suite (SM.*) all P0 pass.
2. ✅ All P0 cases across A–S pass.
3. ✅ All P1 cases across A–S pass OR have a known-issue note in the run log with assignee.
4. ✅ Mobile (P.*) P0 + P1 pass on a real device or 375×667 emulator.
5. ✅ A11y (Q.*) P0 + P1 pass via keyboard-only walkthrough.
6. ✅ Tests: `pnpm -w run test` 164+/164+ green.
7. ✅ Build: `pnpm --filter @bvbe/web build` green.
8. ✅ Docker: `docker compose ps` 9/9 healthy.
9. ✅ TSC: all five workspaces `pnpm exec tsc --noEmit` exit 0.

Run frequency:

- **Smoke** — every PR touching a customer-facing surface.
- **Full** — every phase close (architect/adv/paranoid gates require it).
- **Mobile + A11y** — every UX change.
- **WS** — every change to `ws-gateway`, `worker`, or trading-client.

## Out of scope

This plan deliberately does NOT cover:

- **Planted-vuln exploit verification.** That lives in
  `docs/phases/phase-N/adversarial-qa.md` and the per-phase /
  cross-phase L7 holistic review. A V-NNN being intact is a
  separate property from "the feature works." (See `VULNS.md` and
  `HOLISTIC-L7-REVIEW.md`.)
- **Penetration testing.** Trainees do that — the four killer
  chains in `VULNS.md` are the headline objectives.
- **Performance / load testing.** No SLA defined for a lab.
  If a future phase introduces a real-time fairness requirement,
  add it here.
- **Cross-browser compatibility.** Lab is Chromium-first. If a
  cohort uses Firefox / Safari, add specific notes.

## Appendix: test data conventions

- **All emails end in `@example.test`** — never use real-looking
  domains in tests. The lab will not send mail; reset codes print
  to the server console.
- **All Bitcoin addresses are regtest / testnet.** The
  `bitcoin-mock` service treats them as such.
- **All API keys are minted per test session.** Don't persist
  keys across sessions; create / use / revoke within each case.
- **All synthetic documents are pulled from `mock-s3`** under
  the `kyc-bucket/` prefix.
- **`mm.alpha` and `mm.beta`** are reserved for the
  market-maker worker. **Do not** alter their balances, place
  manual orders as them, or transfer to/from their accounts —
  doing so destabilizes the seed market and may break book / chart
  / ticker tests.
- **Logout between accounts.** localStorage persists across
  pages; reusing a stale access token between accounts produces
  hard-to-debug 401s.
- **Tear-down.** `docker compose down -v` after a full run
  guarantees a clean baseline for the next run.

— End of plan.
