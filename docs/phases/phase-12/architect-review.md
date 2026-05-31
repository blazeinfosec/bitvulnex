# Phase 12 — Senior Architect review (Gate 1)

**Scope:** Ledger / documentation reconciliation after the full live-exploitation
pass. 37/40 plants proven live; 3 plants (V-15, V-26, V-50) did not fully
reproduce end-to-end, and V-35 was found edge-blunted. This phase is
**DOCUMENTATION / LEDGER ONLY** — no code or config changes. The planted
vulnerabilities are the product; nothing in `apps/`, `packages/`, `nginx/`, or
`docker-compose.yml` is touched.

**Evidence reviewed:**
- `docs/exploitation/15-not-reproduced-assessment.md`
- `docs/exploitation/README.md` (status index: 37/40 live, chains A/D full)
- `VULNS.md` entries V-15, V-26, V-35, V-50 (+ cross-refs V-34, V-51, V-6)
- `docs/instructor-manual/04-exploitability-audit.md`
- `nginx/nginx.conf` (load-bearing for V-35 and V-50)

**Verdict: APPROVED.** All four proposed dispositions are consistent with the
live evidence and the planted-catalog intent. Concrete edits applied below.

---

## V-15 — xml2js@0.4.23 (CVE-2023-0842) — KEEP, RE-SCOPE to SCA-only

**Disposition:** keep-with-adjustments.

**Validation.** The exploitation tranche confirms the dependency is genuinely
vulnerable and audit-discoverable (`pnpm audit`), and that the importer route is
reachable. It also confirms the privesc chain does **not** reproduce:
`apps/web/lib/compliance/sanctions-import.ts` reads `parsed.sanctions` and maps
it; it never merges the parsed object into a prototype-reachable sink, so
`__proto__` pollution stays local to the discarded `parsed` object and
`GET /api/v2/me/flags` stayed `{}` after every canonical payload. The previous
ledger claim that V-15 "reaches the same `Object.prototype → adminPanel` sink as
V-34" is **overstated against live code** and is withdrawn. V-34 remains the
real, proven prototype-pollution path and is unaffected.

**Catalog intent.** A vulnerable-dependency-on-a-reachable-path plant is a
legitimate, valuable SCA finding on its own — re-scoping does not weaken the
lab, it makes the ledger match reality. **No code change** (do not upgrade
`xml2js`; the vulnerable pin is the plant).

**Edits made:**
- `VULNS.md` V-15: Category → "Infra / Supply chain (SCA)". Rewrote
  **Exploitation path** to describe an SCA finding (audit hit + live
  reachability) and added a "Scope note (live-verified)" stating the privesc
  chain does not reproduce and V-34 is the working path. Rewrote **Chain
  membership** to "standalone SCA finding" and explicitly withdrew the
  second-route-to-V-34 framing; added "do not upgrade `xml2js`".
- `docs/instructor-manual/04-exploitability-audit.md` V-15 section: retitled to
  "SCA-only; re-scoped", added the live-verified re-scope paragraph pointing at
  V-34 as the real privesc path, kept the admin-reach caveat, added "do not
  upgrade `xml2js`".

---

## V-26 — UTC-midnight withdrawal-limit reset — KEEP AS-IS

**Disposition:** keep.

**Validation.** Code-confirmed: `apps/web/lib/withdrawal/limit.ts` truncates to
the UTC calendar day and the ledger is uniquely keyed `(userId, utcDate, asset)`,
summing only the current day's row. The limit is actively enforced live. The
flaw is unambiguous and genuinely exploitable; it only failed to reproduce in
the live pass because the run was mid-day UTC and the exploit fires across the
UTC-midnight boundary, and the tester correctly declined to manipulate the
shared Docker-Desktop/WSL2 VM clock.

**Catalog intent.** Classic calendar-day-bucket flaw; rolling-24h remediation is
a good blue-team exercise. No removal, no code change.

**Edits made:**
- `VULNS.md` V-26: added a **"Repro note (instructor)"** bullet — run near
  23:59Z then again just after 00:00Z for 2× the daily cap, OR pin web+worker
  with `libfaketime` at the boundary; explicit warning not to change the
  host/VM clock.

---

## V-35 — Next.js middleware subrequest bypass — KEEP, add edge-blunt caveat

**Disposition:** keep-with-adjustments.

**Validation.** Confirmed against `nginx/nginx.conf`: the `location /` block
clears `x-bvbe-user-id` (`proxy_set_header x-bvbe-user-id "";`, line 93) but does
**not** strip `x-middleware-subrequest`. This precisely supports the proposal:
the auth **bypass** passes the public edge, but the admin **takeover** is blunted
because the handler's attacker-chosen identity header (`x-bvbe-user-id`) is
blanked at the edge. Direct-to-app, the full takeover works. The plant is intact
and instructive — not broken.

**Catalog intent.** The CVE-2025-29927-shape bypass is the plant; the nginx
identity strip is part of the as-shipped surface (and itself the defense a real
team would have in place). Documenting the asymmetry prevents trainees/instructors
from mistaking the edge-blunting for a dead plant. No code change.

**Edits made:**
- `VULNS.md` V-35: added an **"Edge caveat (live-verified)"** bullet — fully
  exploitable direct-to-app; blunted through nginx because `x-bvbe-user-id` is
  cleared (nginx.conf:93) while `x-middleware-subrequest` passes; explicit "do
  not add `x-middleware-subrequest` to the strip list and do not remove the
  `x-bvbe-user-id` strip".
- `docs/instructor-manual/04-exploitability-audit.md` V-35 line: expanded to note
  the edge clears `x-bvbe-user-id` (nginx.conf:93), so the bypass passes the edge
  but the identity-dependent admin action is edge-blunted; fully exploitable
  direct-to-app; plant intact.

---

## V-50 — nginx CL/TE + `--insecure-http-parser` smuggling — KEEP, RELABEL

**Disposition:** keep-with-adjustments.

**Validation.** Both halves confirmed live: the three CL/TE-tolerant directives
in `nginx.conf` and `NODE_OPTIONS=--insecure-http-parser` on the `web` service
(the web log prints the insecure-parsing warning). A clean desync did not
reproduce: **nginx 1.25.5 rejects the CL+TE conflict with `400`** (RFC 7230
§3.3.3) before forwarding — the directives forward headers but do not disable
nginx's own conflict check. Obfuscation variants returned `400`/`501` or benign
pipelining. The modern edge defends V-50 analogously to V-35. CHAIN B's terminal
impact still closes via **V-51** (mass-assignment, proven live), so only the V-50
*delivery* step is environment-dependent.

**Catalog intent.** Both halves of the misconfig present and live = a valid
config-audit finding; the relabel makes the ledger honest about the modern-edge
defense without weakening the plant. A working end-to-end smuggle would require
pinning a deliberately-lenient edge (older nginx / different proxy) in front of
the lenient upstream — recorded as an **optional future infra choice, NOT done
now**. No change to `nginx.conf` or `docker-compose.yml`.

**Edits made:**
- `VULNS.md` V-50: added a **"Live-verified status"** bullet (both halves present;
  nginx 1.25.5 rejects CL+TE with 400; obfuscations fail/benign; working smuggle
  needs a lenient edge pinned, optional/future, not done; do not alter config).
  Expanded **Chain membership** to state CHAIN B's terminal impact closes
  independently via the proven V-51, only the V-50 delivery is env-dependent.
- `docs/instructor-manual/04-exploitability-audit.md` V-50 section: replaced the
  "timing-dependent" caveat with the sharper "nginx 1.25.5 rejects CL+TE at the
  edge (400)" finding; noted it is not a broken plant; recorded the lenient-edge
  option as optional/future; kept the raw-TCP demo prerequisites under that
  condition. Updated the **CHAIN B** status block to credit V-51 (proven) for
  terminal impact and mark V-50 delivery env-dependent.

---

## Constructs that MUST be preserved untouched (do NOT "fix")

- `apps/web/package.json` — `"xml2js": "0.4.23"` pin (V-15).
- `apps/web/lib/compliance/sanctions-import.ts` — the `parseString` integration.
- `apps/web/lib/withdrawal/limit.ts` — calendar-day bucket + `(userId, utcDate,
  asset)` unique key (V-26).
- `apps/web/middleware.ts` — the `x-middleware-subrequest` short-circuit branch
  and the `x-bvbe-internal-trace` bypass (V-35 / V-6).
- `nginx/nginx.conf` — the CL/TE-tolerant directives
  (`proxy_pass_request_headers on; ignore_invalid_headers off;
  underscores_in_headers on;`), AND the `proxy_set_header x-bvbe-user-id "";`
  strip on line 93. Do **not** add `x-middleware-subrequest` to the strip list.
- `docker-compose.yml` — `NODE_OPTIONS: "--insecure-http-parser"` on the `web`
  service (V-50).
- `apps/web/app/api/v2/me/route.ts` — the `PATCH` mass-assignment handler (V-51).
- `apps/web/app/api/v1/internal/trade-debug/replay/route.ts` +
  `apps/web/lib/feature-flags.ts` — the V-34 deepMerge → `resolveFlags` path
  (the real, proven prototype-pollution chain; unaffected by the V-15 re-scope).

## Exit criteria

- VULNS.md V-15/V-26/V-35/V-50 reflect live reality; no code/config edits.
- Instructor audit (`04-exploitability-audit.md`) V-15/V-35/V-50 + CHAIN B status
  aligned with the ledger.
- Ledger count unchanged at 40 plants; 37 proven live, 3 documented-not-fully-
  live (now accurately scoped), V-35 edge-blunt documented.
