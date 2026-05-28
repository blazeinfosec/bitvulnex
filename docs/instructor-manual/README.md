# BVBE Instructor Manual

> **Audience:** lead instructors running a BVBE cohort, co-instructors
> picking up the lab cold, and advanced trainees doing self-paced study
> against a clone of the repository.
>
> **Status:** authored 2026-05-28, against the post-Phase-9 ship-state
> of the lab. The integrity baseline is `docs/phases/HOLISTIC-L7-REVIEW.md`,
> which confirms all 40 V-NNN plants intact at HEAD and all four killer
> chains end-to-end walkable against a zero-knowledge attacker.

## What this manual is

This is the operational reference for teaching the Blaze Vulnerable
Bitcoin Exchange (BVBE) — a deliberately-vulnerable Bitcoin exchange
training lab. The lab plants 40 catalogued vulnerabilities across
nine development phases, deliberately structured so that the easy
plants serve as confidence-building on-ramps and the hard plants
weave together into four end-to-end "killer chains" that demand the
synthesis a real attacker actually performs.

The manual exists because the source-of-truth `VULNS.md` ledger is
written from the *developer's* perspective ("this is what we planted,
this is the realistic root cause, this is how a real team would fix
it"). What an instructor needs is a complement to that: PoCs that
actually run, a sense of which plants are easy to demonstrate and
which require setup, and a curriculum that paces trainees from
"find the dangerous default" to "drain the hot wallet" over the
course of a two-day cohort.

## Files in this manual

- **`01-vulnerability-catalog.md`** — every planted vulnerability with
  a concrete, copy-pastable PoC, an instructor-facing severity rating
  (independent of the trainee-facing discovery difficulty), and the
  reachability metadata an instructor needs to know whether to gate
  the exercise behind a hint or behind a tier escalation. Read this
  before running any cohort exercise.
- **`02-killer-chains.md`** — the four end-to-end chains (A drain the
  hot wallet, B become admin and persist, C mass user takeover via
  oracle, D exfiltrate the user DB + KYC). Each chain has a
  step-by-step walkthrough with the actual curls and the conceptual
  bridge between each step. These are the chains an advanced trainee
  is graded against.
- **`03-discovery-progression.md`** — suggested two-day curriculum.
  Maps individual plants to time-of-day, suggests hint progressions
  for trainees who get stuck for N minutes, and explains why specific
  plants are paired together (e.g. V-25 self-trade as a stepping
  stone into CHAIN C).
- **`04-exploitability-audit.md`** — the instructor's "reality check"
  on the catalog. For each plant, my independent verification: did I
  open the source file and confirm the construct? Did I construct the
  PoC? Are there caveats the ledger doesn't capture? Read this file
  if a trainee tells you "I tried the PoC and it doesn't work" — the
  caveats live here.

## How to use this manual

### Running a 2-day cohort

Plan against `03-discovery-progression.md`. Day 1 morning is warm-up
on the easy on-ramps (V-13 open redirect, V-8 alg=none, V-14 path
traversal, V-1 stored XSS). Day 1 afternoon is medium plants
(V-11 SQLi, V-25 self-trade, V-40 SSRF, V-19 JWT key confusion).
Day 2 morning is hard plants plus CHAIN C (the chain that's
exploitable from a single insider account, no PSBT construction).
Day 2 afternoon is CHAIN A, CHAIN B, CHAIN D — pick one
or two depending on cohort depth.

Use `01-vulnerability-catalog.md` as your "what to expect when a
trainee hits this plant" reference. The instructor notes in each
entry call out the most common stuck-points.

### Handing the manual to a co-instructor

The shortest path from "I have never seen this lab" to "I can run a
session on it" is: read this README, read the four chain narratives
in `02-killer-chains.md` (they're each ~1500 words and tell you
the whole story), then skim `04-exploitability-audit.md` so you know
which plants have known caveats. The catalog (`01`) is a reference
to consult during the session, not something to read end-to-end.

### Self-paced study (advanced trainees)

If you are an advanced practitioner working through the lab on your
own: don't read `VULNS.md`. Don't read this manual. Clone the repo,
boot the stack, and explore. The lab is structured so the catalog is
the *answer key*. If you get stuck for more than 30 minutes on any
single plant, `03-discovery-progression.md`'s "hint progression"
sections will give you a graded nudge without spoiling the punchline.

## Conventions

- **Severity** (instructor-assigned, independent of discovery
  difficulty): **Critical** for fund loss / account takeover / full
  data exfil; **High** for significant privilege escalation or
  sensitive data exposure; **Medium** for moderate impact requiring
  chaining; **Low** for informational / requires preconditions.
- **Discovery difficulty** (trainee-facing, from the VULNS.md
  ledger): easy / medium / hard / expert.
- **Reachability** — three tags per plant: authentication required
  (none / any user / Tier-N / admin / treasury), discoverability
  (source-only / API probing / black-box / requires recon), and
  chain membership (standalone / CHAIN A / B / C / D).
- **PoCs** — all `curl` commands assume the local stack is running
  via `docker-compose up -d` on the default port (80 for nginx, the
  upstream stays internal). Where a PoC needs a forged JWT, the
  `forge.py` script from `02-killer-chains.md` §CHAIN A Step 2 is
  the reference.
- **INSTRUCTOR NOTE callouts** in `01` and `02` are content only the
  instructor should see — common stuck-points, scoring tips, and
  when-to-hint guidance. Don't paste these into trainee-facing
  materials.

## Lab-safety reminders

Every entry point — the README, the landing page footer, the login
page, the OpenAPI registry — carries a "DO NOT DEPLOY" banner. Keep
those banners in place. If a trainee asks "could we use this for
something real?", the answer is no. Re-affirm:

- No real Bitcoin. Regtest + mock node only.
- No real PII. Seed data is synthetic.
- No outbound HTTP. The SSRF demos target docker-network mock
  services, never the public internet.
- The committed secrets (`JWT_SECRET=devsecret-...`, `changeme`,
  `bvbe-prod-pw-2024`) are planted vulns (V-48 / V-9), not
  accidents. Do not rotate them — that would close the V-48
  chain.

— Blaze Information Security training team
