# Bitvulnex — Architecture

> Phase 0 baseline. This document evolves as feature phases land. The
> purpose is to make trust boundaries and request flow legible so that
> planted vulnerabilities, when introduced, sit at recognisable places.

## Containers (Phase 0)

```
┌────────┐      ┌──────────┐      ┌──────────────┐
│ client │─────▶│  nginx   │─────▶│   web (3000) │ (Next.js 15)
└────────┘      └──────────┘      └──────┬───────┘
                                         │
                       ┌─────────────────┼─────────────────┐
                       │                 │                 │
                       ▼                 ▼                 ▼
                 ┌──────────┐      ┌──────────┐    ┌────────────────┐
                 │  db      │      │  redis   │    │ bitcoin-mock   │
                 │ (pg 16)  │      │  (7)     │    │ (18443, JSON   │
                 └──────────┘      └──────────┘    │  RPC, internal)│
                                                   └────────────────┘
                          ▲
                          │
                    ┌─────┴─────┐
                    │  worker   │ (BullMQ, idle in Phase 0)
                    └───────────┘
```

## Trust boundaries (future vuln placement reference)

1. **Internet → nginx.** Strict HTTP/1.1 in Phase 0. Phase 9 activates
   a CL/TE-tolerant block reserved for **CHAIN B** (request smuggling
   → admin route bypass).
2. **nginx → web.** Phase 4 adds `proxy_cache` for `/api/public/*`
   only. Cache key omits `Host`-shaped headers (planted in Phase 4),
   enabling **CHAIN C** cache poisoning.
3. **web → bitcoin-mock.** Plain JSON-RPC over the internal docker
   network. Phase 7's PSBT signing flaw (V-33) lives in `web`'s
   coordinator and trusts the mock's `decodepsbt` output.
4. **web → db / redis.** Internal trust assumed. No vulns straddle
   this boundary directly.

## Request flow (Phase 0)

| Request                          | Path                                       |
|----------------------------------|--------------------------------------------|
| `GET /`                          | nginx → web (server-rendered landing)      |
| `GET /about/changelog`           | nginx → web (static-rendered MD)           |
| `GET /docs`                      | nginx → web (client-side Swagger UI)       |
| `GET /api/health`                | nginx → web (JSON)                         |
| `GET /api/openapi.json`          | nginx → web (built from registry)          |

No authenticated routes yet. Phase 1 introduces the auth surface and
the deliberate `/api/v1/*` legacy namespace.

## OpenAPI registry pattern

Endpoints register themselves in `apps/web/lib/openapi-registry.ts`.
The Swagger document at `/api/openapi.json` is built from the
registry. Endpoints that should not appear in public docs simply skip
the `registerEndpoint(...)` call — the gap is structural rather than
manually maintained. This matches how real, careless teams produce
incomplete OpenAPI specs and is the substrate for the "intentionally
incomplete docs" choice in the master plan.
