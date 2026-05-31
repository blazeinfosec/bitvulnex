# Phase 10 Slice 1 — L7 QA review

**Reviewer:** L7 staff/principal QA (independent)
**Date:** 2026-05-29
**Scope:** commit `7e4bbed` "phase 10.1: design system foundation + login/signup dark migration"
**Verdict:** PASS WITH NITS

## Methodology

Read:
- `CLAUDE.md` (no-fix rule), `VULNS.md` V-13/V-1/V-9/V-19/V-20/V-21/V-35/V-22 entries.
- `docs/phases/phase-10-revamp/plan.md` decisions ledger.
- `git show 7e4bbed --stat` plus per-file diffs for every touched file.
- Component library source: all 12 files under `apps/web/components/exchange/`.
- `apps/web/tailwind.config.ts`, `apps/web/styles/globals.css`, `apps/web/app/layout.tsx`.
- Chrome: `apps/web/components/banner/do-not-deploy.tsx`, `components/ui/navbar.tsx`, `components/ui/footer.tsx`.
- Login flow: `apps/web/app/login/page.tsx` + `login-form.tsx`. Signup: `apps/web/app/signup/page.tsx`.

Live verification (Playwright against `http://localhost`):
- Navigated `/login?next=//example.com/phish` and `/login?next=https://attacker.example`; inspected raw `next` capture via `browser_evaluate`.
- POSTed signup error paths via `fetch` against `/api/v2/auth/signup`.
- POSTed `admin@bvbe.local` login via `/api/v2/auth/login` to confirm auth surface.
- Reproduced `formatNumber` in an in-page evaluate to cross-check the smart-precision contract on 9 edge cases.
- Visited `/`, `/staking`, `/lending`, `/admin` and screenshotted to inspect dark-on-light contrast on unmigrated pages.
- Confirmed banner placement and console error inventory.

Commands run: `pnpm test` (104/104), `pnpm --filter @bvbe/web exec tsc --noEmit` (clean), `pnpm --filter @bvbe/web build` (succeeded), `docker compose ps -a` (all 10 services up, `db-migrate` exited 0 as expected).

## V-13 verification

**INTACT.** Plant integrity confirmed at source and runtime.

Source — `apps/web/app/login/login-form.tsx`:
- Line 14: `const params = useSearchParams();`
- Line 15: `const nextPath = params.get("next") ?? "/account";`
- Line 45 (password branch): `router.push(nextPath as Parameters<typeof router.push>[0]);`
- Line 62 (TOTP branch): same.

No allowlist, no `startsWith("/")` guard, no `safeNext()` helper, no URL parsing/normalization anywhere between `useSearchParams` and `router.push`. The `as Parameters<typeof router.push>[0]` is a TypeScript widen-cast — purely cosmetic, no runtime check.

Runtime — at `http://localhost/login?next=//example.com/phish`, `browser_evaluate` reading `URLSearchParams(location.search).get("next")` returns the verbatim string `//example.com/phish`. Same with `?next=https://attacker.example`. The SPA captures both attacker-controlled forms unchanged and will pass them to `router.push` on successful auth (admin login succeeds with `change-me-after-first-login`, status 200, JWT issued).

This is the textbook open redirect described in `VULNS.md` V-13. No regression.

## Login + signup functional verification

Login (live):
- `/login` renders dark card with `<Wordmark>`, two labeled inputs, yellow accent submit. `<DoNotDeployBanner>` present top + footer.
- Password POST `admin@bvbe.local` / `change-me-after-first-login` → 200 with `{access, refresh}`. No TOTP for seed admin.
- TOTP branch (`stage === "totp"`) renders its own dark card with a `font-mono tracking-widest` 6-digit input and `aria-label`. Code path inspected at lines 154-187.

Signup error paths (via API, all PASS):
- Duplicate `admin@bvbe.local` → **409** `{"error":{"message":"email already in use"}}` (P-1 fix preserved).
- Missing `displayName` → **400** `VALIDATION`.
- 3-char password → **400** `VALIDATION` (8-char minimum enforced server-side; UI also enforces via `minLength={8}`).
- 255-char email (250 a's + "@x.io") → **400** `VALIDATION` (P-8 254-cap preserved).

Accessibility (P-6 carryover):
- Both `/login` inputs have `<label htmlFor>` paired by id (`login-email`, `login-password`) and `autoComplete="email"`/`"current-password"`. Error block has `id="login-error"` + `role="alert"` and is wired to inputs via `aria-describedby`.
- Signup: `<label htmlFor>` for all three inputs (`signup-email`, `signup-display-name`, `signup-password`), `aria-describedby="signup-error"` on each input when error present, `role="alert"` on the error card, `autoComplete="new-password"`.
- TOTP branch: `<label htmlFor="login-totp" className="sr-only">` plus `aria-label="Authenticator code"`. Correct.
- Tab order is DOM-order natural (email → password → submit → forgot → signup-link).

## Component library audit

Per-component verdict (12 files in `apps/web/components/exchange/`, all re-exported from `index.ts`):

- **ArrowIndicator** (`ArrowIndicator.tsx`): inline SVG triangles `points="5,1 9,8 1,8"` / `"5,9 9,2 1,2"` plus a flat `<line>` for direction='flat'. `aria-hidden="true"`, `currentColor` fill so parent owns coloring. PASS.
- **BalancePill** (`BalancePill.tsx`): label + `<NumberCell>` + asset chip; uses `tabular-nums` via NumberCell. Border + bg tokens from new palette. PASS.
- **DataTable** (`DataTable.tsx`): generic `<T>` with `Column<T>`, sticky `<thead>` (`sticky top-0 z-10`), dark hover state, empty-state renders a single full-span `<td>`. `onRowClick` optional. PASS. **Nit (minor):** `Column<unknown>` cast in `alignClass` is technically a generic-erasure trick but harmless; no `any`.
- **EmptyState** (`EmptyState.tsx`): supports `action.href` (renders `<Link>`) OR `action.onClick` (renders `<button>`). a11y for the button uses `type="button"`. PASS.
- **NumberCell** (`NumberCell.tsx`): `font-mono tabular-nums`. Smart-precision verified against 9 cases (see below). PASS.
- **PercentChangeCell** (`PercentChangeCell.tsx`): sign always shown for non-negative via `value > 0 ? "+" : ""`; `value < 0` gets the natural `-` from `toFixed`. ArrowIndicator integrated. Buy/sell/mute color rules correct. PASS.
- **PriceCell** (`PriceCell.tsx`): `"use client"`, flash state cleared at 250ms via `setTimeout`, `useRef` tracks `lastSeen`, returns cleanup function. Uses `animate-flash-buy`/`animate-flash-sell` classes which map to `flashBuy`/`flashSell` keyframes in tailwind config. `prefers-reduced-motion` is handled globally in `globals.css:57-67`. PASS.
- **SideToggle** (`SideToggle.tsx`): `role="tablist"`, each button is `role="tab"` with `aria-selected`. **Nit (minor):** no `aria-controls`, no arrow-key navigation between tabs — full ARIA tabs pattern would expect arrow-key handling and `tabindex` management. For a 2-tab toggle this is borderline acceptable; would be a major flag for a deeper tab group. Acceptable for slice 1 scope.
- **Skeleton** (`Skeleton.tsx`): `aria-hidden="true"`, `animate-pulse` (Tailwind built-in), inline width/height styles. PASS.
- **StatCard** (`StatCard.tsx`): label / value / optional delta via PercentChangeCell / optional hint. `font-mono tabular-nums` on the big value. PASS.
- **TickerChyron** (`TickerChyron.tsx`): `useMemo` duplicates the list for seamless loop; `animate-marquee` (40s linear infinite). Pauses on hover via `group-hover:[animation-play-state:paused]`. `role="region"` + `aria-label="Market ticker"`. PASS. **Nit:** marquee duration is hard-coded 40s — fine for static data, will need parametrization in slice 2 when WS feed lands.
- **Wordmark** (`Wordmark.tsx`): inline SVG hexagon with linear-gradient #FCD535 → #F0B90B, diagonal slash, Bitvulnex text. `aria-hidden="true"` on the SVG. The wordmark is text-readable via the `<span>Bitvulnex</span>`, so accessible name comes from that. PASS.
- **index.ts**: re-exports all 12 components plus the `formatNumber` helper and `Column`/`DataTableProps`/`TickerMarket` types. PASS.

### NumberCell smart-precision contract (9 cases verified)

Reproduced the implementation in `browser_evaluate` to confirm:

| Input            | Expected      | Actual        |
|------------------|---------------|---------------|
| `"100"`          | `"100"`       | `"100"` ✓     |
| `"100.50"`       | `"100.5"`     | `"100.5"` ✓   |
| `"0.001"`        | `"0.001"`     | `"0.001"` ✓   |
| `"1000.00"`      | `"1,000"`     | `"1,000"` ✓   |
| `"1234567.89"`   | `"1,234,567.89"`| `"1,234,567.89"` ✓ |
| `"-0.5"`         | `"-0.5"`      | `"-0.5"` ✓    |
| `"0"`            | `"0"`         | `"0"` ✓       |
| `"67234.5"` dp=2 | `"67,234.50"`*| `"67,234.5"`  |
| `"not a number"` | `"not a number"`| `"not a number"` ✓ |

The slice-0 trim-the-decimal-point bug is NOT reintroduced. Sign handling is correct (separated before abs-toFixed). Thousands separators applied to integer part only. Non-finite fallback returns the raw string.

\* The `dp=2` case returns `"67,234.5"` because the smart-precision trailing-zero trim runs *after* `toFixed`. This means `dp` behaves as a *maximum* precision, not a target. **Minor**: rename the prop or document this — consumers expecting "force 2dp" won't get it. Not a defect, but a clarity nit.

## Tailwind config & globals.css audit

`apps/web/tailwind.config.ts`:
- `darkMode: "class"` ✓
- 17 of the locked palette table tokens present: `bg/bg-elevated/bg-hover`, `border/border-subtle`, `text/text-dim/text-mute`, `accent/accent-hover/accent-fg`, `buy/buy-dim`, `sell/sell-dim`, `warn`, `info`. ✓ **Naming nit:** the plan table calls the text-on-accent token `accent-text`; the config calls it `accent-fg`. The CSS classes consistently use `accent-fg` (login-form.tsx:134, signup/page.tsx:132, navbar.tsx:70, EmptyState.tsx:31/39). Consistent — but it doesn't match the plan ledger. Either update the plan or rename. Minor.
- Legacy `navy.*`, `danger`, `success` tokens preserved as documented for unmigrated pages. ✓
- `fontFamily.mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"]` ✓
- Custom keyframes: `pulse`, `flashBuy`, `flashSell` registered; animations `flash-buy` and `flash-sell` at 250ms. **Nit:** there is no `marquee` keyframe in the Tailwind config, but it IS defined in `globals.css:42-45` plus the utility class `.animate-marquee` at `:47-49`. Both work; just inconsistent placement.
- `boxShadow.elevated` present. ✓

`apps/web/styles/globals.css`:
- IBM Plex Mono 400/500/600 + Inter 400/500/600/700 `@fontsource` imports. ✓
- `color-scheme: dark`, body bg `#0B0E11`, text `#EAECEF`, `font-family: Inter`. ✓
- `.font-mono, .font-tabular { font-variant-numeric: tabular-nums; }`. ✓
- `@keyframes marquee` + `.animate-marquee`. ✓
- `prefers-reduced-motion` block at lines 57-67 sets `animation-duration: 0.01ms !important` globally AND `animation: none !important` on `.animate-marquee`. ✓

`apps/web/app/layout.tsx`:
- `<html lang="en" className="dark">`, body `bg-bg text-text font-sans`. ✓
- DO NOT DEPLOY banner rendered TOP and FOOTER on every page (since it's in the root layout). ✓

## Chrome restyle audit

- **Banner**: Present on every route (`/`, `/login`, `/signup`, `/staking`, `/lending`, `/admin` all confirmed via Playwright). Top + footer variants. Warn-yellow `text-warn` on `bg-bg-elevated` with `border-warn/40`. `role="alert"`. AlertTriangle icon. Text content preserved verbatim from pre-slice ("DO NOT DEPLOY — Bitvulnex is an intentionally vulnerable lab. ..."). ✓
- **Navbar** (`components/ui/navbar.tsx`): dark `bg-bg-elevated` with `border-b border-border`. Wordmark on the left. **All `href` values unchanged** vs pre-slice: `/account/trading/BTC-USDT`, `/lending`, `/staking`, `/otc`, `/p2p`, `/withdraw`, `/support`, `/about/changelog`, `/docs`, `/login`, `/signup`. Diff confirms only className tweaks. ✓
- **Footer** (`components/ui/footer.tsx`): dark `border-t border-border bg-bg-elevated`. Links: `/about/changelog`, `/docs`, `https://www.blazeinfosec.com/` (pre-existing Phase-0 marketing link with `rel="noopener noreferrer" target="_blank"` — not introduced by slice 1). ✓
- **Auth pages**: dark card on dark body. Wordmark, yellow CTA, red-tinted error card. ✓

## Pages not yet migrated

Spot-checked: `/` (landing), `/lending`, `/staking`, `/admin`.

- **`/`**: hero text "Trade Bitcoin and majors with desk-grade execution." renders in dark navy on a light card on a dark body — readable. "INSTITUTIONAL SPOT · MARGIN · OTC" pretitle in navy-300 is low-contrast but legible. The pair tiles ("BTC/USDT", "ETH/USDT" etc.) on the black band have **near-invisible price values** — the value-text is rendering in a very pale grey on white card on black band. Acceptable per slice 1 scope (slice 3 migrates these).
- **`/lending`**: data table values "0", "0.00%", "2.00%" are **rendering in extremely faint navy on white card** — practically unreadable for users not zooming in. See screenshot. The headers "ASSET / SUPPLIED / BORROWED / UTILIZATION / APY" are readable in navy-500/navy-700. Title "Lending" is navy-900 on white but the legacy `text-navy-700` body copy below is barely visible (it's blending with the white card on a black page; navy-700 → grey-ish at small text sizes).
- **`/admin`**: login redirect or admin gate, didn't dig.
- **`/staking`**: legacy light card on dark body, same pattern. The commit description acknowledges this: *"Landing + staking screenshots show the legacy light cards on the new dark body; not broken, just unmigrated — slice 3 covers them."*

Note: the lending-table low-contrast cell text is a pre-existing styling artifact, not a slice 1 regression. The dark body just makes it more visible. Slice 3 / Slice 6 explicitly migrate these pages. Flagged as a known-temporary blemish, not a defect.

## Regressions of planted V-NNN

**EMPTY.** No regressions.

Verified via `git show 7e4bbed -- <path>` returning no diff for:
- `apps/web/middleware.ts` (V-35 bypass) — untouched.
- `apps/web/app/admin/users/page.tsx` and `[id]/page.tsx` (V-1 XSS) — untouched.
- `packages/shared/src/jwt-v1.ts` (V-8 / V-9 / V-19 / V-20) — untouched.
- `apps/web/lib/env.ts` (V-9 `changeme` default) — untouched.
- `apps/web/app/api/v2/auth/refresh/route.ts` (V-21 refresh replay) — untouched.
- `apps/web/app/account/orders/edit-order.ts` (V-22 mass assignment) — untouched.

V-13 plant intact at source (login-form.tsx:15/45/62) and confirmed live via runtime capture of attacker-controlled `next`.

## Functional defects beyond V-NNN

- **None blocking.** No `any` types in the new components. `pnpm --filter @bvbe/web exec tsc --noEmit` is clean.
- **Console errors (live)**: only `WebSocket connection to 'ws://localhost/_next/webpack-hmr' failed: Error during WebSocket handshake: Unexpected response code: 404`. This is the Next.js dev HMR socket trying to upgrade through nginx which doesn't proxy `/_next/webpack-hmr`. Pre-existing dev-mode issue, not introduced by slice 1. Not user-facing.
- **`@fontsource/ibm-plex-mono` resolves in the docker container**: `pnpm --filter @bvbe/web build` succeeds and produces the static prerendered output; the `@import` statements in `globals.css` compile through PostCSS. No anonymous-volume masking issue observed.
- **Network requests on initial loads**: 13 static requests, no 4xx/5xx observed for the slice-1 surfaces (banner, navbar, footer, /login, /signup).
- **Marquee CPU**: subjective — single static loop at 40s linear, GPU-accelerated transform; no observable framerate drop on the landing page or any page rendering `<TickerChyron>`.

## Build / test / docker

```
pnpm test                                  → 28 files, 104 tests passed (3.63s)
pnpm --filter @bvbe/web exec tsc --noEmit  → clean (no output, exit 0)
pnpm --filter @bvbe/web build              → succeeds; routes prerendered + middleware bundled (39.9 kB)
docker compose ps -a                       → 10 services up (db-migrate Exited 0 as expected)
```

Screenshots claimed in commit message exist at `docs/phases/phase-10-revamp/screenshots/`:
- `slice-1-login.png`
- `slice-1-signup.png`
- `slice-1-landing.png`
- `slice-1-staking.png`

## Findings

### Blockers
*(none)*

### Majors
*(none)*

### Minors / Nits

- **N-1** `formatNumber` `dp` prop is a *maximum* precision, not a target — `formatNumber("67234.5", 2)` returns `"67,234.5"` not `"67,234.50"` because the trailing-zero trim runs after `toFixed`. Document or rename. (`apps/web/components/exchange/NumberCell.tsx:29-48`)
- **N-2** Token naming drift: plan table calls the text-on-accent token `accent-text`; Tailwind config and consumers use `accent-fg`. Consistent in code, inconsistent with the plan ledger. Update one or the other. (`apps/web/tailwind.config.ts:12` vs `plan.md` palette table)
- **N-3** `SideToggle` uses `role="tablist"` / `role="tab"` but doesn't implement arrow-key navigation or `tabindex` management of the WAI-ARIA tabs pattern. Acceptable for a 2-tab toggle; consider for the trading-view Limit/Market/Stop-Limit/OCO tab group in slice 4. (`apps/web/components/exchange/SideToggle.tsx`)
- **N-4** `marquee` keyframe lives in `globals.css` while the other keyframes (`flashBuy`/`flashSell`/`pulse`) live in `tailwind.config.ts`. Pick one location. (`apps/web/styles/globals.css:42-45` vs `apps/web/tailwind.config.ts:46-58`)
- **N-5** TickerChyron marquee speed is hard-coded `40s linear infinite`. Parametrize when slice 2 wires the live WS feed (need different cadence at different content lengths). (`apps/web/styles/globals.css:48`)
- **N-6** Legacy pages (`/lending`, `/staking`, `/`) have low-contrast light-on-light table values. Known-temporary per slice 1 scope; slice 3/6 will migrate. Calling it out so it's not lost in QA round-tripping.

## Final verdict and recommendation

**PASS WITH NITS.** Slice 1 ships the design system foundation cleanly. V-13 plant integrity is verified at both source and runtime. All four QA gates (architect → staff eng → adversarial → paranoid) implicit in the commit hold: planted vulns preserved, no unintended vulns introduced, lab-safety banners present everywhere, no real-money/PII paths touched. Tests 104/104, tsc clean, build succeeds, docker green.

The 6 minor nits above are all polish-grade — none are landing blockers, and none touch a planted-vuln surface. N-1 (the `dp` semantic) is worth a one-line JSDoc clarification before slice 2 starts consuming `NumberCell` with explicit precision props. N-3 (arrow-key tabs) becomes a real concern when slice 4 builds the trading-view type tabs; flag for that slice's architect review.

Recommend: merge to main, proceed to slice 2 (live mock feed + Markets page).
