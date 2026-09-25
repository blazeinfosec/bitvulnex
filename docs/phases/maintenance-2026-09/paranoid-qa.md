# Maintenance 2026-09 — Gate 4 Paranoid QA

**Verdict: PASS.** No real secrets, PII, or mainnet path enters the tree.
The ledger still matches the code, and the fixes introduce no new
unintended vulnerability.

## Lab-safety

- **No real secrets in the diff.** A scan of the added lines for xpub/xprv,
  PEM headers, AWS keys, mainnet references, and `bc1q…`-shaped strings
  found only the planted stand-ins (`devsecret…`, `changeme`, `EXAMPLE`),
  which must stay.
- **`.env` is untracked and gitignored.** Only `.env.example` is in the
  tree; the copy created to run the stack is ignored.
- **No mainnet path.** The new `apps/bitcoin-mock/src/state.test.ts` and the
  processor changes route through the mock node only.
- **Teardown intact.** The `volumes:` block in `docker-compose.yml` is
  unchanged, so `docker compose down -v` still destroys all state. The
  compose edits are limited to a host-port variable, a `depends_on`, and
  three environment passthroughs.

## Ledger accuracy

- All 40 `V-NNN` entries remain, and all 40 constructs are present in the
  code (see the Gate 3 audit).
- The only `VULNS.md` edit corrects the V-40 bypass list: decimal-IP forms
  of `127.0.0.1` (for example `2130706433`) do not bypass the guard,
  because `new URL()` canonicalizes them before the compare. The real
  variants (`127.0.0.2`, bracketed IPv6, single-label docker hosts) are
  listed instead.

## No new unintended vulnerability

- The two new endpoints, `GET /api/v2/me/p2p/trades` and
  `GET /api/v2/me/p2p/offers`, scope every row to the caller
  (`buyerUserId`/`sellerUserId` or `userId` equals `claims.sub`), confirmed
  live: a fresh account sees only its own records. No IDOR added.
- `internal-transfer.ts` prefers an exact email match and falls back to a
  case-insensitive lookup with oldest-account-wins, so it can't be steered
  to an unintended recipient.
- The KYC doc-download `content-disposition` fix sanitizes the filename for
  the header while passing `content-type` through verbatim, so V-41 is
  untouched.

## Banners

The DO NOT DEPLOY banner is unchanged in the root README, the root layout
(top and footer), and the login page. The README rewrite kept the banner
at the top.
