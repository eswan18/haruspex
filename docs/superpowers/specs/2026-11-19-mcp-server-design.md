# MCP Server: agent access to props via identity

**Date:** 2026-11-19
**Status:** Built; awaiting identity registration and end-to-end test.

## Intent

Let an agent (Claude on claude.ai, desktop, mobile and Claude Code, or any other
MCP client) act in haruspex **as a signed-in user**: list props, read one, add
new ones, and resolve them. Automations should be able to keep a competition or
a personal prop list stocked without anyone opening the site.

Sensibility already does this (`sensibility/docs/superpowers/specs/2026-10-25-mcp-agent-access-design.md`,
built in `sensibility/src/sensibility/mcp/`), and identity's side — resource
indicators, audience-bound tokens, CIMD, consent — is built and in use by it.
Haruspex follows the same pattern, so this is mostly haruspex-side work.

## Goals

- An MCP endpoint at `/mcp`, authenticated by identity's OAuth access tokens.
- Six tools (below): `list_competitions`, `list_categories`, `list_props`,
  `get_prop`, `create_prop`, `resolve_prop`.
- A **core layer** of plain functions that take the caller as an argument, which
  both the existing server actions and the MCP tools call — so the rules live in
  one place and a REST API could later sit on the same core.

## Non-goals

- A REST/JSON API. Dropped for now: its only extra value was unattended
  scripts, which would need a new credential type (see *Approaches*).
- Per-user API keys.
- Forecasting tools. Agents forecasting in a competition is a fairness question
  to settle separately.
- Editing or deleting props, managing members, sending email (beyond
  `create_prop`'s opt-in), admin features.

## Anti-goals (a failure even if it works)

- **An MCP caller can do anything the same user could not do in the browser.**
  Permissions come from RLS and the same checks the server actions run; the
  token's scope can only narrow them.
- **Accepting a token minted for another app.** The existing `validateIDPToken`
  does not check audience; reusing it would let a sensibility token work here.
- **An agent mailing a whole competition by accident.** `create_prop` never
  notifies members unless the call explicitly asks.
- **Exposing a "run as any user" function.** Every export of a `"use server"`
  file is a client-callable endpoint, so the core layer must never live in one.

## Approaches considered

1. **Explicit core functions (chosen).** Split each needed action into a core
   function taking the caller (`createProp(caller, input)`); the server action
   becomes a thin wrapper that reads the cookie and calls it. No hidden state;
   each core function is testable directly against RLS. Most edits.
2. **Ambient caller.** The MCP gate stores the verified user in
   `AsyncLocalStorage` and `getUserFromCookies()` consults it first; every
   existing action works unchanged. Smallest change, but identity arrives
   invisibly, and impersonation and active-day logging would quietly apply to
   MCP calls unless carved out. Rejected.
3. **A separate MCP service** calling haruspex. Needs the API we are not
   building. Rejected.

On auth: API keys were considered so cron-style scripts could call a REST API.
identity's refresh tokens rotate (single use, reuse revokes the family) and a
family dies after 90 days, which makes identity tokens poor for unattended
scripts but fine for MCP clients, which manage OAuth themselves. With REST
dropped, identity tokens alone suffice.

## Design

### Names (hard to change once people connect)

- MCP URL, which is the OAuth resource and the exact token `aud`:
  **`https://haruspex.fyi/mcp`**; staging **`https://staging.haruspex.fyi/mcp`**.
- Scopes: **`haruspex:read`** and **`haruspex:write`**.

### Pieces

**Core layer — `lib/core/`** (new; `import "server-only"`, never `"use server"`).
Functions taking `caller: VUser` (or `null` where anonymous reads make sense
today) and returning `ServerActionResult<T>`, holding the logic now in:

| Today (`lib/db_actions/`) | Core |
|---|---|
| `getProps`, `getPropById` | `listProps(caller, filters)`, `getProp(caller, id)` |
| `createProp` | `createProp(caller, input)` |
| `resolveProp` | `resolveProp(caller, input)` |
| `getCompetitions`, `getWritableCompetitions` | `listCompetitions(caller)` (with role and can-add) |
| `getCategories` | `listCategories(caller)` |

The server actions keep their names and signatures and become wrappers:
resolve the user with `getUserFromCookies()`, call the core. Pages and forms
do not change. Side effects that belong to the action — `revalidatePath`,
the prop-added announcement — move into the core so MCP writes get them too.

**One behavior change:** `createProp` (core) enforces the `personal-props`
feature flag for personal props. Today only the page checks it, so the server
action is callable without it. Deadline validation is otherwise left exactly
as it is (decided 2026-11-19): `createProp` validates deadlines only when both
are given, and the tool's schema mirrors that rather than the browser form's
stricter rule.

**Visibility matches the browser, not RLS** (decided 2026-11-19). RLS lets a
site admin read every personal prop and every private competition; the
browser never shows them. The core's list/get functions return what the
browser would show:
- Personal props: the caller's own only, even for a site admin.
- Private competitions and their props: only those the caller belongs to,
  even for a site admin.
- Public seasons and their props: everyone.

**Depends on #235** (merged first): who may resolve is `canResolveProp` in
`lib/prop-write-access.ts`, checked by `resolveProp` and enforced by the
`manage_resolutions` policy. Before #235, any reader could resolve any prop
they could see.

**Token gate — `lib/mcp/auth.ts`.** Given a request, returns the caller or the
HTTP response to send:

- Verify with `jose` against identity's JWKS (reuse `getJWKS` from
  `lib/idp/client.ts`): ES256, header `typ` `at+jwt` (or
  `application/at+jwt`), `iss` exactly `IDP_PUBLIC_URL`, `aud` containing
  `MCP_RESOURCE_URL` exactly, and `exp`, `iat`, `sub`, `client_id` present.
- Missing token → **401** with
  `WWW-Authenticate: Bearer resource_metadata="<PRM URL>"`, scope
  `haruspex:read haruspex:write`. Bad token → 401 `error="invalid_token"`.
  Claude starts sign-in only on a real 401.
- `sub` → `v_users.idp_user_id`. No such user → **403** telling them to sign
  in at haruspex.fyi once first (users are created by the browser login; the
  MCP path does not create them). Deactivated → 403.
- Neither scope → 403 `insufficient_scope`. A `tools/call` of a write tool
  without `haruspex:write` → 403 `error="insufficient_scope"`,
  `scope="haruspex:write"` (step-up), decided by reading the JSON-RPC body, as
  sensibility's `gate.py` does. Each write tool re-checks (backstop).
- `MCP_RESOURCE_URL` unset → every request refused (fail closed).
- No impersonation, and no `recordActiveDay` (the Stats page counts browser
  sign-ins; that meaning stays).

**MCP server — `app/mcp/route.ts`.** `@modelcontextprotocol/server` 2.4 (the
v2 TS SDK: speaks MCP 2026-07-28, with a fallback for older revisions, which
Claude still uses). Stateless, web-standard request→response handler (its
`createMcpHandler` / `WebStandardStreamableHTTPServerTransport`), so it runs in
a Next.js route handler with no adapter. The gate runs first; the verified
caller reaches tools through the handler's context (or an explicit closure per
request).

**Protected resource metadata —
`app/.well-known/oauth-protected-resource/mcp/route.ts`.** RFC 9728 JSON:
`resource` = `MCP_RESOURCE_URL`, `authorization_servers` = [`IDP_PUBLIC_URL`]
(Claude uses only the first), `scopes_supported`, `bearer_methods_supported:
["header"]`. Our own route, as sensibility does, so nothing adds a trailing
slash to the issuer.

**`proxy.ts`.** Add `/mcp` and `/.well-known/oauth-protected-resource` to
`PUBLIC_ROUTES`. Without this the proxy redirects a cookieless MCP request to
`/login`, the client sees a 3xx/200 instead of a 401, and sign-in never starts.

**Config.** `MCP_RESOURCE_URL` in `k8s/haruspex-staging` and `k8s/haruspex-prod`
env config, and in `.env.*` locally.

### Tools

Read tools need `haruspex:read`; write tools need `haruspex:write`. Both are
then subject to everything RLS and the core enforce for that user.

| Tool | Does |
|---|---|
| `list_competitions` | Competitions you can see: id, name, public/private, status (upcoming/open/closed/ended, from `lib/competition-status.ts`), key dates, your role, and whether you can add props (`canCreateProps`) |
| `list_categories` | Categories: id and name |
| `list_props` | Props you can see. Filters: `competition` (id or name), `personal: true`, `status` (`open`/`closed`/`resolved`, from `lib/prop-status.ts`), `limit` (default 50, max 200). Each row: id, text, kind, options, competition, category, deadlines, status, resolution |
| `get_prop` | One prop by id: the above plus notes, your forecast if any, and each option's outcome for resolved choice props |
| `create_prop` | `text`, `kind` (`binary` default, `one_of`, `any_of`), `options` (choice kinds), exactly one of `competition` (id or name) or `personal: true`, `category` (id or name; required where the core requires it), `forecasts_due_date` / `resolution_due_date` (optional, validated together as the core does today), `notes`, `notify_members` (default **false**). Returns the created prop in `get_prop`'s shape |
| `resolve_prop` | `prop_id`, `resolution` (binary) or `outcomes` (choice), `notes`, `overwrite` (default false). Returns the prop in `get_prop`'s shape |

Conventions:
- Props are referred to by id (their text is long and not unique enough to type).
  Competitions and categories accept an id or an exact name, case-insensitive;
  an unknown or ambiguous name fails with the candidates.
- Validation errors from the core come back as tool errors naming the field and
  what to fix (the core's `validationError` messages already do).
- Results are structured (output schemas) with a one-line text summary.
- Dates are ISO 8601 with offset, in and out.
- Annotations: reads `readOnlyHint`; `resolve_prop` is idempotent only with the
  same inputs, so neither write is marked idempotent; nothing is destructive.

### Testing

- **Core:** container tests through RLS as `app_user` for each core function
  (the `tests/integration/user-actions-rls.integration.test.ts` pattern), in
  particular: a non-admin cannot add to a public season or someone else's
  private competition; personal props need the flag; `notify_members` defaults
  off; a site admin's `listProps`/`getProp` does not return another user's
  personal props or a private competition they are not in.
- **Gate:** unit tests with a locally generated ES256 key: wrong `aud`, wrong
  `iss`, missing `typ`, expired, unknown `sub`, deactivated, read token calling
  a write tool (403 step-up), unset `MCP_RESOURCE_URL`.
- **Server actions:** existing tests keep passing unchanged (they are the check
  that the wrappers did not change behavior).
- **End to end:** Claude Code against staging first (loopback redirects), then
  claude.ai.

### Rollout (Ethan runs the infra steps; Claude proposes, does not execute)

1. Merge; staging auto-deploys.
2. Register the resources in **both** identity databases, e.g.
   `identity-cli resource create --uri https://staging.haruspex.fyi/mcp --name "Haruspex (staging)" --scope "haruspex:read=Read competitions and props" --scope "haruspex:write=Add and resolve props" --dynamic-clients`
   and the same for `https://haruspex.fyi/mcp` / "Haruspex".
3. Connect Claude Code to staging; exercise every tool.
4. `bif promote haruspex`; connect claude.ai to prod.
5. Update haruspex's CLAUDE.md (an *MCP* section) and the fleet CLAUDE.md
   publishers/agents notes if relevant.

## Left to the builder

- Exact file layout inside `lib/core/` and `lib/mcp/`, and how the caller is
  threaded into tool handlers.
- Exact SDK API usage (`createMcpHandler` vs. the transport class); verify
  `.well-known` routes work in this Next.js version (read
  `node_modules/next/dist/docs/` first, per CLAUDE.md).
- Output schema shapes beyond the fields listed.
- Whether `listCompetitions` replaces both `getCompetitions` and
  `getWritableCompetitions` or sits beside them.
