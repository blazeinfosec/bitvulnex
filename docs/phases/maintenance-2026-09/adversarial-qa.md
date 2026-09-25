# Maintenance 2026-09 — Gate 3 Adversarial QA

**Verdict: PASS.** All 40 planted vulnerabilities and the constructs behind
the four killer chains survive the functional-fix pass. Nothing was killed
inadvertently.

**Method:** static construct audit of every `V-NNN` against `VULNS.md`,
close reading of the diff for the files that sit on or next to planted
paths, and live exploitation of a representative set against the running
stack (`docker compose up`, `CTF_MODE=true`).

## Construct audit — all 40 present

Each planted construct was confirmed still in the code after the fixes.
The gadgets that a fix ran closest to were read line by line:

- **V-45** (staking claim race): the `findMany({claimedAt:null})` →
  unguarded `update` pair with no wrapping transaction is unchanged. The
  fix only widened the position-status filter, which sits before the race.
- **V-28 / V-30** (withdrawal submit non-transactional; internal transfer
  skips limits): `submit.ts` still has no `$transaction`; `internal-transfer.ts`
  still calls neither `checkAndDebitLimit` nor `requireTier`.
- **V-32** (cancel/match race): the DELETE handler is byte-unchanged, and
  `place.ts` still matches under default (READ COMMITTED) isolation with no
  `SELECT FOR UPDATE`.
- **V-51** (mass assignment): the schema still declares `role`/`kycTier`/
  `feeTier` and forwards `parsed.data` verbatim to `prisma.user.update`.
  The only change is a P2002 duplicate-email catch.
- **V-33** (PSBT polyglot): `decodePsbt` still reads the first envelope
  segment; the mock's `finalizepsbt` still reads the last.
- **V-4** (order IDOR): file byte-unchanged.

## Live confirmations

Run against the live stack; each planted flaw still fires:

| Vuln | Live result |
|------|-------------|
| V-6 | `GET /api/v1/internal/users` with `x-bvbe-internal-trace: 1` and no auth dumps users including `passwordHash`. |
| V-8 | An `alg=none` token authenticates as the claimed `sub` on `/api/v1/auth/me`. |
| V-14 | `?file=../../package.json` reads outside the uploads directory. |
| V-40 | SSRF to `169.254.169.254` reaches the mock IMDS and emits the flag. |
| V-51 | `PATCH /api/v2/me {"role":"admin","kycTier":3}` promotes the caller and emits the flag; a re-login mints an admin-claim token. |
| Matching engine | A fill leaves `amount == available + locked` and moves the public price feed (the CHAIN C oracle path). |
| CTF validators | The broadened V-14, V-24, and CHAIN-D proofs are accepted by `/api/v2/ctf/claim`. |

## Note (not a regression, not a blocker)

The V-40 single-label variant `http://mock-imds/` fails at the fetch layer
(the bare service name isn't reachable from the web container on that
network), so its flag doesn't fire. The canonical `169.254.169.254` path
works. The import-url guard, `redirect: "follow"`, and the flag detection
are all intact; this is pre-existing network topology, unrelated to the
fixes. The detection code was verified to fire on the reachable internal
hosts.
