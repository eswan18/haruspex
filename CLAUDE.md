# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js forecasting application inspired by Philip Tetlock's Good Judgment Project. Users can predict the likelihood of events happening and compete in tournaments. The app includes user authentication, forecast tracking, competitions, and scoring.

## Development Commands

### Essential Commands

- `ENV=local npm run dev` - Start development server with local environment
- `ENV=dev npm run dev` - Start development server with dev environment
- `ENV=staging npm run dev` - Start development server against staging
- `ENV=prod npm run dev` - Start development server with production environment
- `npm run build` - Build production application
- `npm run lint` - Run ESLint
- `npm run start` - Start production server

### Testing

- `npm run test` - Run all unit tests with Vitest
- `npm run test:containers` - Run tests with real PostgreSQL containers (requires Docker, ~3-5min first run)
- `npm run test:containers:quick` - Quick container test verification (single test file)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:coverage` - Run tests with coverage report
- `npm run storybook` - Start Storybook development server
- `npm run build-storybook` - Build Storybook

**Testing Setup:**

- Unit tests use Vitest with Node.js environment
- **Gotcha**: Importing components that transitively import `lib/database.ts` will fail in unit tests (requires `DATABASE_URL`). Extract pure logic (e.g., Zod schemas) into separate files for testability.
- Testcontainers integration available for database testing with real PostgreSQL instances
- Test files: `**/*.{test,spec}.{ts,tsx}`
- Coverage provided by V8 with HTML/JSON/text reports
- UI components tested in Storybook (excluded from coverage)
- Existing test files cover auth, database actions, server utilities

### Database Migrations

- `npm exec kysely migrate make <migration-description>` - Create new migration
- `DATABASE_URL='...' npm exec kysely migrate up` - Run migrations (local databases; staging and prod run them on deploy in the `migrate` initContainer, see the README)

## Code Architecture

### Database Layer

- **Database**: PostgreSQL with Kysely query builder
- **Connection**: `/lib/database.ts` exports `db` instance
- **Types**: `/types/db_types.ts` contains all database types and table definitions
- **Tables**: users, forecasts, props, competitions, categories, resolutions, feature_flags, competition_members (roles: `admin`/`forecaster`), notification_preferences, user_active_days (one row per user per UTC day signed in, written by `lib/active-days.ts` and read by the admin Stats page), plus the choice-prop tables prop_options, forecast_options, resolution_options
- **Prop kinds**: `props.kind` is `binary` (one yes/no probability, the header row's `forecast`/`resolution`), `one_of`, or `any_of`; the choice kinds leave the header value null and carry a probability/outcome per option in the `*_options` child tables
- **Voided props**: a prop of any kind can be settled as a void (`resolutions.voided`): no `resolution`, no option outcomes, scored for nobody (`v_forecasts.score` is null). `resolution_id IS NOT NULL` still means "settled"; `resolution_voided` (on `v_props`/`v_forecasts`) and the `"voided"` `PropStatus` tell a void apart. A CHECK, the kind trigger and a deferred constraint trigger keep a value and outcome rows off a void
- **Views**: Prefixed with `v_` (e.g., `v_forecasts`, `v_props`, `v_prop_options`) for complex queries with joins

### Server Actions Pattern

This codebase follows a structured server action pattern that returns results instead of throwing errors. **See `/docs/server-actions-best-practices.md` for complete documentation and examples.**

- Server actions return `ServerActionResult<T>` — either `success(data)` or `error(message, code)`
- Use `withRLS(userId, async (trx) => ...)` from `/lib/db-helpers.ts` for queries needing Row Level Security
- Client components consume server actions via the `useServerAction` hook from `/hooks/use-server-action.ts`

### Authentication & Authorization

- Auth is delegated to the **identity** IdP (OAuth 2.0 / OIDC); this app does not store or hash passwords
- JWTs are verified with `jose`; `JWT_SECRET` signs the app's own impersonation tokens (`/lib/auth/impersonation.ts`)
- **Session tokens must carry this app's audience.** identity signs every app's tokens with one key, so `validateIDPToken` requires `aud` to contain `IDP_AUDIENCE` (`ethanswan:haruspex`, the haruspex client's default resource in identity); otherwise any other app's token would work as a haruspex session cookie. Change that client's default resource and you must change this env var with it, or everyone is signed out.
- User sessions managed via `/lib/auth/` modules (impersonation, logout, token refresh)
- RLS (Row Level Security) enabled on key tables

### App Structure (Next.js App Router)

- **App Pages**: `/app/` directory with route-based structure
- **Components**: `/components/` with ui/ subfolder for shadcn/ui components
- **Layouts**: Nested layouts for admin, competitions, standalone views
- **Server Components**: Most pages are server components fetching data directly

### Key Features

- **Competitions**: Time-bound forecasting tournaments
- **Props**: Prediction statements that users forecast on
- **Forecasts**: User predictions with probability scores
- **Scoring**: Brier score calculation for forecast accuracy
- **Admin Panel**: User management, competition creation, feature flags
- **Personal Props**: props a reader writes for themselves — no competition, no
  scoring, no audience. At `/props` and `/props/new`, both gated on the
  `personal-props` feature flag, which also decides whether the navbar shows
  the way in. A personal prop's deadline lives on the prop itself, so
  `getPropStatusFromProp` falls back to it when there is no competition.
- **Email notifications**: haruspex sends no mail itself. It publishes an event
  per recipient to Pub/Sub and the **comms** service renders and sends it, so
  the fleet has one sender and one from address. The event types live in
  `lib/notifications/types.ts`, which is also the registry of what a reader may
  turn off and what they get by default. A reader's row in
  `notification_preferences` exists only where they have actually chosen;
  everyone else follows the default, so **changing a default moves the
  undecided** — `types.test.ts` is the tripwire, and says what to do about it.
  Filtering happens in haruspex at the point of publishing, via
  `notificationEnabled()`; comms knows nothing about preferences. The two
  admin-written emails (announcement, one-to-one) are markdown, previewed here
  by `lib/email-markdown.ts` and rendered by comms with the same parser and
  options; keep the two in step. No greeting is merged in — the admin writes it. Each
  recipient also gets an HMAC-signed unsubscribe link (no expiry, no session,
  one reader and one type — `lib/notifications/unsubscribe-token.ts`). It comes
  in two forms, and the difference matters: `/unsubscribe` only **asks**, and
  is what the footer prints, because scanners and prefetchers follow links in
  mail; `POST /api/unsubscribe` **acts**, and is what a mail client's own
  one-click button uses (RFC 8058).

### MCP

`/mcp` is an MCP server (streamable HTTP) so an agent such as claude.ai or
Claude Code can read and write props as the signed-in reader. The rules live
in `lib/core/` (competitions, props, categories, feature flags); the web's
server actions and the MCP tools in `lib/mcp/tools.ts` are both thin callers of
it. The protocol layer is `lib/mcp/` (`auth.ts` is the token gate, `server.ts`
registers the tools) and the routes are `app/mcp/route.ts` and
`app/.well-known/oauth-protected-resource/mcp/route.ts`.

- **Two scopes**, issued by identity: `haruspex:read` and `haruspex:write`.
  Write tools refuse a read-only token even if the gate let it in.
- **Tools see the "member" view** (`lib/core/views.ts`), even for site admins:
  personal props only the caller's own, private competitions only where they
  are a member. Admin pages keep the "rls" view. An agent acting for an admin
  should not surface what the admin merely *could* see.
- **Admin-only tools** (`list_suggested_props`) are registered only when the
  caller is a site admin, so other agents never see them; the core function
  refuses non-admins as well. They use `haruspex:read`, not a separate scope.
- **Never put `use server` in `lib/core`.** It would turn every export into a
  public endpoint callable from the browser. Server actions wrap core
  functions; they are not the core.
- **New agent-reachable rules go in the core**, not in a tool or an action, so
  the web and the agent cannot disagree. `createProp` is the model: it checks
  the `personal-props` flag and `canCreateProps` for both callers.
- The gate fails closed: 401 (no or bad token), 403 (no `haruspex` scope,
  unknown or deactivated user), 503 (`MCP_RESOURCE_URL`/`IDP_PUBLIC_URL`
  unset, or identity's keys unreachable). A user must have signed in to the
  site once before their token works.

### Local Development Setup

1. Spin up local PostgreSQL: `docker compose --env-file .env.prod -f local-pg-container.yaml up`
2. Set `DATABASE_URL='postgresql://ethan:ethan@localhost:2345/forecasting'` in `.env.local`
3. Add required env var: `JWT_SECRET`
4. Run `ENV=local npm run dev`

### Environment Management

The app supports multiple environments with automatic configuration loading:

- **Local**: `ENV=local npm run dev` - Uses `.env.local` (blue banner)
- **Development**: `ENV=dev npm run dev` - Uses `.env.dev` (yellow banner)
- **Staging**: `ENV=staging npm run dev` - Uses `.env.staging` (yellow banner)
- **Production**: `ENV=prod npm run dev` - Uses `.env.prod` (no banner)

The env files are all gitignored, so a fresh checkout has none of them; which
ones you have locally is up to you. `lib/environment.ts` maps the name to the
file and is the one place to add another.

Environment variables are loaded at startup via `instrumentation.ts` and the appropriate `.env` file is automatically selected. A colored banner at the top of the page indicates which environment is currently running.

### UI Framework

- **Styling**: Tailwind CSS with custom design system
- **Components**: shadcn/ui component library in `/components/ui/`
- **Theming**: Dark/light mode support via next-themes
- **Forms**: React Hook Form with Zod validation
- **Charts**: Recharts for score visualization

### Dates & Timezones

All dates render in the **browser's** timezone. `getBrowserTimezone()` (`hooks/getBrowserTimezone.ts`) reads `Intl.DateTimeFormat().resolvedOptions().timeZone`; `lib/time-utils.ts` (`formatDate` / `formatDateTime`) does the formatting and defaults to `UTC` when no timezone is passed. Prefer the `LocalDate` component (`components/local-date.tsx`) over calling the formatters directly.

- **`LocalDate` needs `suppressHydrationWarning`** — the server renders UTC and the client re-renders in local time, so the markup legitimately differs on first paint. Don't "fix" the mismatch by removing it.
- **There is deliberately no per-user timezone preference.** A DB-backed version (a `timezone` column on `users`, a settings UI, a timezone-constants file) was designed and rejected in favor of browser detection, which shipped in #109. Don't re-propose it — there is no `timezone` column, no migration, and no `useUserTimezone` hook.

### Design Language

The app is set in a **risograph print language**: paper and ink rather than cards
and shadows, hairline rules, square corners, uppercase-mono "kicker" labels, and
figures in tabular mono. Every route has been converted; treat what is there as
the reference and extend it rather than starting a new vocabulary.

**Foundations**

- **Fonts**: Archivo (`--font-archivo`) for text, Roboto Mono
  (`--font-roboto-mono`) for labels and figures, both wired in `app/layout.tsx`.
  Geist is still declared there and is what `font-sans` resolves to on the few
  surfaces that have no sheet of their own.
- **Tokens**: four inks on `:root` and `.dark` in `app/globals.css` —
  `--riso-paper` (the stock), `--riso-ink`, `--riso-red`, and `--riso-red-text`
  (the per-edition legible red; use it for text and for anything text is knocked
  out of). `--riso-red` does not change between editions. The older shadcn
  tokens (`--primary`, `--muted`, …) still exist for the handful of vendored
  primitives that read them; they are not the design.
- **Sheets**: each surface scopes its CSS under a short class and injects it with
  `<style dangerouslySetInnerHTML>`: `.hxp` (prop lists, admin tables — the
  shared one, `components/prop-list/sheet.tsx`), `.hxc` (competition overview),
  `.hxd` (dashboard), `.hxs` (standings), `.hxl` (login), `.hxf` (the form
  vocabulary), `.hxload` / `.hxstop` (loading and refusal). A sheet re-declares
  local aliases (`--paper`, `--ink`, `--rule`, `--ink-muted`, …) from the riso
  tokens.
- **Shared marks**, in `app/globals.css` and deliberately unlayered: `.riso-nav`,
  `.riso-dialog*`, `.riso-menu*`, `.riso-stamp` (a season's state),
  `.riso-cal` / `.riso-clock` (the date pickers), `.riso-banner`, `.riso-toast`,
  `.riso-pick`, `.riso-md-link`, `.seg` (a segmented filter bar), and the whole
  `.hxf` form vocabulary (`.field`, `.choose`, `.picker`, `.submit`, `.quit`).

**Rules**

- **Flat**: depth is a hairline, never a shadow, and nothing is rounded.
- **Two rule weights, two meanings**: 2px ink opens a section, a 1px hairline
  separates two items.
- **Numerics are mono + tabular**: scores, counts, ranks, percentages.
- **Kickers**: section and field labels are uppercase mono, ~0.625–0.6875rem at
  0.12–0.16em tracking.
- **Red is the second ink**, and it is spoken for: "this is you", "this failed",
  "this is still live". Don't spend it on decoration.
- **No raw Tailwind palette colours** (`bg-green-100`, `text-red-600`) anywhere.

**Three traps, all of which have cost time**

- **A backtick inside an injected CSS string terminates it** — including in a CSS
  comment. Write `.seg`, never the backticked form, inside a `*Css` literal.
- **Radix portals dialogs, menus, popovers and toasts to `document.body`**, so a
  rule scoped under a page class can never reach them. Anything inside a portal
  is styled by a `.riso-*` class in globals.
- **A sheet must inject every `*Css` it imports.** Forgetting silently yields an
  unstyled control rather than an error.

**Storybook**: when restyling a notable component, add a story beside it
(`*.stories.tsx`, `title: "<Group>/…"`, `@storybook/react-vite`,
`tags: ["autodocs"]`). Story presentational leaf components (plain props); skip
router-coupled orchestrators. Storybook aliases `@/lib/db_actions*` and
`next/navigation` to mocks in `.storybook/mocks/`, so keep leaf-component db
imports `import type` (erased at build). A component that is only styled inside
a parent (the options editor inside a `Field`, a row inside its table's grid)
needs that parent in its decorator or the story shows it unstyled. Verify with
`npm run build-storybook`.

### Error Monitoring

- Sentry integration for error tracking and performance monitoring

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
