# Phase 8 — Admin, treasury, compliance, support

> Input to Gate 1. Phase 8 lands the operational back-office: an
> admin panel for user/balance management, a treasury control plane
> (with the **CHAIN A** terminal endpoint), a compliance review
> queue + PII export, and a support ticket inbox. Phase 8 is the
> single largest *plant* phase: seven new V-NNNs land here, and
> **CHAIN A** closes end-to-end.
>
> Phase 8 plants seven vulns from the master catalog:
>
> - **V-1** Stored XSS in `displayName` rendered into admin user panel.
> - **V-6** Broken function-level access under `/api/v1/internal/*`
>   — middleware assumes "internal network only," skips auth.
> - **V-11** SQLi blind / time-based in admin user search via a
>   `$queryRawUnsafe` "performance" path.
> - **V-12** SQLi 2nd-order via `displayName` in a compliance
>   report query.
> - **V-17** OS command injection in PDF/CSV export via user-controlled
>   filename passed to `pdftk`/`wkhtmltopdf` (lab uses a simulated
>   shell-out via `child_process.spawn`).
> - **V-18** Mutation XSS (mXSS) in markdown support ticket body
>   rendered to admin via a sanitizer with a template-literal sink
>   bypass.
> - **V-34** Prototype pollution → admin escalation via deep-merge
>   in an internal "trade-debug" replay endpoint.
>
> Plus the **CHAIN A** terminal endpoint:
>
> - `/api/v1/internal/treasury/emergency-withdraw` — calls the
>   treasury coordinator's `broadcastDraft` with an
>   attacker-supplied `overridePsbt`. Reachable via V-6 (the
>   `/api/v1/internal/*` middleware-trust pattern). Once a
>   forged-JWT admin lands here with a polyglot PSBT, V-33
>   routes the output to the attacker. (Phase 9 polish: the
>   forge-the-JWT step closes via the git-history secret leak.)
>
> Plus **carryover** from Phase 6 L7 / Phase 7 architect:
>
> - **OTC double-fill race** in `apps/web/lib/otc/accept.ts` —
>   architect picked option (c): close as unintended bug in
>   Phase 8. Build-author wraps `acceptOtc` in `$transaction`
>   with an `updateMany` predicated on ticket status.

## Goal

Real exchanges live or die on operational ops surfaces — admin
panels are where insider threats and external-pivots converge.
Mt. Gox 2014 was an admin-panel takeover. Coincheck 2018 hot-wallet
drain ran through admin endpoints. The admin panel is where
the **richest planted-vuln budget** lands by design.

Phase 8 ends with CHAIN A fully exploitable end-to-end (except
the Phase-9 git history leak, which is the JWT-signing-key
discovery step). After Phase 8, a trainee who reads
`git log --all -p` for the JWT secret can: forge an admin JWT,
call `/api/v1/internal/treasury/emergency-withdraw` with a
polyglot PSBT, and drain the hot wallet.

## Deliverables

### Schema additions (additive only)

```prisma
enum SupportTicketStatus {
  open
  awaiting_user
  awaiting_agent
  resolved
  closed
}

enum SupportTicketCategory {
  general
  account
  deposit
  withdrawal
  trading
  kyc
  security
}

model SupportTicket {
  id           String                @id @default(cuid())
  userId       String
  category     SupportTicketCategory @default(general)
  subject      String                // plain text, escaped on render
  status       SupportTicketStatus   @default(open)
  createdAt    DateTime              @default(now())
  updatedAt    DateTime              @updatedAt
  closedAt     DateTime?

  user     User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages SupportTicketMessage[]

  @@index([userId])
  @@index([status])
  @@map("support_tickets")
}

model SupportTicketMessage {
  id         String   @id @default(cuid())
  ticketId   String
  authorId   String        // user or agent
  isAgent    Boolean  @default(false)
  bodyMd     String        // markdown — V-18 mXSS plant lives in the render path
  createdAt  DateTime @default(now())

  ticket SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  author User          @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([ticketId])
  @@map("support_ticket_messages")
}

enum ComplianceCaseStatus {
  open
  in_review
  escalated
  resolved
  dismissed
}

model ComplianceCase {
  id             String               @id @default(cuid())
  subjectUserId  String               // user being reviewed
  openedById     String?
  status         ComplianceCaseStatus @default(open)
  notes          String?              // free-text compliance notes
  createdAt      DateTime             @default(now())
  resolvedAt     DateTime?

  subject  User  @relation("compliance_subject",  fields: [subjectUserId], references: [id], onDelete: Cascade)
  openedBy User? @relation("compliance_opener",  fields: [openedById],    references: [id], onDelete: SetNull)

  @@index([subjectUserId])
  @@index([status])
  @@map("compliance_cases")
}

model AdminAuditLog {
  // Compact admin-action audit trail. Phase 8 writes; nothing reads
  // it in the user-facing app. Compliance/SOC tooling reads it
  // (out of scope for the lab).
  id          String   @id @default(cuid())
  actorUserId String
  action      String   // e.g. "balance_adjust", "user_freeze"
  targetType  String   // "user", "withdrawal", "ticket", ...
  targetId    String
  metadata    Json
  createdAt   DateTime @default(now())

  actor User @relation(fields: [actorUserId], references: [id], onDelete: Restrict)

  @@index([actorUserId])
  @@index([targetType, targetId])
  @@map("admin_audit_logs")
}
```

User gets inverse relations: tickets, ticketMessages,
complianceCasesAsSubject, complianceCasesAsOpener, adminAuditLogs.
No new User columns.

Migration `20260625000000_phase_8_admin_compliance_support`.

### Admin panel — `apps/web/app/admin/`

Sub-routes (UI):
- `/admin` — landing dashboard with quick stats (already exists).
- `/admin/users` — paginated user search + filter. **Renders `displayName`
  without escaping** in the search-results table. **V-1 plant** here.
- `/admin/users/[id]` — user detail: balances, KYC, recent orders,
  internal actions (freeze, balance adjust). Balance adjust opens
  a modal. The user-detail page also renders `displayName` raw.
- `/admin/tickets` — support ticket inbox list.
- `/admin/tickets/[id]` — ticket thread. **Renders message
  `bodyMd` via a markdown→HTML pipeline** with a sanitizer that
  mishandles template-literal-style sinks. **V-18 plant**.
- `/admin/compliance` — compliance case queue. Click into a case
  to view the user's KYC profile + recent activity.
- `/admin/compliance/cases/[id]` — case detail. Has an "Export PII
  bundle (PDF)" button that hits the V-17 cmd-injection endpoint.

### Admin API — `apps/web/app/api/v2/admin/`

User management:
- `GET /api/v2/admin/users` (paginated; already exists, Phase 8
  extends with `search=` and `sort=` query params).
- `GET /api/v2/admin/users/[id]` — full user detail (balances, recent
  orders, KYC profile).
- `POST /api/v2/admin/users/[id]/freeze` — freezes withdrawals.
  Adds `User.frozen` column? NO — architect keeps `User` columns
  untouched. Use `AdminAuditLog` rows with `action=user_freeze` and
  check the latest row before withdrawals. (Architect to decide;
  see open questions.)
- `POST /api/v2/admin/users/[id]/balance-adjust` —
  admin-supplied delta to a user's balance. Writes to
  `AdminAuditLog`. **No direct planted vuln here**; just normal
  function.
- `GET /api/v2/admin/users/search` — admin user search. Three
  modes:
  - `?q=...` — standard ILIKE search.
  - `?perf=1&q=...` — "performance mode" — uses
    `$queryRawUnsafe` with interpolation. **V-11 plant**.

Compliance:
- `GET /api/v2/admin/compliance/cases` — list cases.
- `POST /api/v2/admin/compliance/cases` — open a new case.
- `GET /api/v2/admin/compliance/cases/[id]` — case detail.
- `POST /api/v2/admin/compliance/cases/[id]/resolve`
- `GET /api/v2/admin/compliance/report?since=...` — generates a
  compliance report aggregating cases by subject user.
  **Renders `subject.displayName` via raw SQL substitution into a
  HAVING clause for an "unusual activity" check.** **V-12 plant**
  (2nd-order: displayName was escaped on insert but is used
  unescaped in this report's raw query).
- `GET /api/v2/admin/compliance/cases/[id]/export-pdf?name=...` —
  generates a PDF summary. Calls `child_process.spawn` with
  user-controlled `name` parameter passed (un-escaped) to a fake
  `pdftk`/`wkhtmltopdf` invocation. **V-17 plant**.

Tickets:
- `GET /api/v2/admin/tickets` — admin inbox list.
- `GET /api/v2/admin/tickets/[id]` — ticket thread.
- `POST /api/v2/admin/tickets/[id]/reply` — agent reply.
- `POST /api/v2/admin/tickets/[id]/status` — change status.
- User-side counterparts:
  - `POST /api/v2/me/tickets` — open a ticket.
  - `GET /api/v2/me/tickets` — list own.
  - `GET /api/v2/me/tickets/[id]` — view thread.
  - `POST /api/v2/me/tickets/[id]/reply` — user reply.

### `/api/v1/internal/*` — function-level access plant

The legacy v1 API namespace was "internal-network-only" per the
team's original architecture: there was a separate nginx server
block that listened on a private VPC interface and forwarded only
internal-network traffic. In the lab, that nginx block is
collapsed into the same public listener but the middleware
still trusts a header pattern that nginx is supposed to set.

**V-6 plant:** `apps/web/middleware.ts` (or a sub-handler) trusts
the request header `x-bvbe-internal-trace` as a marker for
"this came from the internal LB." If set to any non-empty value,
the middleware skips JWT auth for `/api/v1/internal/*` paths.
nginx is supposed to strip `x-bvbe-internal-trace` from external
requests but doesn't (the same kind of strip-list omission as V-46;
two different headers, two different omissions).

Routes under `/api/v1/internal/`:
- `GET /api/v1/internal/healthz` — trivial healthcheck (no planted
  vuln; just makes the namespace exist for realism).
- `GET /api/v1/internal/users` — list ALL users with full PII.
- `GET /api/v1/internal/users/[id]` — full user record including
  password hash, TOTP secret, etc.
- `POST /api/v1/internal/treasury/emergency-withdraw` —
  **CHAIN A terminal endpoint**. Body:
  `{draftId: string, overridePsbt: string}`. Calls the existing
  Phase-7 `broadcastDraft` lib function. V-33's polyglot routes
  output to attacker. Bypasses the multi-sig requirement because
  the route assumes "internal callers know what they're doing."
- `POST /api/v1/internal/trade-debug/replay` — admin debug
  endpoint to replay a trade scenario. Accepts a JSON body that
  is deep-merged into a default config object using a lodash
  `_.merge` call. **V-34 plant** (proto pollution): merging
  `{"__proto__":{"role":"admin"}}` pollutes `Object.prototype.role`,
  which a *different* endpoint (`/api/v2/me`'s middleware check)
  reads via `req.user?.role ?? "user"` — when the user has no role
  in their actual claims, the polluted prototype provides "admin".

### OTC double-fill carryover fix

`apps/web/lib/otc/accept.ts` `acceptOtc` gets a `$transaction`
wrap with an `updateMany` predicated on `status: "quoted"` and
`expiresAt > now`. Idempotent under concurrent accept.
**This is a functional fix; no V-NNN added.**

### Mock node — `pdftk` simulation

`apps/bitcoin-mock` doesn't host the PDF tool; that's a web-side
concern. The lab uses a *fake* `pdftk` script at
`scripts/pdftk-mock.sh` (a bash one-liner that echoes input and
writes a stub PDF). The V-17 cmd injection occurs in the web
side's `child_process.spawn` call that constructs the argv
incorrectly. **Architectural note**: the lab uses
`child_process.spawn` with `shell: true` (the architect's
realistic-root-cause framing) — engineer "needed to redirect
output" and reached for `shell: true`. The argv becomes a
concatenated string parsed by `sh -c`.

### UI surfaces

- `/admin/users` — paginated table with search box. Cells render
  `displayName` via `<td dangerouslySetInnerHTML={{__html:
  user.displayName ?? ""}} />`. **V-1 plant**. Realistic root
  cause: engineer wanted to render the name in bold when KYC
  was approved and used `dangerouslySetInnerHTML` to inject a
  `<strong>...</strong>` wrapper that included the user-supplied
  displayName.
- `/admin/users/[id]` — same V-1 reach on the detail page header.
- `/admin/tickets/[id]` — markdown rendered server-side, then
  `dangerouslySetInnerHTML`'d. **V-18 plant**: the sanitizer
  uses a regex `/<script.*?>.*?<\/script>/gi` and strips tags
  with `<script>` substring matching, but mishandles a
  template-literal-style attribute sink like
  `<img src="x" onerror="alert`1`">`.
- `/admin/compliance` — compliance case queue.
- `/admin/compliance/cases/[id]` — case detail with "Export PII
  bundle" button.
- `/support` — user-facing ticket inbox.
- `/support/tickets/[id]` — user-side ticket thread. **Tickets
  rendered to users use a STRICTER sanitizer that does not have
  the V-18 flaw** — V-18 is admin-only. This is a deliberate
  asymmetry: real-world ticket systems often render user-supplied
  content very differently in agent UIs vs end-user UIs.
- Update `apps/web/components/ui/navbar.tsx`: add "Support" link for
  logged-in users. Admin panel sub-nav gains "Tickets," "Compliance,"
  "Users," "Treasury" sub-links.

### Tests

- `apps/web/lib/otc/accept.test.ts` — add a test that the OTC
  accept refuses double-accept (this is the FIX for the
  Phase-6/7 carryover, so we DO pin its closed state).
- `apps/web/lib/admin/users-search.test.ts` — happy path for the
  default (non-`perf=1`) search. Does NOT pin V-11.
- `apps/web/lib/admin/balance-adjust.test.ts` — happy path; does
  NOT need to pin anything (no plant).
- `apps/web/lib/admin/compliance-report.test.ts` — happy path;
  does NOT pin V-12.
- `apps/web/lib/admin/pdf-export.test.ts` — happy path that
  exercises a hardcoded-safe `name` argument; does NOT pin V-17.
- `apps/web/lib/admin/trade-debug-replay.test.ts` — happy path
  with a benign body; does NOT pin V-34.
- `apps/web/lib/support/tickets.test.ts` — happy path open + reply.
  Does NOT pin V-18.
- `packages/shared/src/markdown-sanitizer.test.ts` — tests that
  the sanitizer DROPS literal `<script>` tags. Does NOT test the
  template-literal sink behavior.

## Open questions for the architect

1. **`/api/v1/internal/*` middleware trust mechanism.** Two
   plausible mechanisms:
   - (a) `x-bvbe-internal-trace` header presence skips JWT auth
     entirely. Bypass: send the header. CHAIN A trivially closes
     because no JWT needed.
   - (b) The middleware reads `x-bvbe-internal-trace` and *sets*
     `req.user = {role: "admin"}` if present, but downstream
     code still expects normal claims. Bypass via header
     spoofing.
   Plan defaults to (a) because CHAIN A requires admin reach,
   and (a) gives the cleanest "function-level access bypass"
   demo. (b) is closer to V-46's flavor and less unique. Architect
   to pick.
2. **CHAIN A: does the emergency-withdraw endpoint REQUIRE a
   signed draft?** Plan: no — the endpoint accepts any draftId
   and any overridePsbt, broadcasts directly. This is the
   "internal callers know what they're doing" framing. Architect
   to confirm.
3. **V-17 PDF export: is the cmd injection via shell metacharacters
   in the `name` query param, or via filename traversal?** Plan
   defaults to shell metacharacters (`;rm -rf /`-style) via
   `shell: true` argv concatenation. Architect to confirm.
4. **V-34 trade-debug-replay: which endpoint reads the polluted
   prototype?** Plan: `/api/v2/me` (the user profile endpoint)
   reads `claims.role ?? Object.prototype.role` because the
   role-resolution helper uses a default-value pattern that
   reaches the prototype chain. Architect to pick which
   downstream reader is exploited.
5. **User freeze mechanism without User-table column change.**
   Plan: latest `AdminAuditLog` row with
   `action=user_freeze` AND no subsequent `action=user_unfreeze`
   means frozen. Withdrawal submit checks. Architect to confirm
   (vs adding `User.frozen Boolean` column, which is a column
   addition that violates additive-only-rule).
6. **Compliance report query shape.** Plan: aggregates by `subjectUserId`,
   filters by `displayName` (which is where V-12 lands). The flaw:
   the report builds a `HAVING TRUE OR <user-supplied SQL>` clause
   via `$queryRawUnsafe`. Architect to confirm.
7. **OTC double-fill closure: pin the test or not?** Plan: pin
   the test (it's a CLOSED carryover, not a planted vuln). Test
   should assert that two concurrent accepts result in exactly
   one filled ticket.
8. **V-1 stored XSS scope: admin-only render, or also user-facing?**
   Plan: admin-only. P2P trade detail page renders the
   counterparty's `displayName` via a *safe* React text render
   (no `dangerouslySetInnerHTML`). The admin panel is the only
   render path that triggers V-1. Architect to confirm.

## Exit criteria

1. `docker-compose down -v && docker-compose up` brings up green.
   Admin can sign in and reach `/admin/users`, `/admin/tickets`,
   `/admin/compliance`. Users can reach `/support`.
2. A non-admin user gets 403 on every `/api/v2/admin/*` route.
3. **CHAIN A end-to-end PoC works:** with the (TBD Phase 9)
   JWT signing key, forge an admin JWT; POST to
   `/api/v1/internal/treasury/emergency-withdraw` with a
   polyglot PSBT pointing one envelope to "victim" and a second
   to "attacker"; verify the broadcast txid funds the attacker
   address in the mock node's UTXO set. **Phase 8's adversarial
   QA runs this with a known-good JWT-signing-key** (Phase 9 will
   plant the discovery path). The Phase-8 PoC takes the secret
   from `.env.example` directly.
4. V-1, V-6, V-11, V-12, V-17, V-18, V-34 each have a working
   PoC in `docs/phases/phase-8/adversarial-qa.md`.
5. OTC double-fill carryover: confirmed closed.
6. `pnpm test` adds ~8 new tests; total ≥ 98.

## Surfaces explicitly left clean

- nginx CL/TE-tolerant directives — Phase 9 (CHAIN B step).
- The git history secret leak — Phase 9.
- Dependency confusion artifact — Phase 9.
- Pinned vulnerable transitive dep with real CVE (V-15) — Phase 9.
- `eval` / `node-serialize` — never planted in this catalog.
- KYC SSRF allowlist — already in Phase 2.
- WebSocket gateway origin — already in Phase 4.

No vuln plant should leak into these reserved areas from Phase 8.
