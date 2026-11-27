# Factory Verification (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make haruspex's PR checks mandatory and strong enough that a green PR can be trusted without reading the code.

**Architecture:** Three PRs off `main`, in order: harden the existing workflow, add characterization tests for the thin parts of the data layer and the OAuth routes, add a Playwright smoke suite that boots the built app against a Postgres container and a stub identity provider. No production code changes in any of them.

**Tech Stack:** GitHub Actions, Vitest 5, Testcontainers (Postgres 16), Playwright, `jose`, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-11-26-factory-verification-design.md`

## Global Constraints

- No changes to production code (`app/`, `components/`, `lib/`, `proxy.ts`, `migrations/`) except test files beside it. If a test cannot be written without one, stop and report.
- No test-only bypass in the app. The smoke suite signs in with a token the app verifies normally.
- Characterization tests pin what the code does today. Behaviour that looks like a bug is still pinned, and listed under "Surprises" in the PR description.
- Smoke job target: about 3 minutes, and reliable. No `waitForTimeout`; assert on visible state.
- The workflow keeps the name `PR Checks`. Later workflows reference it.
- One PR per part. Open the PR and stop; Ethan merges.
- Read `node_modules/next/dist/docs/` before relying on any Next.js behaviour (see `CLAUDE.md`).
- The required status check (Task 7) is a repo settings change. Do it only when Ethan says so.

## Review Focus

1. **A PR from a fork.** Checks must run with no secrets and a read-only token. Pinned by Task 1 (`permissions: contents: read`, no `secrets.*` in the workflow).
2. **A token for another app used as a session cookie.** The app must treat it as signed out. Pinned in Task 6 (`rejects a token with the wrong audience`).
3. **A deactivated user completing sign-in.** Must land on `/login?error=...` with no session cookie. Pinned in Task 4.
4. **A non-admin calling an admin-only data action.** Must return an error result and write nothing. Pinned in Tasks 2 and 3.
5. **A page that renders but throws in the browser.** Must fail the smoke suite. Pinned in Task 5 (the `page` fixture fails a test on `pageerror` or any 5xx response).

---

## Part A: workflow hardening (PR 1, branch `ci-hardening`)

### Task 1: Tighten `pr-checks.yml`

**Files:**
- Modify: `.github/workflows/pr-checks.yml`

**Interfaces:**
- Produces: a job with `name: PR Checks` (the check name Task 7 requires).

- [ ] **Step 1:** Add top-level `permissions: contents: read`.
- [ ] **Step 2:** Replace the test step with `npm run test:containers`, and delete the "Install tsx globally" step. Nothing in `package.json`, `vitest.config.ts` or `tests/` needs a global `tsx`.
- [ ] **Step 3:** Add `concurrency: { group: pr-checks-${{ github.ref }}, cancel-in-progress: true }`.
- [ ] **Step 4:** Verify locally: `npm run lint && npx tsc --noEmit && npm run test:containers`. Expected: 83 files, 855 tests pass.
- [ ] **Step 5:** Commit, push, open the PR. Expected: the "PR Checks" run is green without the `tsx` step. If it fails for want of `tsx`, restore that step and say so in the PR.

---

## Part B: characterization tests (PR 2, branch `characterization-tests`)

Pattern for Tasks 2–3: copy the shape of `lib/db_actions/competition-members.container.test.ts`. Mock `server-only`, `@/lib/get-user`, `next/cache` and `@/lib/pubsub/client`; build rows with `TestDataFactory`; track inserted ids with `getTestTracker()`; use `ifRunningContainerTestsIt`. Each test asserts the returned `ServerActionResult` and the resulting database rows.

After each task, run `npx vitest run --coverage <file>` with `TEST_USE_CONTAINERS=true` and record the file's line coverage in the PR description. Target: 85% or higher for each of the three files.

### Task 2: `competition-members.ts` (47% today)

**Files:**
- Modify: `lib/db_actions/competition-members.container.test.ts`

- [ ] **Step 1:** Add tests, one `describe` per function:
  - `getCompetitionMembers`: returns members of a private competition to a member; returns an error result to a non-member.
  - `getCurrentUserRole`: `admin`, `forecaster`, and no role for a non-member.
  - `removeCompetitionMember`: a competition admin removes a forecaster (row gone); a forecaster cannot (error, row kept); signed-out caller gets an error; pin what happens when the last admin is removed.
  - `updateMemberRole`: admin promotes a forecaster; forecaster cannot; pin what happens when the last admin is demoted.
  - `getMemberCount`: matches the rows.
  - `getEligibleMembers`: excludes current members and deactivated users.
- [ ] **Step 2:** Run the file. Expected: all pass (they describe existing behaviour). A failure means the test's expectation is wrong; read the function and correct the test.
- [ ] **Step 3:** Commit.

### Task 3: `users.ts` (49%) and `competitions.ts` (54%)

**Files:**
- Create: `lib/db_actions/users.container.test.ts`
- Create: `lib/db_actions/competitions.container.test.ts`

- [ ] **Step 1:** `users.container.test.ts`:
  - `getUsers`: site admin gets all users; honours `sort`; non-admin result pinned.
  - `getUserById`: found, not found.
  - `setUserActive`: admin deactivates then reactivates (`deactivated_at` set, then null); non-admin gets an error and the row is unchanged.
  - `updateUser`: a user updates their own fields; pin what happens when they target another user.
- [ ] **Step 2:** `competitions.container.test.ts`:
  - `getCompetitionById`: public; private as member; private as non-member (pinned).
  - `getCompetitions` and `getWritableCompetitions`: private competitions appear only for members.
  - `createCompetition`: site admin creates one and the row matches the input; non-admin gets an error and no row; invalid dates (close before open) pinned.
  - `updateCompetition`: admin updates; non-admin cannot.
  - `deleteCompetition`: admin deletes an empty competition; pin the result when it has props.
- [ ] **Step 3:** Run both files. Expected: all pass.
- [ ] **Step 4:** Commit.

### Task 4: OAuth routes

**Files:**
- Create: `app/oauth/login/route.test.ts`
- Create: `app/oauth/callback/route.test.ts`

Pattern: `app/api/unsubscribe/route.test.ts`. Mock `next/headers` `cookies()` with an in-memory store, `@/lib/idp/client`, `@/lib/db_actions/identity-login-flag` and `@/lib/logger`. Call `GET(new NextRequest(url))` and assert on the redirect `Location` and the cookie store.

- [ ] **Step 1:** `login/route.test.ts`:
  - sets `oauth_state`, `oauth_code_verifier` and `oauth_return_url` (httpOnly, `maxAge: 600`) and redirects to the URL from `getAuthorizationUrl`.
  - `returnUrl` defaults to `/`.
  - `redirect_uri` uses `APP_BASE_URL` when set, the request origin otherwise.
  - when `generateCodeChallenge` throws, redirects to `/login?error=Failed+to+start+login`.
- [ ] **Step 2:** `callback/route.test.ts`, each asserting the redirect target and that no `token` cookie is set unless stated:
  - `?error=access_denied&error_description=Nope` → `/login?error=Nope`.
  - missing `code` or `state` → `/login?error=Missing+authorization+code`.
  - state differs from the cookie, or no state cookie → `/login?error=Invalid+state`.
  - no verifier cookie → `/login?error=Missing+code+verifier`.
  - new user: `createUserFromIdp` called with `name` from user info, then `claims.username`, then the email prefix; `token` cookie set with `maxAge = expires_in`; the three `oauth_*` cookies deleted; redirect to the stored return URL.
  - existing user: `syncUserFromIdp` called; `createUserFromIdp` not called.
  - `refresh_token` cookie set only when the IdP returns one.
  - deactivated user → `/login?error=Account+is+deactivated`.
  - `createUserFromIdp` returns null → `/login?error=Failed+to+create+user`.
  - `exchangeCodeForTokens` or `validateIDPToken` throws → `/login?error=Authentication+failed`.
  - pin the redirect when the stored return URL is absolute (`https://evil.example/`). List the result under "Surprises" either way.
- [ ] **Step 3:** Run both files. Expected: all pass.
- [ ] **Step 4:** Run the full suite and coverage; commit; open the PR with before/after coverage for the five files and the "Surprises" list.

---

## Part C: smoke suite (PR 3, branch `smoke-suite`)

### Task 5: Harness

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`, `e2e/global-teardown.ts`
- Create: `e2e/support/idp-stub.ts`, `e2e/support/seed.ts`, `e2e/support/fixtures.ts`
- Modify: `package.json` (add `@playwright/test` at the version of the installed `playwright`; script `"test:e2e": "playwright test"`)
- Modify: `vitest.config.ts` (add `"**/e2e/**"` to `exclude`)
- Modify: `.gitignore` (`/test-results`, `/playwright-report`, `/e2e/.state`)

**Interfaces:**
- Produces, from `e2e/support/idp-stub.ts`:
  - `startIdpStub(port: number): Promise<{ url: string; mintToken(claims: { sub: string; email: string; username?: string; aud?: string }): Promise<string>; stop(): Promise<void> }>`
- Produces, from `e2e/support/seed.ts`:
  - `seed(db: Kysely<Database>): Promise<Seed>` where `Seed = { user: TestUser; admin: TestUser; competition: TestCompetition; openProp: TestProp; resolvedProp: TestProp }`
- Produces, from `e2e/support/fixtures.ts`: `test` and `expect`, plus `e2e/.state/user.json`, `admin.json` (Playwright storage states) and `seed.json` (the ids) written by global setup.

Decisions:

- **Ports:** app `3100`, IdP stub `3101`. Chromium only. `workers: 1`.
- **Playwright's `webServer` is not used.** It starts before global setup, and the app exits at boot if the database is not migrated. Global setup starts everything, in this order: Postgres, stub, seed, app.
- **Postgres:** call `setup()` from `tests/globalSetup.ts` with `TEST_USE_CONTAINERS=true`; it sets `TEST_DATABASE_URL` (owner) and `TEST_RLS_DATABASE_URL` (`app_user`). Seed through the owner URL. The app's `DATABASE_URL` is the `app_user` URL, so row-level security applies as it does in the integration tests.
- **IdP stub:** a `node:http` server. Generates an ES256 key pair with `jose` at start and serves the public key at `/.well-known/jwks.json`. `mintToken` signs with `iss` = the stub URL, `aud` defaulting to `ethanswan:haruspex`, `exp` one hour out. `GET /oauth/authorize` returns 200 with a plain body.
- **App:** global setup throws `Run "npm run build" first` if `.next/BUILD_ID` is missing, then spawns `npx next start -p 3100` with: `DATABASE_URL`, `IDP_BASE_URL` and `IDP_PUBLIC_URL` = stub URL, `IDP_AUDIENCE=ethanswan:haruspex`, `IDP_CLIENT_ID=e2e`, `IDP_CLIENT_SECRET=e2e`, `JWT_SECRET=e2e`, `APP_BASE_URL=http://localhost:3100`, `PUBSUB_TOPIC=e2e`, `GCP_PROJECT_ID=e2e`. `MCP_RESOURCE_URL` and any Sentry DSN stay unset. Wait until `/api/health` returns 200 (60s limit; on timeout print the app's stderr).
- **Seed:** with `TestDataFactory`: `user`; `admin` (site admin); a public `competition` open for forecasting, both users as members; `openProp` (binary, unresolved); `resolvedProp` (binary, resolved yes, with an 80% forecast from `user`).
- **Sign-in:** storage state with one cookie, `token` = `mintToken({ sub: <user>.idp_user_id, ... })`, domain `localhost`, path `/`.
- **Fixture:** `test` extends Playwright's with a `page` that records `pageerror` events and responses with status 500 or above, and fails the test after it finishes if any were seen.
- **Teardown:** kill the app, stop the stub, call `teardown()` from `tests/globalSetup.ts`.

- [ ] **Step 1:** Write a first spec, `e2e/health.e2e.ts`: `GET /api/health` returns 200. Configure `testMatch: "**/*.e2e.ts"`.
- [ ] **Step 2:** Run `npm run build && npm run test:e2e`. Expected: FAIL, no harness.
- [ ] **Step 3:** Build the harness per the decisions above.
- [ ] **Step 4:** Run again. Expected: 1 passed. Run `npm run test`. Expected: still 83 files (vitest does not collect `e2e/`).
- [ ] **Step 5:** Commit.

### Task 6: Smoke checks

**Files:**
- Create: `e2e/signed-out.e2e.ts`, `e2e/reader.e2e.ts`, `e2e/admin.e2e.ts`

**Interfaces:**
- Consumes: `test`, `expect` from `e2e/support/fixtures.ts`; the storage states and `seed.json` from Task 5.

Select by role and visible text, never by CSS class.

- [ ] **Step 1:** `signed-out.e2e.ts` (no storage state):
  - `/` redirects to `/login`, and the login page renders.
  - `GET /oauth/login` (redirects not followed) answers with a redirect to the stub's `/oauth/authorize` carrying `code_challenge` and `code_challenge_method=S256`.
  - `rejects a token with the wrong audience`: with a `token` cookie minted with `aud: "ethanswan:other"`, `/` redirects to `/login`.
  - `/help` behaviour when signed out is pinned (it is not in `PUBLIC_ROUTES`).
- [ ] **Step 2:** `reader.e2e.ts` (user state):
  - `/` shows the seeded competition's name.
  - `/competitions/{id}` shows both seeded props.
  - `/competitions/{id}/props/open` lists `openProp`; `/props/resolved` lists `resolvedProp`.
  - forecast: on `/competitions/{id}/props/{openProp}` submit 70%; reload; 70% is shown.
  - `/competitions/{id}/standings` lists the user with a score.
  - `/account` shows the user's name.
  - `/help` renders.
  - `/admin` refuses a non-admin (pin whether that is a redirect or a refusal page).
- [ ] **Step 3:** `admin.e2e.ts` (admin state):
  - `/admin` and `/admin/users` render; the users table lists both seeded users.
  - resolve: resolve `openProp` as yes from its page; it then appears under `/props/resolved`. If resolving publishes a Pub/Sub event and fails without GCP, drop this check and say so in the PR.
- [ ] **Step 4:** Run `npm run test:e2e` three times in a row. Expected: every check passes every time.
- [ ] **Step 5:** Commit.

### Task 7: Run it in CI, then require it

**Files:**
- Modify: `.github/workflows/pr-checks.yml`

- [ ] **Step 1:** Add a second job, `smoke`, `name: Smoke`, parallel to `pr-checks`: checkout, setup-node 24 with npm cache, `npm ci`, cache `~/.cache/ms-playwright` keyed on the Playwright version, `npx playwright install --with-deps chromium`, `npm run build` (the same dummy env as the existing build step), `npm run test:e2e`. On failure, upload `test-results/` as an artifact.
- [ ] **Step 2:** Push and open the PR. Expected: both jobs green; note the Smoke job's duration in the PR. If it is over 4 minutes, list the three slowest checks.
- [ ] **Step 3 (Ethan's go-ahead required, after the PR merges):** add a `required_status_checks` rule to ruleset `27798437` with contexts `PR Checks` and `Smoke`, strict mode off. Verify with `gh api repos/eswan18/haruspex/rulesets/27798437`.
- [ ] **Step 4:** Update the Testing section of `CLAUDE.md`: the `test:e2e` command, that it needs a prior build and Docker, and that browser checks belong in `e2e/` only for flows that cross layers.
