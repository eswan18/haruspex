# Haruspex

This is a web application for predicting the likelihood that certain events will happen in the coming year.
Check it out at [haruspex.fyi](https://haruspex.fyi).

The idea is inspired by Philip Tetlock's [Good Judgment Project](https://en.wikipedia.org/wiki/The_Good_Judgment_Project) and book _Superforecasting_.

## What's in here?

A NextJS app and database migrations, basically.

## How is it deployed?

A push to `main` builds one image in Google Cloud Build. ArgoCD's image
updater deploys it to staging on its own, and migrations run as part of that
deploy. Production moves only when the owner promotes it with `bif promote
haruspex`. Staging is at `staging.haruspex.fyi`, reachable only on the tailnet.

## The software factory

Two kinds of change reach `main`, and so staging, with nobody in the loop:
dependency updates, and small tasks handed to an AI agent by labelling an
issue. Production is never touched by any of it. Review happens at promotion.

### Handing a task to the agent

1. File an issue with the **Factory task** form. Say what should change and
   how to tell it is done. The agent reads the issue and any comments the
   repository owner adds, and nobody else's.
2. Add the `factory` label. Only the owner's label counts, and only on an
   issue the owner wrote.
3. The agent writes the change and `haruspex-factory` opens a pull request.
   If the task is unclear, too big, or contradicts an existing test, it
   changes nothing and says why on the issue, which gets `needs-human`.
4. If the checks fail, the agent gets up to three tries at a repair, then the
   pull request gets `needs-human`.
5. If the checks pass, the factory merges it and labels it `unreviewed`.

Add `review-first` to the issue to make its pull request wait for a person.
Some pull requests always wait, whatever their labels: those that touch
sign-in, session or access code, an endpoint (a route handler or server
action), or any file that makes an authorization decision. In practice that
leaves components, pure logic, hooks, types and styles to merge on their own.
The rule is `.github/guard/sensitive.ts`.

When the agent declines or gets stuck, answer it in a comment on the issue
and put the `factory` label back. It starts again and reads your comment.

### What the agent can and cannot change

It can edit `.ts`, `.tsx` and `.css` files under `app/`, `components/`,
`lib/`, `hooks/` and `types/`, and `proxy.ts`: at most 25 files and 800 lines
per pull request. It can add new test files beside the code.

It cannot change existing tests, fixtures or mocks, migrations, dependencies,
configuration, documentation, or anything under `.github/`. It cannot run
code: it reads and edits files, and CI is the first time its change executes.

These are rules in code, not instructions to the agent. They live in
`.github/guard/policy.ts`, are applied before anything the agent writes is
committed, and are applied again by the required `Guard` check on the pull
request. `Guard` holds any pull request opened by a bot, or carrying a bot's
commit, to these rules; a person's own pull request is not restricted.

### Dependency updates

Dependabot opens one grouped pull request a week for minor and patch
updates, and only for versions at least seven days old. If it passes the
checks untouched and every direct dependency moved by a minor or patch
version, the factory merges it. Majors, and anything that needed fixing, wait
for a person. When an update breaks the build, the agent gets up to three
tries at fixing the call sites; it may not touch tests or the manifests.

### Before promoting to production

Read what merged without a reader, then remove the label from each:

```bash
gh pr list --state merged --label unreviewed
```

### Switches and labels

| Name | What it does |
|---|---|
| `FACTORY_AUTOMERGE_ISSUES` (repository variable) | `true` lets the factory merge the agent's green pull requests. Otherwise it only announces them. |
| `FACTORY_AUTOMERGE_BUMPS` (repository variable) | The same, for dependency updates. |
| `factory` | On an issue, by the owner: start the agent. |
| `review-first` | On an issue or pull request: never merge it automatically. |
| `needs-human` | The agent stopped. Removing it from a pull request lets the agent try again. |
| `ready-for-review` | Green, and waiting for a person to merge. |
| `unreviewed` | Merged by the factory; nobody has read it yet. |

### What it needs to run

- The `haruspex-factory` GitHub App, installed on this repository with
  contents and pull-request write access and actions read access. It has no
  access to workflows or issues. Its ID is in the
  variable `FACTORY_APP_ID` and its private key in the secret
  `FACTORY_APP_KEY`.
- The secret `CLAUDE_CODE_OAUTH_TOKEN`, made with `claude setup-token`. It
  lasts a year; when it lapses the agent step fails with a 401.
- The `main` ruleset requiring `Guard`, `PR Checks` and `Smoke`.

### Where it lives

| File | Role |
|---|---|
| `.github/workflows/issue-agent.yml` | A labelled issue becomes a pull request. |
| `.github/workflows/issue-fix.yml` | Repairs, and the merge-or-announce decision. |
| `.github/workflows/factory-agent.yml` | The confined agent run both of those call. |
| `.github/workflows/bump-fix.yml` | The same loop for dependency updates. |
| `.github/workflows/guard.yml`, `.github/guard/` | The rules, and the check that applies them. |
| `.github/dependabot.yml` | What Dependabot proposes, and when. |

The reasoning behind the design is in
`docs/superpowers/specs/2026-11-27-factory-issue-agent-design.md`.

## MCP server

`/mcp` lets an agent read and write props as the signed-in reader (see the MCP
section of `CLAUDE.md`, and `docs/superpowers/specs/2026-11-19-mcp-server-design.md`).
It needs `MCP_RESOURCE_URL` (set in each overlay's `configmap-env.yaml`) and
`IDP_PUBLIC_URL`; without either it answers 503.

### Rollout

Not live until identity knows the resource. Run **both** commands below (the
prod URI and the staging URI) against **each** identity database, prod's and
staging's -- four runs in all. Staging's identity database is periodically
overwritten by a copy of prod's, so a registration made only in staging's is
wiped by the next copy:

```bash
identity-cli resource create --uri https://haruspex.fyi/mcp --name "Haruspex" \
  --scope "haruspex:read=Read competitions and props" \
  --scope "haruspex:write=Add and resolve props" --dynamic-clients

identity-cli resource create --uri https://staging.haruspex.fyi/mcp --name "Haruspex (staging)" \
  --scope "haruspex:read=Read competitions and props" \
  --scope "haruspex:write=Add and resolve props" --dynamic-clients
```

Then sign in once to the site in the same environment (staging.haruspex.fyi
for staging, haruspex.fyi for prod) with the account you will connect as,
before connecting; an unknown user gets 403. Then:

- **Staging** is reachable only from the tailnet (as is staging identity), so
  claude.ai cannot test it. From a tailnet machine:
  `claude mcp add --transport http haruspex-staging https://staging.haruspex.fyi/mcp`
- **Prod**: after `bif promote haruspex`, add `https://haruspex.fyi/mcp` as a
  custom connector in claude.ai.

Revoking an MCP grant takes effect when its access token expires, not at
once: `/mcp` verifies tokens locally and does not introspect them.

## DB Schema

![Schema Diagram](docs/schema.png)

## Development Tips

### How do I run it locally?

Before running a local instance, you'll need a local copy of the database as well.
The below line spins up a postgres container with a copy of the prod database, as it exists at the time of startup.
It relies on you having a defined `DATABASE_URL` (with read access to the prod database) in your `.env.prod`.

```bash
docker compose --env-file .env.prod -f local-pg-container.yaml up
```

Then, you can tell your local instance to use the local database copy by updating `.env.local` and adding this line:

```bash
DATABASE_URL='postgresql://ethan:ethan@localhost:2345/forecasting'
```

Last, you'll need one other variable in your `.env.local`.

```bash
# Signs this app's own impersonation tokens. For local dev, it can be anything.
JWT_SECRET='whocares'
```

Now, you can launch a fully-functional dev instance.

```bash
# For local development (uses .env.local)
ENV=local npm run dev

# For dev environment (uses .env.dev)
ENV=dev npm run dev

# For production environment (uses .env.prod)
ENV=prod npm run dev
```

The app will automatically load the appropriate `.env` file based on the `ENV` variable and show a colored banner at the top indicating which environment you're running in (except in prod).

### Testing

This project uses Vitest for testing with support for both unit tests and integration tests using real PostgreSQL databases via Testcontainers.

#### Running Tests

**Unit tests (no database):**

```bash
npm run test
```

**Integration tests with real database (requires Docker):**

```bash
npm run test:containers
```

**Quick container test verification:**

```bash
npm run test:containers:quick
```

#### Testcontainers Setup

The project uses [Testcontainers](https://testcontainers.com/) to provide real PostgreSQL instances for database integration tests. This ensures tests run against the same database engine as production.

**Requirements:**

- Docker Desktop or Docker daemon running
- Docker accessible from your user account

**How it works:**

1. **Global container**: Single PostgreSQL container shared across all test files
2. **Real migrations**: Runs all database migrations on startup
3. **Test isolation**: Data cleanup between tests while preserving seed data
4. **Sequential execution**: Tests run sequentially to prevent database conflicts
5. **Auto-cleanup**: Container is destroyed after tests complete

**Features:**

- ✅ Real PostgreSQL 16 database (matches production)
- ✅ Full migration suite applied automatically
- ✅ Proper password hashing and authentication testing
- ✅ Test data factories for creating users, forecasts, competitions
- ✅ Foreign key constraint validation
- ✅ Seed data preservation (admin user, categories, competitions)

**Container Configuration:**

```typescript
// Automatic setup - no manual configuration needed
Database: test_forecasting
User: test_user
Password: test_password
Port: Auto-assigned (5432 inside container)
```

**Test Structure:**

```
tests/
├── helpers/
│   ├── testDatabase.ts      # Database connection and cleanup
│   └── testFactories.ts     # Data factories for test objects
├── db_actions/             # Database action tests
├── auth/                   # Authentication flow tests
└── integration/            # Cross-component integration tests
```

**Test Factories:**

The project includes test data factories for creating realistic test data:

```typescript
// Create test user
const user = await factory.createUser({
  username: "testuser",
  email: "test@example.com",
});

// Create competition
const competition = await factory.createCompetition({
  name: "Test Competition",
  forecasts_open_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  forecasts_close_date: new Date(),
  end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});

// Create proposition and forecast
const prop = await factory.createCompetitionProp(competition.id);
const forecast = await factory.createForecast(user.id.toString(), prop.id, {
  forecast: 0.75,
});
```

**Troubleshooting:**

If container tests fail to start:

```bash
# Check Docker is running
docker ps

# If permission denied:
# Make sure your user is in the docker group (Linux)
# or Docker Desktop is running (Mac/Windows)

# Run without containers as fallback:
npm run test
```

**Performance:**

- First run: ~3-5 minutes (downloads PostgreSQL image)
- Subsequent runs: ~4-5 seconds (reuses container setup)
- 106 tests covering full authentication and database operations

For more detailed testing documentation, see `tests/README.md`.

### Migrations

#### How do I make a new migration?

Create a migration with a relatively descriptive name, which will be embedded in the filename.
For consistency, use dashes instead of underscores or spaces.

```bash
npm exec kysely migrate make <migration-description>
```

Then regenerate the migration manifest and commit it alongside the migration:

```bash
npx tsx scripts/generate-migration-manifest.ts
```

(See "The startup migration check" below for what the manifest is. If you forget,
`lib/migrations/manifest.test.ts` fails in CI.)

#### How do I run new migrations?

**Staging and prod run them on deploy** — a `migrate` initContainer applies them before the app starts
(see "Staging and prod" under "Applying migrations from inside the image" below). Merging a migration
is enough: it reaches staging with the next build and prod when that build is promoted.

For any other database (your local copy, say):

```bash
DATABASE_URL='...' npm exec kysely migrate up
```

#### The startup migration check

**The app refuses to start when its database's schema doesn't match the migrations it was built with.**
The check runs once per server boot, from `register()` in `instrumentation.ts`, and lives in `lib/migrations/`.

It compares the migration names recorded in the database's `kysely_migration` table against
`lib/migrations/manifest.ts` — a generated, committed list of the migrations the build knows about.
Any difference in either direction is fatal:

- **Database behind the code** — a migration was added but never run. This is the case bifrost preview
  environments hit constantly: a preview's Neon branch is cut from staging's schema, so a branch that
  adds a migration produces a preview whose database is behind its code.
- **Database ahead of the code** — an older image rolled back onto a newer schema. Just as wrong, and
  just as worth catching.

On a mismatch the process prints what the build expects, what the database has, which migrations differ,
and how to fix it, then **exits non-zero**. It does *not* throw: Next.js swallows a throw from
`register()` and leaves the server up answering every request (including `/api/health`) with a 500, which
is the ambiguous half-alive state this check exists to eliminate.

**The check never applies migrations.** Running them is a separate step: in staging, prod and previews
the `migrate` initContainer does it before the app container starts; anywhere else it is
`DATABASE_URL='...' npm exec kysely migrate up`. Failing loudly at boot is far easier to debug than
discovering a missing column at runtime, from whichever query happens to touch it first.

##### It fails closed everywhere, including local dev

This is deliberate, and matches the `identity` service. **A local database that hasn't been migrated will
now refuse to boot** — `ENV=local npm run dev` exits instead of starting. If that happens, run the
migrations against your local copy:

```bash
DATABASE_URL='postgresql://ethan:ethan@localhost:2345/forecasting' npm exec kysely migrate up
```

Re-copying the prod database with `local-pg-container.yaml` also works, since prod is migrated.

##### Why a generated manifest instead of reading `migrations/`?

The runtime shouldn't depend on the migration *files* being present or readable — it needs only their
*names* to check, and `kysely-ctl` (which knows how to load them) is a dev dependency that the runner
stage has no business carrying. So the names are compiled into the server bundle instead.

The manifest is committed rather than produced by `npm run build`, because a build-only artifact would
not exist for `next dev`, `vitest`, `eslint` or `tsc --noEmit` — all of which run on a fresh checkout
before anything is built. Committing it costs one guarantee, which `lib/migrations/manifest.test.ts`
buys back: it re-renders the manifest from `migrations/` with the same generator and compares
byte-for-byte, so a migration added without regenerating fails CI. The manifest cannot drift.

#### Applying migrations from inside the image

The check above refuses to start an app whose database is behind. Something has to be able to move that
database forward, and in a deployed environment that something cannot be a laptop: every staging, prod
and bifrost preview pod runs an **initContainer** that brings the schema up to date before the app
container starts. (A preview cuts its own Neon branch from staging first, so it is the one that most
often has a migration to apply.)

`npm exec kysely migrate up` cannot do that job. The Dockerfile's runner stage carries neither
`kysely-ctl` nor `tsx`, so nothing in the image can load a `.ts` migration. So the migrations are
**compiled into the image at build time**:

- `scripts/build-migration-runner.ts` generates an entry point with one static import per file in
  `migrations/`, and esbuild bundles it — together with `lib/migrations/runner.ts`, `kysely` and `pg` —
  into a single self-contained `dist/migrate/index.js`. It runs as part of `npm run build`.
- The Dockerfile copies that directory to `/app/migrate`. Nothing else is needed: the bundle resolves
  no packages at runtime, so it does not care what Next's standalone file tracing does or does not put
  in `node_modules`.

**The initContainer command is:**

```
["node", "/app/migrate/index.js"]
```

It reads `DATABASE_URL` from the environment and drives kysely's own `Migrator`. That is **not** the app
container's `DATABASE_URL`: the initContainer is given the database owner's connection string on Neon's
direct host, because the app's role cannot change the schema and the runner refuses Neon's pooled
`-pooler` host (see "Staging and prod" below; in a preview, bifrost supplies it). It applies migrations
and does nothing else: no schema inspection, no repair, no "this database looks new so…". Every
decision about what to apply is kysely's.

**Exit codes are the whole contract**, because an initContainer that exits 0 without migrating would let
a broken app start:

- `0` — every migration applied (or already applied) *and* the database then passes the startup check
  above. The runner re-uses `verifyMigrations` as a post-condition, so "the runner succeeded" and "the
  app will boot" cannot come apart.
- `1` — `DATABASE_URL` unset or on Neon's pooled host, database unreachable, a migration failed or
  waited too long for a lock, the database is ahead of the build (kysely refuses a migration table
  holding names it doesn't know), or the compiled set is not the manifest.

##### Staging and prod

Every Haruspex pod in staging and prod starts with an initContainer named `migrate` (in each
environment's `deployment-patch.yaml`, not the base: bifrost builds previews from the base and adds its
own `migrate` initContainer), so a deploy brings its database to the build's schema with no manual
step:

- **Same image as the app**, so a build applies exactly its own migrations and never a newer one. A
  build promoted to prod migrates prod when its first pod starts. (Changes to these manifests reach
  prod as soon as they merge — ArgoCD syncs prod's manifests from `main`; only the image waits for
  `bif promote`.)
- **As the database owner.** The app runs as `app_user`, which cannot create or alter anything. The
  initContainer reads `DATABASE_URL` from `haruspex-{env}-migrate-secrets`, backed by the Secret
  Manager secret `haruspex_{env}_migrate_database_url`: the `neondb_owner` connection string on
  Neon's **direct** host. kysely holds a session-level advisory lock for the whole run (that is what
  lets two pods start at once and apply each migration once), and Neon's `-pooler` host is PgBouncer in
  transaction mode, which does not keep session locks, so the runner refuses a `-pooler` host outright.
  That credential has its own SecretProviderClass and volume, mounted only by the initContainer, so it
  is never in the app container's environment or files. That is not a hard boundary: a pod has one
  service account, and the CSI driver fetches the secret with it, so code running in the app container
  could still ask Secret Manager for it. Separating it fully would take a migration Job with its own
  service account.
- **A failed migration** leaves the new pod in `Init` while the old pods keep serving (the rolling
  update never takes a pod down first at these replica counts). `kubectl logs <pod> -c migrate` shows
  what failed. kysely runs the whole batch in one transaction on Postgres, so a failure rolls back
  every migration in that run and the database is as it was before it. (The same transaction is why
  `CREATE INDEX CONCURRENTLY` cannot go in a migration.)
- **A migration never waits long for a table.** Changing a table needs a lock nothing else may hold,
  and Postgres queues lock requests: while a migration waits behind one slow query, every later query
  on that table waits behind the migration. Left alone Postgres waits forever, so one long query in
  the app would turn a deploy into an outage of that table. The runner's connection sets
  `lock_timeout` to 5 seconds (`LOCK_WAIT_MS` in `lib/migrations/runner.ts`): a migration that cannot
  get its lock fails, the run rolls back, and Kubernetes starts the initContainer again. If it keeps
  failing, something is holding the table open, and the log says how to find it. A migration that
  really needs longer can `SET LOCAL lock_timeout` for itself. Waiting for *another runner* is not
  shortened: when two pods start together the second waits for the first to finish.
- **Old pods only keep serving while they live.** Once a new build has migrated, an old pod that is
  recreated — a spot preemption, an eviction — runs the old image's runner against the newer
  database. kysely refuses, the runner says the database is ahead of the build, and that pod waits in
  `Init`. So if a migrated build's app then fails to come up, the old pods drain away one by one:
  fix it by rolling forward.
- **Rolling back** to an older image after its successor's migrations have run leaves the new pods
  refusing to start for the same reason. Roll forward instead, or migrate down by hand first.

`k8s/manifests.test.ts` pins the parts a copy-paste could break: the initContainer's image matches the
app's, each environment reads its own owner secret, the app container never sees it, and the base
carries no initContainer of its own.

##### Running it by hand

```bash
npm run build:migrate                                    # writes dist/migrate/index.js
DATABASE_URL='...' node dist/migrate/index.js
```

That is exactly what the initContainer does. For everyday work against a local database,
`DATABASE_URL='...' npm exec kysely migrate up` is still the shorter path and applies the same
migrations; the compiled runner exists for the environments that have no `npm`. Do not migrate
staging or prod by hand: a database migrated ahead of the build running against it is one the app
refuses to start on, so the next pod to restart stays down until that build is deployed.

##### The one trap: `00000000_bootstrap`

`tests/helpers/migrator.ts` prepends a `00000000_bootstrap` migration, which recreates the
pre-migrations baseline schema that the real production database already had. It lives in
`tests/helpers/`, not `migrations/`, and it is **not** a migration — production's `kysely_migration`
table has never contained it. If it were ever compiled into the image, the runner would apply it and the
startup check would then reject the database the runner had just built.

Three things stop that: the build reads only `migrations/`; both the build and the compiled runner
itself assert that the compiled set is exactly `lib/migrations/manifest.ts`; and
`lib/migrations/runner.test.ts` greps the built bundle for seed rows that exist only in the bootstrap
file.
