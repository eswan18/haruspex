# Forecasting App

This is a web application for predicting the likelihood that certain events will happen in the coming year.
Check it out at [haruspex.fyi](https://haruspex.fyi).

The idea is inspired by Philip Tetlock's [Good Judgment Project](https://en.wikipedia.org/wiki/The_Good_Judgment_Project) and book _Superforecasting_.

## What's in here?

A NextJS app and database migrations, basically.

## How is it deployed?

In Vercel, with minimal customization.

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
database forward, and in a bifrost preview environment that something cannot be a laptop: a preview cuts
its own Neon branch and then runs an **initContainer** to bring the schema up to date before the app
container starts.

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

It reads `DATABASE_URL` from the environment — the same one the app container gets — and drives kysely's
own `Migrator`. It applies migrations and does nothing else: no schema inspection, no repair, no
"this database looks new so…". Every decision about what to apply is kysely's.

**Exit codes are the whole contract**, because an initContainer that exits 0 without migrating would let
a broken app start:

- `0` — every migration applied (or already applied) *and* the database then passes the startup check
  above. The runner re-uses `verifyMigrations` as a post-condition, so "the runner succeeded" and "the
  app will boot" cannot come apart.
- `1` — `DATABASE_URL` unset, database unreachable, a migration failed, the database is ahead of the
  build (kysely refuses a migration table holding names it doesn't know), or the compiled set is not
  the manifest.

##### Staging and prod

Every Haruspex pod in staging and prod starts with the same initContainer, named `migrate`
(`k8s/haruspex-base/deployment.yaml`), so a deploy brings its database to the build's schema with no
manual step:

- **Same image as the app**, so a build applies exactly its own migrations and never a newer one. A
  build promoted to prod migrates prod when its first pod starts.
- **As the database owner.** The app runs as `app_user`, which cannot create or alter anything. The
  initContainer reads `DATABASE_URL` from `haruspex-{env}-migrate-secrets`, backed by the Secret
  Manager secret `haruspex_{env}_migrate_database_url`: the `neondb_owner` connection string on
  Neon's **direct** host, not the `-pooler` one. kysely holds a session-level advisory lock for the
  whole run (that is what lets two pods start at once and apply each migration once), and PgBouncer in
  transaction mode does not keep session locks. That credential has its own SecretProviderClass and
  volume, mounted only by the initContainer, so it is never in the app container's environment or
  files. That is not a hard boundary: a pod has one service account, and the CSI driver fetches the
  secret with it, so code running in the app container could still ask Secret Manager for it.
  Separating it fully would take a migration Job with its own service account.
- **A failed migration** leaves the new pod in `Init` while the old pods keep serving (the rolling
  update never takes a pod down first at these replica counts). `kubectl logs <pod> -c migrate` shows
  what failed; the database is left at the last migration that succeeded.
- **Rolling back** to an older image after its successor's migrations have run leaves the new pods
  refusing to boot, since the startup check rejects a database ahead of the code. Roll forward instead,
  or migrate down by hand first.

`k8s/manifests.test.ts` pins the parts a copy-paste could break: the initContainer's image matches the
app's, each environment reads its own owner secret, and the app container never sees it.

##### Running it by hand

```bash
npm run build:migrate                                    # writes dist/migrate/index.js
DATABASE_URL='...' node dist/migrate/index.js
```

That is exactly what the initContainer does. For everyday work against a local or staging database,
`DATABASE_URL='...' npm exec kysely migrate up` is still the shorter path and applies the same
migrations; the compiled runner exists for the environments that have no `npm`.

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
