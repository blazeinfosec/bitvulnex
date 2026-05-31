# Phase 12 — Paranoid QA (Gate 4) — Ledger-correction sign-off

**Scope:** Defensive/compliance audit of the documentation edits made after the
full live-exploitation pass (37/40 plants proven live). The edits correct the
ledger for three plants that did not fully reproduce live (V-15, V-26, V-50) and
add an edge-blunting caveat for V-35. Evidence and keep/remove rationale live in
`docs/exploitation/15-not-reproduced-assessment.md` and `docs/exploitation/README.md`.

**Verdict: PASS** — lab-safe, ledger matches reality, planted constructs intact,
edits are documentation-only.

---

## What was reviewed

- `VULNS.md` diff (the actual correction set).
- New exploitation dossier under `docs/exploitation/` (16 markdown tranches +
  `poc/` scripts), with focus on the three corrected entries and V-35.
- The code/config constructs the corrections describe, to confirm none were
  removed or "defensively patched."

## 1. Edits are documentation-only (no code/config diff from this pass)

The `VULNS.md` change is +10/-7 lines and is entirely prose:
- Cosmetic rename `BVBE → Bitvulnex` (intro + V-1 text).
- **V-35:** new "Edge caveat (live-verified)" paragraph — bypass is fully
  exploitable direct-to-app; through nginx the admin takeover is blunted because
  `nginx.conf:93` clears `x-bvbe-user-id`. Explicitly instructs: do NOT add
  `x-middleware-subrequest` to the strip list, do NOT remove the `x-bvbe-user-id`
  strip.
- **V-26:** new instructor repro note (UTC-midnight boundary; libfaketime guidance;
  do-not-touch-the-shared-VM-clock warning).
- **V-15:** re-scoped from "second route to V-34's prototype-pollution sink" to a
  pure SCA finding; privesc-chain framing explicitly **withdrawn**; "do NOT upgrade
  xml2js" preserved.
- **V-50:** new "Live-verified status" paragraph (misconfig present; nginx 1.25.5
  rejects CL+TE with 400; clean desync not reproduced); chain note clarifies CHAIN B
  terminal V-51 still closes independently. "Do NOT alter nginx.conf or
  docker-compose.yml" preserved.

The `docs/exploitation/` tree is new untracked markdown plus three `.mjs` PoC
scripts. No application source, Dockerfile, nginx config, Prisma schema, or
`package.json` was modified by this correction pass. (The repo working tree does
carry unrelated uncommitted phase-11 CTF tooling in `.ts/.tsx/.prisma`; those are
out of scope for this gate and were confirmed NOT to be any of the constructs the
corrections reference.)

## 2. Planted constructs still intact (no plant removed or weakened)

Verified the load-bearing code/config for every corrected/caveated entry is
present and unchanged:

| Plant | Construct | State |
|-------|-----------|-------|
| V-35 / V-50 | `nginx/nginx.conf` — `ignore_invalid_headers off` (:35), `proxy_pass_request_headers on` (:88), `proxy_set_header x-bvbe-user-id ""` (:93), CL/TE tolerance | unchanged |
| V-50 | `docker-compose.yml:36` — `NODE_OPTIONS: "--insecure-http-parser"` | unchanged |
| V-15 | `apps/web/package.json:30` — `"xml2js": "0.4.23"` (CVE-2023-0842 pin) | unchanged |
| V-26 | `apps/web/lib/withdrawal/limit.ts` (calendar-day UTC bucket) | unchanged |

`nginx.conf` and `docker-compose.yml` show an empty `git diff --stat` (untouched).
The corrections' "do NOT upgrade / do NOT alter" instructions are matched by
reality — nothing was patched to silence a finding.

`VULNS.md` still contains exactly **40** `### V-NN:` entries — no planted vuln was
dropped from the ledger.

## 3. Corrected entries describe true exploitability

Cross-checked each correction against the live-evidence assessment; the ledger
now matches what actually reproduced:

- **V-15** — Dep is genuinely vulnerable and audit-discoverable (`pnpm audit`) and
  reachable via the admin sanctions importer, but `sanctions-import.ts` reads
  `parsed.sanctions` without merging into a prototype-reachable sink; `/me/flags`
  stayed `{}`. Ledger now states V-15 is SCA-only and the privesc framing is
  withdrawn, correctly pointing the working prototype-pollution path to **V-34**.
  Accurate.
- **V-26** — Code-confirmed calendar-day bucket; only timing prevented a live demo
  (mid-day UTC run). Ledger now carries an honest instructor repro recipe. Accurate.
- **V-50** — Both misconfig halves live, but nginx 1.25.5 returns 400 on CL+TE, so a
  clean desync did not reproduce; CHAIN B terminal V-51 proven independently. Ledger
  now reflects "misconfig present; modern edge defends; smuggle env-dependent."
  Accurate.
- **V-35** (caveat, not a re-scope) — direct-to-app bypass works; edge blunts the
  takeover via the `x-bvbe-user-id` strip. Matches the shipped nginx behavior.

## 4. Lab-safety (the Gate-4 mandate)

- **No real secrets introduced.** The only secret-looking string is the planted
  fake `JWT_SECRET=devsecret-do-not-use-in-prod-bvbe-2026` (V-48), which already
  exists in `docker-compose.yml`; the docs document it, they do not introduce a new
  real secret. `CTF_SALT` appears only as the fingerprint `7a03f08f`, not its value.
- **No real PII.** All emails are RFC-reserved synthetic (`@example.test`,
  `attacker@evil.test`). Password hashes are truncated synthetic (`scrypt$17817ec7...`);
  `totpSecret` is `null`. No SSN/real-person data.
- **No mainnet / real-money path.** The single "mainnet" mention is impact prose;
  the only Bitcoin address in a PoC is regtest (`bcrt1q...`). No xprv/xpub, no PEM
  keys, no live RPC.
- **No third-party outbound calls.** PoC scripts (`forge-admin-jwt.mjs`,
  `forge-v1.mjs`, `_v33.mjs`) target `http://localhost` / the docker network only;
  no external URLs.
- **DO-NOT-DEPLOY framing intact.** `docs/exploitation/README.md` carries the
  "DELIBERATELY VULNERABLE LAB — DO NOT DEPLOY" banner at the top; root README and
  in-app banners are unchanged by this pass.
- **Doc claims verified, not fabricated.** Referenced V-48 history commits
  `193426c` and `e96ffd8` both exist in the repo.

## Blockers

None.

## Sign-off

Lab-safe (no new real secrets, PII, keys, mainnet path, or third-party calls;
DO-NOT-DEPLOY framing present). Ledger matches reality: all 40 plants still listed,
the three corrected entries (V-15, V-26, V-50) now describe true exploitability,
the V-35 edge caveat is accurate, and no planted construct was removed or patched.
Edits are Markdown/PoC-only. **Gate 4 PASS.**
