# Phase 12 — Adversarial QA (Gate 3)

**Scope:** Documentation-only ledger correction following the full live
exploitation pass (37/40 plants proven live; evidence in
`docs/exploitation/`). Verify that (a) the planted-vuln constructs are
STILL PRESENT and unchanged, and (b) the corrected ledger/doc text now
accurately matches the live evidence for V-15, V-26, V-35, V-50.

**Verdict: PASS.**

---

## (a) Planted constructs — all present and unchanged

Confirmed by direct read/grep of HEAD working tree. None of the
construct-bearing files appear in `git status` as modified (the only
source edits in the tree are unrelated cosmetic `BVBE` → `Bitvulnex`
rebrand changes in comments/labels — see note below).

| Construct | Location | Status |
|---|---|---|
| `xml2js` vulnerable pin (V-15) | `apps/web/package.json:30` (`"xml2js": "0.4.23"`) | PRESENT, unchanged |
| `xml2js@0.4.23` resolved | `pnpm-lock.yaml:1964, 3518` | PRESENT, unchanged |
| `--insecure-http-parser` (V-50 upstream half) | `docker-compose.yml:36` (`NODE_OPTIONS: "--insecure-http-parser"`) | PRESENT, unchanged |
| nginx CL/TE-tolerant directives (V-50 edge half) | `nginx/nginx.conf:35-36` (`ignore_invalid_headers off; underscores_in_headers on;`) + `:88` (`proxy_pass_request_headers on`) | PRESENT, unchanged |
| `x-bvbe-user-id` strip (V-35 edge blunt) | `nginx/nginx.conf:93` (`proxy_set_header x-bvbe-user-id "";`) | PRESENT, unchanged |
| `x-middleware-subrequest` bypass branch (V-35) | `apps/web/middleware.ts:34-36` | PRESENT, unchanged |

`nginx/nginx.conf`, `docker-compose.yml`, `apps/web/middleware.ts`,
`pnpm-lock.yaml`, `apps/web/package.json`, and
`apps/web/lib/compliance/sanctions-import.ts` are NOT in the modified
file set. No code or config change to any planted construct.

**Rebrand note (not a Gate-3 concern, but observed):** several source
files (`withdrawal/submit.ts`, `internal-transfer.ts`,
`treasury/coordinator.ts`, `psbt-envelope.ts`, `legacy-keys.ts`,
`totp.ts`, `observability.ts`) carry uncommitted diffs. Every one is a
comment/label-only `BVBE` → `Bitvulnex` string swap; the vulnerable
logic (non-transactional read/debit in `submit.ts`, missing
`checkAndDebitLimit` in `internal-transfer.ts`, multi-marker PSBT
parser, leaked legacy RSA key, TOTP issuer label) is byte-for-byte
intact. These predate this task and are out of scope for the
documentation-only correction; flagged here only for completeness. No
planted vuln is weakened.

---

## (b) Corrected ledger/doc text — accurate against live evidence

### V-15 — re-scoped to SCA-only (CORRECT)
`VULNS.md:452-461`. Category is now `Infra / Supply chain (SCA)`. The
"Scope note (live-verified)" states the importer reads
`parsed.sanctions` and never merges into a prototype-reachable sink,
`/me/flags` stayed `{}`, no live privesc through V-15, and V-34 is the
real proven prototype-pollution path. Chain membership rewritten to
"standalone SCA finding"; the old "second route to V-34's sink"
framing is explicitly **withdrawn** with a "do not upgrade `xml2js`"
instruction. Matches `15-not-reproduced-assessment.md` §V-15 exactly.
`04-exploitability-audit.md:151-167` retitled "SCA-only; re-scoped"
with the same conclusion. No overstatement remaining.

### V-26 — keep + repro note (CORRECT)
`VULNS.md:326-336`. "Repro note (instructor)" present: max the limit
near 23:59Z then withdraw just after 00:00Z for 2× cap; or pin
web+worker with `libfaketime`; explicit "do NOT change the host/VM
system clock on Docker-Desktop/WSL2" warning. Matches
`15-not-reproduced-assessment.md` §V-26. Flaw remains documented as
genuine/exploitable, not removed.

### V-35 — edge-blunt caveat (CORRECT)
`VULNS.md:115-125`. "Edge caveat (live-verified)" present: fully
exploitable direct-to-app; blunted through nginx because
`nginx.conf:93` clears `x-bvbe-user-id` while `x-middleware-subrequest`
still passes the edge; "do NOT add `x-middleware-subrequest` to the
strip list, do NOT remove the `x-bvbe-user-id` strip." Accurately
describes the as-shipped behaviour (auth bypass passes edge; identity
header blanked → no attacker-chosen identity). `04-exploitability-audit.md:96-104`
carries the matching expansion with the `nginx.conf:93` reference.
Plant correctly described as intact, not broken.

### V-50 — misconfig present; edge defends (CORRECT)
`VULNS.md:485-495`. "Live-verified status" present: both halves live
(directives in `nginx.conf`, `--insecure-http-parser` on `web`, log
prints `Warning: Using insecure HTTP parsing`); nginx 1.25.5 rejects
CL+TE with `400` (RFC 7230 §3.3.3); obfuscation variants
fail/benign-pipelining; a working smuggle needs a deliberately-lenient
edge pinned (flagged optional/future, NOT done now); "do not alter
`nginx.conf`/`docker-compose.yml`." Chain membership expanded: CHAIN B
terminal closes via proven V-51 standalone; only the V-50 delivery is
env-dependent. Matches `15-not-reproduced-assessment.md` §V-50.
`04-exploitability-audit.md:339-383` replaces the old timing-dependent
caveat with the sharper "nginx 1.25.5 rejects CL+TE at edge (400)"
finding plus the lenient-edge-as-optional note; CHAIN B status block
(`:453-472`) updated consistently.

### The one new edit this task made — 02-killer-chains.md (CORRECT)
`git diff` confirms the sole substantive change is a "LIVE-VERIFIED
CAVEAT" blockquote inserted under the CHAIN B "Hardest step" header
(`02-killer-chains.md:243-254`): the V-50 smuggle delivery is
edge-blunted (nginx 1.25.5 rejects CL+TE → 400), a working smuggle
needs a lenient edge pinned (optional future infra), and CHAIN B still
closes via proven-live V-51. Markdown-only, in the doc's existing
instructor-note voice, accurate to the evidence.

---

## Findings / nits (non-blocking)

1. **Stale line reference in `04-exploitability-audit.md:459`** —
   "V-50 nginx half: `nginx/nginx.conf:69-71`." In the current
   `nginx.conf`, lines 69-71 are the `_next/webpack-hmr` WebSocket
   block; the actual CL/TE-tolerant directives are at `:35-36`
   (server scope) and `proxy_pass_request_headers on` at `:88`. The
   prose correctly names the directives, and `VULNS.md` describes them
   without a wrong line number, so this is a cosmetic drift, not an
   accuracy problem. Recommend correcting the line range on a future
   touch. Not load-bearing; does not affect verdict.

2. **Chain-summary table row unchanged (`02-killer-chains.md:695`)** —
   "B — admin persistence | Closed (zero-knowledge) | CL/TE smuggle
   framing | Hard." This is *defensible*: per the evidence CHAIN B's
   terminal "promote to admin" outcome does close (V-51 proven live),
   and the new caveat blockquote 450 lines above the table explicitly
   reframes the smuggle as a stretch-goal mechanism. The Staff Eng's
   choice to leave the row "Closed" but add the prominent caveat is
   consistent — not an overstatement given the adjacent caveat. Noted
   for transparency only.

No place was found that still overstates exploitability. No accidental
code or config change. The three not-fully-reproduced plants (V-15,
V-26, V-50) and the edge-blunted V-35 are all now accurately scoped.
Ledger count unchanged at 40 plants.

**Gate 3 verdict: PASS.**
