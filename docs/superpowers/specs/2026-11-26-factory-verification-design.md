# Design: verification strong enough for a software factory (step 1)

## Intent

Ethan wants issues and dependency bumps to land on staging with no human
reading the code. That only works if the checks on a PR are trustworthy. This
is the first step: make haruspex's existing checks mandatory and close the
gaps that matter, before any agent is wired up.

## Where things stand (measured 2026-11-26)

- `.github/workflows/pr-checks.yml` already runs lint, `tsc`, all tests against
  a Postgres container, and `next build`, in about 1.5 minutes.
- The `main-1` ruleset requires squash PRs but no status checks, so a red PR
  can merge.
- 855 tests in 83 files pass; 77% line coverage of the files tests load.
- Thin spots in logic: `lib/db_actions/competition-members.ts` (47%),
  `users.ts` (49%), `competitions.ts` (54%). The OAuth routes
  (`app/oauth/login`, `app/oauth/callback`) have no tests.
- 166 of 250 source files, nearly all pages and components, are never loaded
  by a test. Nothing boots the app; staging is the first place the built image
  serves a request.
- The repo is public, so Actions minutes are free and uncapped.

## Goals

1. A failing check blocks a merge to main.
2. The data layer and sign-in routes have tests that pin current behaviour.
3. A small browser smoke suite proves the built app serves its main flows, on
   every PR.

## Non-goals

- Unit tests for individual pages and components.
- The agent, bot identity, guard check, and dependency bumps (later steps).
- Running the smoke suite against staging (step 5 reuses this suite).

## Anti-goals

- A slow or flaky PR check. If the smoke suite can't stay near 3 minutes and
  reliable, it shrinks.
- Characterization tests that pin behaviour Ethan considers a bug. He reviews
  them; anything surprising is flagged in the PR, not silently locked in.

## Approaches

For the page-level gap:

- **Unit-test UI files.** Many brittle tests; server components that query the
  database are awkward to isolate. Rejected.
- **Smoke suite on staging only (the handoff's step 5).** Finds breakage after
  the merge, so it can't gate an agent's PR. Rejected as the only check.
- **Smoke suite in PR Checks, reused on staging later.** Chosen. CI already
  builds the app and starts Postgres, so the added cost is small.

Everything else has one sensible way, since the workflow already exists.

## Design

Three PRs, in order, each reviewed by Ethan.

**PR 1: workflow hardening.** Add `permissions: contents: read`. Drop the
global `tsx` install if tests run without it. Then, with Ethan's go-ahead, add
"PR Checks" as a required status check on the `main-1` ruleset (a settings
change, made after the PR merges so the check name is stable).

**PR 2: characterization tests.** Container tests for the three `db_actions`
files, following the existing patterns in `tests/helpers`. Route handler tests
for OAuth login and callback, calling the handlers directly with the IdP
mocked, as the existing route tests do. Tests only; no production code changes.

**PR 3: smoke suite.** Playwright, in a second job that runs in parallel with
the existing one. It builds the app, starts Postgres with migrations and seed
data, and starts the app with `next start`.

Signing in: sessions are verified against a JWKS fetched from `IDP_BASE_URL`
(`lib/idp/client.ts`). The suite runs a small stub server that serves a JWKS
for a test key, mints a token with the right audience, and sets it as the
session cookie. No production code changes and no test-only bypass in the app.

About a dozen checks: signed-out redirect, dashboard, competition view, prop
view, submit a forecast, admin resolves a prop, standings reflect it, account
page, help page, `/api/health`. The required check then covers both jobs.

## Left to the builder

- Exact smoke flows and seed data, guided by the list above.
- Whether the smoke job shares the build with the first job or rebuilds.
- Browser caching in CI.

## Calls made by Claude, not Ethan

- Splitting into three PRs.
- A JWKS stub for sign-in, over a test-only login route.
- Leaving the workflow name as "PR Checks"; later workflows reference that name.
