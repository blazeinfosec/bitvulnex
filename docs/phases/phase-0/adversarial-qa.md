# Phase 0 — Adversarial QA (Gate 3)

> **Reviewer role:** Red-team QA. Probed the Phase 0 scaffolding with
> attacker eyes. Phase 0 has **zero allocated planted vulns** per the
> architect — so my job here is (a) verify nothing leaked in from
> future phases, and (b) flag unintended bugs introduced during the
> build.
> **Date:** 2026-05-27
> **Verdict:** **Pass, after two unintended issues were fixed during
> review.** No PoCs to deliver (zero planted vulns). Two findings,
> both addressed.

## Methodology

1. Static read of all source under `apps/` and `packages/`
2. Grep for premature leak of the architect's "surfaces to leave
   clean" patterns: `lodash`, `child_process`, `eval`, `node-serialize`,
   `dangerouslySetInnerHTML`, `innerHTML`, `new Function`,
   `$queryRawUnsafe`, `/api/v1/`, nginx `proxy_cache_*` / CL/TE
   directives, WebSocket origin checks, deliberate `.env.example`
   weak-key fallbacks
3. Manual trace of the four Phase 0 user-reachable surfaces:
   - `GET /` (landing)
   - `GET /about/changelog`
   - `GET /docs`
   - `GET /api/health` and `GET /api/openapi.json`
4. JWT module audit (alg whitelist, key-length enforcement)
5. bitcoin-mock server audit (input handling, error paths)

## Findings

### F-0.1 — Unintended functional bug (FIXED)

**Severity:** Blocker for exit criterion #4 (`/about/changelog`
renders the initial entry).

**Location:** `apps/web/Dockerfile`.

**Issue:** `apps/web/app/about/changelog/page.tsx` reads
`CHANGELOG.md` from the repo root via `readFileSync`, but
`apps/web/Dockerfile` did not `COPY CHANGELOG.md` into the container.
At runtime the file would not exist and the page would fall back to
its "Unable to load CHANGELOG.md — Phase 0 placeholder" string,
failing exit criterion #4.

**Resolution:** Added `COPY CHANGELOG.md ./CHANGELOG.md` to
`apps/web/Dockerfile`. Verified by re-reading the file.

### F-0.2 — Premature leak of a Phase 1 vulnerability (FIXED)

**Severity:** Phase contamination — would cause Gate 4 to fail the
"VULNS.md ledger matches reality" check.

**Location:** `docker-compose.yml` (before fix).

**Issue:** The `web` service had

```yaml
JWT_SECRET: ${JWT_SECRET:-replace-me-with-a-32-byte-random-secret}
```

The fallback string is exactly the `.env.example` placeholder — a
**publicly-known string in the repository**. It passes the strict
`>=32 chars` zod check in `apps/web/lib/env.ts`, so the app starts
normally with this string as the JWT signing key if `JWT_SECRET` is
unset in the shell. This is **functionally equivalent** to the
deliberate weak-key fallback that the master plan reserves for V-9
in Phase 1.

The architect review explicitly says:

> Deliberate `.env.example` weak-key fallbacks — reserved for Phase 1.

This is therefore a *premature leak* of a Phase 1 vuln, not a
finished Phase 0 surface.

**Resolution:** Changed both `JWT_SECRET` and `CTF_SALT` to use the
`${VAR:?error}` form so docker-compose fails fast with a clear error
message if the variable is unset. No fallback string in the repo. The
deliberate weak-key path for V-9 must be implemented in Phase 1 as
its own architect-allocated change.

Verified by reading `docker-compose.yml` post-fix.

## Probes that passed cleanly

| Probe                                                                | Result |
|----------------------------------------------------------------------|--------|
| JWT verifier accepts `alg=none`?                                     | NO — `jose.jwtVerify` strictly enforces the `algorithms: ["HS256"]` whitelist; alg=none throws `JWSAlgorithmNotAllowed`. |
| JWT verifier accepts JWT signed with the JWKS public key (HS/RS confusion)? | NO — no JWKS endpoint exists in Phase 0; this is Phase 1 / V-19 territory. |
| JWT signing accepts a short key?                                     | NO — `secretBytes()` throws if `secret.length < 32`. |
| Changelog page reflects user input?                                  | NO — reads from a hardcoded server-side path; rendered inside `{raw}` so React auto-escapes. No XSS surface. |
| OpenAPI registry leaks endpoints from import side-effects?           | NO — registry is module-local and only populated by explicit `registerEndpoint(...)` calls. Endpoints absent from the import graph in `app/api/openapi.json/route.ts` do not appear in the document. |
| bitcoin-mock leaks internal state on error?                          | Error messages are bounded to the RPC error code/message contract; no stack traces returned to the client. |
| bitcoin-mock requires auth?                                          | NO — but it is bound to the internal docker network only and not routed by nginx. Trust boundary verified by `docker-compose.yml` (no host port mapping on `bitcoin-mock`). |
| Premature `/api/v1/*` route?                                         | None. Only `/api/health` and `/api/openapi.json` exist under `/api`. |
| Premature `proxy_cache` directives in nginx?                         | Only in a comment block describing what Phase 4 will activate. No active directive. |
| Premature `child_process` / `eval` / `lodash` / unsafe deserializer? | None in code. Only mentioned in documentation describing what future phases will introduce. |
| `dangerouslySetInnerHTML` / `innerHTML` / `new Function`?            | None. |
| Outbound network calls from app code paths?                          | None. The only outbound call is `web → bitcoin-mock` over the internal docker network. The footer link to `blazeinfosec.com` is a user-initiated `<a target="_blank">`, not an outbound call from app code. |

## Verdict

**PASS.** Phase 0 scaffolding is clean of planted vulns and clean of
the architect's reserved surfaces. The two unintended issues
(F-0.1 functional, F-0.2 phase-contamination) were addressed during
this review. No new PoCs needed; VULNS.md remains correct ("Phase 0:
no planted vulns").

Handing off to Gate 4 (Paranoid QA).

— Adversarial QA
