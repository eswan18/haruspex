# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MCP endpoint at `/mcp` that lets an agent, signed in as a haruspex user through identity's OAuth, list competitions, categories and props, read a prop, and create and resolve props.

**Architecture:** The logic of the needed server actions moves into a server-only core layer (`lib/core/`) of functions that take the caller as an argument; the existing actions become wrappers that read the cookie and call the core. A token gate (`lib/mcp/auth.ts`) verifies identity's audience-bound access tokens and maps them to a user; a per-request `McpServer` (`lib/mcp/server.ts`) registers six tools that call the core through plain tool functions (`lib/mcp/tools.ts`); `app/mcp/route.ts` serves it with the SDK's `createMcpHandler`.

**Tech Stack:** Next.js 16.4 route handlers, Kysely + PostgreSQL RLS, `jose` 6, `zod` 4, `@modelcontextprotocol/server` 2.4.0 (+ `@modelcontextprotocol/client` 2.4.0 as a dev dependency for tests), Vitest with testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-19-mcp-server-design.md`. Reference implementation of the same pattern: `../sensibility/src/sensibility/mcp/` (`tokens.py`, `gate.py`, `tools.py`).

## Global Constraints

- MCP URL (OAuth resource, exact token `aud`): `https://haruspex.fyi/mcp` (prod), `https://staging.haruspex.fyi/mcp` (staging), from env `MCP_RESOURCE_URL`. Unset → every `/mcp` request refused (fail closed).
- Scopes: `haruspex:read`, `haruspex:write`.
- Token checks: ES256 via identity's JWKS; header `typ` is `at+jwt` or `application/at+jwt` (case-insensitive); `iss` exactly `IDP_PUBLIC_URL`; `aud` contains `MCP_RESOURCE_URL` exactly; `exp`, `iat`, `sub`, `client_id` present.
- The core layer is `import "server-only"` and never `"use server"`. A `"use server"` file must export only actions that resolve the caller themselves (every export is browser-callable).
- Existing server actions keep their names, signatures and behavior; existing tests pass unchanged except where a task says otherwise.
- MCP calls: no impersonation, no `recordActiveDay`, no user creation (unknown `sub` → 403).
- Tools see what the browser shows, even for site admins: personal props only the caller's own; private competitions (and their props) only where the caller is a member.
- `create_prop` never notifies members unless `notify_members: true`.
- Deadline validation in `createProp` is unchanged.
- No raw Tailwind palette colours, no UI changes (this work has no UI).
- Read `node_modules/next/dist/docs/` before writing route handlers (CLAUDE.md). This app does not enable Cache Components; route handlers still declare `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"`, as `app/api/health/route.ts` does.
- Infra steps (identity-cli registration, applying k8s, promoting) are Ethan's; the plan only edits manifests in this repo.

## Review Focus

1. A cookieless request to `/mcp` must get a **401 with `WWW-Authenticate`**, not the proxy's redirect to `/login` — otherwise Claude never starts sign-in. Pinned in Task 6.
2. A valid identity token **minted for another app** (sensibility's `aud`) or an ID token (no `typ`) must be rejected with 401 `invalid_token`. Pinned in Task 4.
3. A **site admin's agent** must not see other users' personal props or private competitions they are not in, via `list_props`, `get_prop` or `list_competitions`. Pinned in Tasks 1, 2 and 5.
4. A **non-admin adding a prop to a public season** (or a forecaster to a private one) must get a clear "not allowed" tool error, not "Failed to create proposition" from an RLS exception. Pinned in Task 3.
5. A competition or category **name that matches several rows, or none**, must fail with the candidates listed, never pick one silently. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/core/feature-flags.ts` (create) | `featureEnabled(userId, name)` |
| `lib/core/categories.ts` (create) | `listCategories(caller)` |
| `lib/core/competitions.ts` (create) | `listCompetitions(caller, opts)`, `listWritableCompetitions(caller)` |
| `lib/core/props.ts` (create) | `listProps`, `getProp`, `createProp`, `resolveProp`, `resolveRefusal` |
| `lib/core/views.ts` (create) | `CoreView` type and the member-view SQL filters shared by props and competitions |
| `lib/db_actions/{feature_flags,categories,competitions,props}.ts` (modify) | wrappers over the core |
| `lib/mcp/config.ts` (create) | `mcpConfig()` from env |
| `lib/mcp/auth.ts` (create) | token verification, caller lookup, HTTP refusals |
| `lib/mcp/names.ts` (create) | id-or-name resolution for competitions and categories |
| `lib/mcp/tools.ts` (create) | the six tools as plain functions `(caller, args) → ToolOutcome` |
| `lib/mcp/server.ts` (create) | `buildMcpServer(caller)`: registers tools, schemas, annotations, scopes |
| `app/mcp/route.ts` (create) | POST/GET/DELETE → gate → `createMcpHandler` |
| `app/.well-known/oauth-protected-resource/mcp/route.ts` (create) | RFC 9728 metadata |
| `proxy.ts` (modify) | public routes |
| `k8s/haruspex-{staging,prod}/configmap-env.yaml` (modify) | `MCP_RESOURCE_URL` |
| `CLAUDE.md`, `README.md` (modify) | MCP section, rollout steps |

---

### Task 1: Core reads for feature flags, categories and competitions

**Files:**
- Create: `lib/core/feature-flags.ts`, `lib/core/categories.ts`, `lib/core/competitions.ts`, `lib/core/views.ts`
- Modify: `lib/db_actions/feature_flags.ts` (`hasFeatureEnabled`), `lib/db_actions/categories.ts` (`getCategories`), `lib/db_actions/competitions.ts` (`getCompetitions`, `getWritableCompetitions`)
- Test: `tests/integration/core-reads.integration.test.ts` (create)

**Interfaces:**
- Produces:
  - `type CoreView = "rls" | "member"` (`lib/core/views.ts`). `"rls"` returns what RLS allows (today's action behavior, which admin pages rely on). `"member"` additionally drops personal props not owned by the caller and private competitions (and their props) the caller is not a member of.
  - `featureEnabled(userId: number, featureName: string): Promise<boolean>` — the query now in `hasFeatureEnabled` (user row beats the null-user row; unset is false). Throws on DB error.
  - `listCategories(caller: VUser | null): Promise<ServerActionResult<Category[]>>`
  - `listCompetitions(caller: VUser | null, opts?: { view?: CoreView }): Promise<ServerActionResult<CompetitionWithRole[]>>` where `CompetitionWithRole = Competition & { role: CompetitionRole | null; can_add_props: boolean }`; `can_add_props` from `canCreateProps`; ordered as `getCompetitions` orders today (`name desc`). Default view `"rls"`.
  - `listWritableCompetitions(caller: VUser): Promise<ServerActionResult<Competition[]>>` — today's `getWritableCompetitions` body.
  - `CompetitionRole` stays exported from `lib/db_actions/competition-members.ts` (import it as `import type`).

- [ ] **Step 1: Write the failing tests** (container, connected as `app_user` exactly as `tests/integration/user-actions-rls.integration.test.ts` does — copy its `vi.mock` block for `@/lib/database`, `server-only`, `next/cache`). Tests:
  - `featureEnabled` returns true for a user-specific `personal-props` row over a global false row, and false when no row exists.
  - `listCompetitions(siteAdmin, { view: "member" })` omits a private competition the admin is not a member of; `listCompetitions(siteAdmin)` (default `"rls"`) includes it.
  - `listCompetitions(member, { view: "member" })` includes the member's private competition with `role: "forecaster"`, `can_add_props: false`; a competition admin gets `role: "admin"`, `can_add_props: true`; a public season gives a non-admin `can_add_props: false` and a site admin `true`.
  - `listCategories(null)` returns the seeded categories.
- [ ] **Step 2: Run to verify they fail**
  Run: `TEST_USE_CONTAINERS=true npx vitest run tests/integration/core-reads.integration.test.ts`
  Expected: FAIL, cannot resolve `@/lib/core/...`.
- [ ] **Step 3: Implement the four core files**, moving the bodies (logging included) out of the actions. The `"member"` competition filter: `where is_private = false or exists (select 1 from competition_members where competition_id = competitions.id and user_id = caller.id)`; with a null caller, public only.
- [ ] **Step 4: Turn the four actions into wrappers**: resolve `getUserFromCookies()`, apply each action's existing auth check (`hasFeatureEnabled` keeps its "user is who they say" check and its `ServerActionResult` shape), call the core. `getCompetitions` passes the core's rows through unchanged; its declared return type stays `Competition[]` (a `CompetitionWithRole` is one, and callers ignore the extra fields).
- [ ] **Step 5: Run the new tests and the whole suite**
  Run: `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run`
  Expected: all pass, including the untouched `user-actions-rls` and the existing competitions/feature-flag unit tests.
- [ ] **Step 6: Commit** — `git commit -m "Move competition, category and flag reads into lib/core"`

### Task 2: Core prop reads with a member view

**Files:**
- Modify: `lib/core/props.ts` (create in this task), `lib/db_actions/props.ts` (`getProps`, `getPropById`)
- Test: `tests/integration/core-reads.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `CoreView` (Task 1).
- Produces:
  - `type PropWithOptions = VProp & { options: PropOptionSummary[] }`
  - `listProps(caller: VUser | null, filters: { competitionId?: (number | null)[] | number | null; userId?: (number | null)[] | number | null; view?: CoreView }): Promise<ServerActionResult<VProp[]>>` — today's `getProps` semantics for the two id filters, `prop_id asc`.
  - `getProp(caller: VUser | null, propId: number, opts?: { view?: CoreView }): Promise<ServerActionResult<PropWithOptions | null>>`
  - Member view on props: `prop_user_id is null or prop_user_id = caller.id`, and `competition_id is null or competition_is_private = false or <caller is a member>`.

- [ ] **Step 1: Write the failing tests**:
  - `listProps(siteAdmin, { view: "member" })` excludes another user's personal prop and a prop of a private competition the admin is not in; `listProps(siteAdmin, {})` includes both (admin pages depend on this).
  - `getProp(siteAdmin, otherUsersPersonalPropId, { view: "member" })` → `success(null)`; with default view → the prop.
  - `getProp(owner, ownPersonalPropId, { view: "member" })` returns it with `options` for a choice prop.
- [ ] **Step 2: Run to verify they fail** (same command as Task 1, file filter). Expected: FAIL, `listProps` not exported.
- [ ] **Step 3: Implement `listProps` and `getProp`** by moving the bodies from `getProps`/`getPropById`; add the member-view `where` clauses.
- [ ] **Step 4: Wrappers**: `getProps`/`getPropById` call the core with `view` omitted.
- [ ] **Step 5: Run the whole suite** (Task 1 command). Expected: all pass; `lib/db_actions/props.test.ts` mocks `@/lib/db-helpers` by path, so keep the core importing exactly `@/lib/db-helpers`.
- [ ] **Step 6: Commit** — `git commit -m "Move prop reads into lib/core, with a member view"`

### Task 3: Core prop writes

**Files:**
- Modify: `lib/core/props.ts`, `lib/db_actions/props.ts` (`createProp`, `resolveProp`, `unresolveProp`, `deleteResolution`)
- Test: `tests/integration/user-actions-rls.integration.test.ts` (extend), `lib/db_actions/props.test.ts` (only if a mock shape must follow the move)

**Interfaces:**
- Consumes: `featureEnabled` (Task 1), `canCreateProps`/`canResolveProp` (`lib/prop-write-access.ts`).
- Produces:
  - `createProp(caller: VUser, input: { prop: NewProp; options?: string[]; notifyMembers?: boolean }): Promise<ServerActionResult<{ propId: number }>>`
  - `resolveProp(caller: VUser, input: { propId: number; resolution?: boolean; outcomes?: OptionOutcome[]; notes?: string; overwrite?: boolean }): Promise<ServerActionResult<void>>`
  - `resolveRefusal(trx, user, prop, verb)` moves here from `lib/db_actions/props.ts` and is exported (the core is not a server-action file); `unresolveProp`/`deleteResolution` stay actions and import it.
  - The action `createProp` keeps returning `ServerActionResult<void>`.

- [ ] **Step 1: Write the failing tests** (through the real actions as `app_user`, in the existing file's style):
  - A user without the `personal-props` flag calling `createProp` with `user_id: <self>`, no competition → `success: false`, `code: "UNAUTHORIZED"`, no row written. With the flag set for them → ok.
  - A plain reader calling `createProp` for a public season → `code: "UNAUTHORIZED"` (today: `DATABASE_ERROR` from the RLS exception).
  - A forecaster calling `createProp` for their private competition → `code: "UNAUTHORIZED"` (today's message already says "Only competition admins can create props"; assert the code).
- [ ] **Step 2: Run to verify they fail.** Expected: the flag test and the public-season test FAIL; the forecaster test may already pass (keep it as a guard).
- [ ] **Step 3: Implement core `createProp`** by moving the action body, adding: personal prop (`prop.user_id !== null`) requires `prop.user_id === caller.id` and `featureEnabled(caller.id, "personal-props")`; a competition prop requires `canCreateProps({ isPrivate, role, isSiteAdmin })` (replacing the inline private-only membership check). Return `{ propId }`. `revalidatePath` and the `announcePropAdded` fire-and-forget stay in the core.
- [ ] **Step 4: Implement core `resolveProp`** by moving the action body unchanged.
- [ ] **Step 5: Wrappers**: actions resolve the user, return `UNAUTHORIZED` "You must be logged in…" when null (as today), call the core; `createProp` maps `{ propId }` to `success(undefined)`.
- [ ] **Step 6: Run the whole suite.** Expected: all pass.
- [ ] **Step 7: Commit** — `git commit -m "Move prop writes into lib/core; createProp checks the flag and season admin"`

### Task 4: Token gate

**Files:**
- Create: `lib/mcp/config.ts`, `lib/mcp/auth.ts`
- Modify: `lib/idp/client.ts` (export `getJWKS`)
- Test: `lib/mcp/auth.test.ts` (unit, local ES256 keys), `tests/integration/mcp-auth.integration.test.ts` (caller lookup)

**Interfaces:**
- Produces:
  - `const READ_SCOPE = "haruspex:read"`, `const WRITE_SCOPE = "haruspex:write"`, `const SCOPES = [READ_SCOPE, WRITE_SCOPE] as const`
  - `interface McpConfig { resource: string; issuer: string; metadataUrl: string }`; `mcpConfig(): McpConfig | null` from `MCP_RESOURCE_URL` and `IDP_PUBLIC_URL` (null if either unset); `metadataUrl` = `getOAuthProtectedResourceMetadataUrl(new URL(resource))` from the SDK (→ `…/.well-known/oauth-protected-resource/mcp`).
  - `verifyAccessToken(token: string, config: McpConfig, keys: jose.JWTVerifyGetKey): Promise<VerifiedToken>` where `VerifiedToken = { sub: string; clientId: string; scopes: string[]; expiresAt: number }`; throws `InvalidTokenError` (message for logs only).
  - `authenticate(request: Request, deps?: { config?: McpConfig | null; keys?: jose.JWTVerifyGetKey; findUser?: (sub: string) => Promise<VUser | undefined> }): Promise<{ caller: VUser; authInfo: AuthInfo } | Response>` — `authInfo` is the SDK's `AuthInfo` (`token`, `clientId`, `scopes`, `expiresAt`, `resource: new URL(config.resource)`, `resourceMetadataUrl: config.metadataUrl` so the SDK's per-tool step-up 403s advertise the metadata document, `extra: { caller }`). Defaults: `mcpConfig()`, `getJWKS()`, a `v_users` lookup by `idp_user_id`.
  - Refusals (use the SDK's `bearerAuthChallengeResponse` with `resourceMetadataUrl: config.metadataUrl` where it fits):
    - config null → 503, body says MCP is not configured.
    - no `Authorization: Bearer` → 401, `WWW-Authenticate: Bearer resource_metadata="<metadataUrl>", scope="haruspex:read haruspex:write"`.
    - bad token → 401 `error="invalid_token"`.
    - token has neither scope → 403 `error="insufficient_scope"`, `scope="haruspex:read"`.
    - unknown `sub` → 403, body: "No haruspex account for this sign-in yet. Sign in at <APP_BASE_URL> once, then reconnect."
    - deactivated user → 403.

- [ ] **Step 1: Write the failing unit tests** in `lib/mcp/auth.test.ts`, generating a key pair with `jose.generateKeyPair("ES256")` and a local JWKS (`jose.createLocalJWKSet`). One test each: accepts a good token (scopes split from the space-separated `scope` claim); rejects wrong `aud` (`https://sensibility.money/mcp`); wrong `iss`; missing `typ`; `typ: "JWT"`; expired; missing `client_id`; HS256-signed. `authenticate` tests with injected `findUser`: no header → 401 with the exact `WWW-Authenticate` above; unknown sub → 403; deactivated → 403; no haruspex scope → 403 `insufficient_scope`; config null → 503.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run lib/mcp/auth.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `config.ts` and `auth.ts` (`jose.jwtVerify(token, keys, { issuer, audience: resource, algorithms: ["ES256"], typ: "at+jwt" })` — confirm jose's `typ` check is case-insensitive and accepts `application/at+jwt`; if not, check the protected header yourself). Export `getJWKS` from `lib/idp/client.ts` unchanged.
- [ ] **Step 4: Write and run the integration test** for the default `findUser`: a seeded user is found by `idp_user_id`. Run with `TEST_USE_CONTAINERS=true`.
- [ ] **Step 5: Run the suite.** Expected: all pass.
- [ ] **Step 6: Commit** — `git commit -m "Add the MCP token gate"`

### Task 5: Tool functions

**Files:**
- Create: `lib/mcp/names.ts`, `lib/mcp/tools.ts`
- Test: `tests/integration/mcp-tools.integration.test.ts` (container, `app_user`)

**Interfaces:**
- Consumes: Tasks 1–3 core functions (always with `view: "member"` for reads).
- Produces:
  - `type ToolOutcome<T> = { ok: true; data: T; summary: string } | { ok: false; error: string }` (`summary` is the one-line text beside structured content).
  - `resolveCompetition(caller: VUser, ref: number | string): Promise<{ ok: true; competition: CompetitionWithRole } | { ok: false; error: string }>` and `resolveCategory(caller, ref)` likewise — id exact; name case-insensitive exact match; zero or several matches → error naming up to 10 candidates (`No competition "x". Did you mean: …?` / `"x" matches several competitions: … — pass an id.`).
  - Result shapes (snake_case, dates as ISO strings with offset):
    - `CompetitionResult = { id, name, is_private, status: CompetitionStatus, forecasts_open_date, forecasts_close_date, end_date, your_role: "admin" | "forecaster" | null, can_add_props }`
    - `PropResult = { id, text, kind, options: { id, text, outcome, your_probability }[], competition: { id, name } | null, personal: boolean, category: { id, name } | null, forecasts_due_date, resolution_due_date, status: "open" | "closed" | "resolved", resolution: boolean | null }`; `PropDetail = PropResult & { notes: string | null; your_forecast: number | null }`.
    - `status` from `getPropStatusFromProp`: `open` → `open`, `unresolved` → `closed`, `resolved*` → `resolved`.
  - Tools (each `(caller: VUser, args) => Promise<ToolOutcome<…>>`):
    - `listCompetitionsTool(caller, {})` → `{ competitions: CompetitionResult[] }`
    - `listCategoriesTool(caller, {})` → `{ categories: { id, name }[] }`
    - `listPropsTool(caller, { competition?: number | string; personal?: boolean; status?: "open" | "closed" | "resolved"; limit?: number })` → `{ props: PropResult[]; truncated: boolean }`; `limit` default 50, max 200; newest first (`id desc`); `competition` and `personal: true` together → error.
    - `getPropTool(caller, { prop_id: number })` → `PropDetail`; not visible → error "No prop <id> (or not one you can see)".
    - `createPropTool(caller, { text; kind?: "binary" | "one_of" | "any_of"; options?: string[]; competition?: number | string; personal?: boolean; category?: number | string; forecasts_due_date?: string; resolution_due_date?: string; notes?: string; notify_members?: boolean })` → `PropDetail` of the new prop. Exactly one of `competition` / `personal: true`, else error. Personal → `user_id: caller.id`. `notify_members` default false.
    - `resolvePropTool(caller, { prop_id; resolution?: boolean; outcomes?: { option_id: number; outcome: boolean }[]; notes?: string; overwrite?: boolean })` → `PropDetail`.
  - Core `validationError`s become `error` text naming each field and message (`text: Proposition text must be at least 8 characters long`).

- [ ] **Step 1: Write the failing tests** (call the tool functions directly as seeded users):
  - `resolveCompetition` by id; by name in different case; ambiguous name (two competitions named `Q1` and `q1`) → error listing both ids; unknown name → error with candidates.
  - `listPropsTool` as a site admin omits another user's personal prop (Review Focus 3); `status: "resolved"` returns only resolved props; `limit: 1` over two props → one prop, `truncated: true`.
  - `getPropTool` returns `your_forecast` for a binary prop the caller forecasted, and `your_probability` per option on a choice prop.
  - `createPropTool` personal with the flag → prop returned with `personal: true`; with both `competition` and `personal` → error; as a reader into a public season → error mentioning not allowed (Review Focus 4); `notify_members` omitted → `publishEvent` mock not called; `notify_members: true` on a private competition with members → called.
  - `resolvePropTool` by the owner of a personal binary prop → `status: "resolved"`, `resolution: true`; by a forecaster → error.
- [ ] **Step 2: Run to verify they fail.** Run: `TEST_USE_CONTAINERS=true npx vitest run tests/integration/mcp-tools.integration.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `names.ts` and `tools.ts`.**
- [ ] **Step 4: Run the tests and the suite.** Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "Add the MCP tool functions"`

### Task 6: MCP server, routes and proxy

**Files:**
- Create: `lib/mcp/server.ts`, `app/mcp/route.ts`, `app/.well-known/oauth-protected-resource/mcp/route.ts`
- Modify: `proxy.ts` (`PUBLIC_ROUTES`), `package.json` (add `@modelcontextprotocol/server@2.4.0`, dev `@modelcontextprotocol/client@2.4.0`)
- Test: `app/mcp/route.test.ts`, `app/.well-known/oauth-protected-resource/mcp/route.test.ts`, `proxy.test.ts` (create or extend whichever exists)

**Interfaces:**
- Consumes: `authenticate` (Task 4), the six tool functions (Task 5).
- Produces:
  - `buildMcpServer(caller: VUser): McpServer` — server name `haruspex`; registers the six tools with names `list_competitions`, `list_categories`, `list_props`, `get_prop`, `create_prop`, `resolve_prop`; zod `inputSchema`/`outputSchema` matching Task 5; `annotations.readOnlyHint: true` on the four reads; `scopeChallenge: requireScopes("haruspex:read")` on reads and `requireScopes("haruspex:write")` on `create_prop`/`resolve_prop`; each write tool also re-checks `WRITE_SCOPE` in `authInfo.scopes` (backstop). A `ToolOutcome` with `ok: false` becomes `{ isError: true, content: [{ type: "text", text: error }] }`; `ok: true` becomes `structuredContent: data` plus `content: [{ type: "text", text: summary }]`. Tool descriptions say what each does and, for `create_prop`, that props in a private competition need both deadlines.
  - `app/mcp/route.ts`: one module-scope `createMcpHandler((ctx) => buildMcpServer(callerFor(ctx)))` with `legacy: "stateless"`; `POST`, `GET`, `DELETE` each run `authenticate(request)` and return its `Response` if refused, else `handler.fetch(request, { authInfo })`. The caller reaches the factory through `authInfo.extra.caller` (`authenticate` sets `extra: { caller }`; the SDK passes `authInfo` to the factory untouched as `ctx.authInfo`). No `ctx.authInfo?.extra?.caller` → the factory throws (unreachable behind the gate).
  - PRM route `GET` → JSON `{ resource, authorization_servers: [issuer], scopes_supported: ["haruspex:read", "haruspex:write"], bearer_methods_supported: ["header"], resource_name: "Haruspex" }`; config null → 404. Built by hand (not `buildOAuthProtectedResourceMetadata`) unless that helper is confirmed not to add a trailing slash to the path-less issuer.
  - `proxy.ts`: add `"/mcp"` and `"/.well-known/oauth-protected-resource"` to `PUBLIC_ROUTES`.

- [ ] **Step 1: Write the failing tests:**
  - PRM: with env set, `GET` returns the JSON above exactly (`resource` equals `MCP_RESOURCE_URL`, `authorization_servers[0]` equals `IDP_PUBLIC_URL` with no trailing slash).
  - `/mcp` `POST` with no token → 401 and the exact `WWW-Authenticate` from Task 4 (Review Focus 1, at the route).
  - `proxy`: a cookieless request to `/mcp` and to `/.well-known/oauth-protected-resource/mcp` passes through (`NextResponse.next()`), not a redirect.
  - With `authenticate` mocked to a read-only caller: an SDK client (`@modelcontextprotocol/client`, its fetch pointed at the route's `POST`) lists exactly the six tool names; `list_categories` returns structured content; `create_prop` gets HTTP 403 with `error="insufficient_scope"` and `scope` containing `haruspex:write` — for both a modern (2026-07-28) request and a legacy request (`MCP-Protocol-Version: 2025-11-25`, a bare `tools/call` POST). If the SDK's `scopeChallenge` does not cover the legacy path, add a pre-check in the route that reads the JSON-RPC body (as `../sensibility/src/sensibility/mcp/gate.py` does) and make this test pass.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run app/mcp app/.well-known proxy`. Expected: FAIL.
- [ ] **Step 3: `npm install @modelcontextprotocol/server@2.4.0 && npm install -D @modelcontextprotocol/client@2.4.0`**, then implement `server.ts`, both routes and the proxy change.
- [ ] **Step 4: Run the tests, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and the whole suite.** Expected: all pass; `next build` lists `/mcp` and `/.well-known/oauth-protected-resource/mcp` as dynamic (ƒ) routes.
- [ ] **Step 5: Local smoke test:** `ENV=local npm run dev`, then `curl -i -X POST localhost:3000/mcp` → 401 with `WWW-Authenticate`; `curl -s localhost:3000/.well-known/oauth-protected-resource/mcp` → the JSON (set `MCP_RESOURCE_URL=http://localhost:3000/mcp` in `.env.local`).
- [ ] **Step 6: Commit** — `git commit -m "Serve the MCP endpoint and its protected resource metadata"`

### Task 7: Config and docs

**Files:**
- Modify: `k8s/haruspex-staging/configmap-env.yaml`, `k8s/haruspex-prod/configmap-env.yaml`, `CLAUDE.md`, `README.md`, the design doc's **Status** line

- [ ] **Step 1: Add `MCP_RESOURCE_URL`** — staging `"https://staging.haruspex.fyi/mcp"`, prod `"https://haruspex.fyi/mcp"` — beside `APP_BASE_URL`. Run `kubectl kustomize k8s/haruspex-staging >/dev/null && kubectl kustomize k8s/haruspex-prod >/dev/null` (render only; never apply). Expected: no error.
- [ ] **Step 2: CLAUDE.md** — a short *MCP* section under Key Features: where it lives (`lib/core/`, `lib/mcp/`, `app/mcp/`), the two scopes, the member-view rule, the "never `use server` in `lib/core`" rule, and that the core is where new agent-reachable rules go.
- [ ] **Step 3: README.md** — rollout steps for Ethan: register both resources with `identity-cli resource create --uri <url> --name "<Haruspex | Haruspex (staging)>" --scope "haruspex:read=Read competitions and props" --scope "haruspex:write=Add and resolve props" --dynamic-clients` in **both** identity databases; staging is reachable only from the tailnet, so test it with Claude Code (`claude mcp add --transport http haruspex-staging https://staging.haruspex.fyi/mcp`), and claude.ai against prod after `bif promote haruspex`.
- [ ] **Step 4: Design doc status** → "Built; awaiting identity registration and end-to-end test."
- [ ] **Step 5: Commit** — `git commit -m "Configure MCP_RESOURCE_URL and document the MCP server"`
