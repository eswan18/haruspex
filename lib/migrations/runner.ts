/**
 * The migration runner: applies `migrations/` to a database, and nothing else.
 *
 * This is the counterpart to the startup check in `./check`. The check refuses
 * to start an app whose database is not at the build's schema; *something* has
 * to be able to move a database to that schema, and in staging, prod and bifrost
 * preview environments that something is a `migrate` initContainer running the
 * app image.
 *
 * The runner stage carries neither `kysely-ctl` nor `tsx`, so `npm exec kysely
 * migrate up` — the way migrations are run by hand — cannot work there: the
 * `.ts` migration files have nothing to load them. Instead
 * `scripts/build-migration-runner.ts` compiles the migrations and this module
 * into a single self-contained `dist/migrate/index.js` at build time, which the
 * Dockerfile copies into the image. See that script and the README.
 *
 * What this module deliberately does NOT do: inspect the schema, infer state,
 * repair anything, or decide that a database "looks new". It hands a fixed set
 * of migrations to kysely's own `Migrator` and reports what happened. Every
 * decision about what to apply is kysely's.
 */

import { writeSync } from "node:fs";

import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import {
  Migrator,
  type Migration,
  type MigrationResult,
  type MigrationProvider,
} from "kysely/migration";
import { Pool } from "pg";

import { verifyMigrations } from "./check";
import { MIGRATION_MANIFEST } from "./manifest";

/** A compiled migration set: migration name -> the module's `up`/`down`. */
export type CompiledMigrations = Readonly<Record<string, Migration>>;

/** Where the runner writes. Injected so tests can capture it. */
export interface RunnerIo {
  info: (line: string) => void;
  error: (line: string) => void;
}

/**
 * Writes with `writeSync` for the same reason `./startup` does: the caller
 * finishes with `process.exit`, which does not flush pending async writes, and
 * stdout/stderr are pipes (not TTYs) under Docker and Kubernetes. A truncated
 * final line is exactly the output an operator needs when an initContainer
 * fails.
 */
export const processIo: RunnerIo = {
  info: (line) => writeSync(1, `${line}\n`),
  error: (line) => writeSync(2, `${line}\n`),
};

/**
 * Serves a fixed, already-loaded set of migrations to kysely's `Migrator`.
 *
 * kysely's own `FileMigrationProvider` reads a directory at runtime; there is no
 * directory in the image, and the point of compiling is that there does not need
 * to be one.
 */
export class StaticMigrationProvider implements MigrationProvider {
  constructor(private readonly migrations: CompiledMigrations) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...this.migrations };
  }
}

/**
 * Strips credentials from a connection string so it can be logged.
 *
 * Preview logs are worth reading, and "which database did it migrate?" is the
 * first question — but `DATABASE_URL` carries a password.
 */
export function describeConnection(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, "") || "(default)";
    return `${database} on ${url.host}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/**
 * How long a migration may wait for a lock before it gives up, in milliseconds.
 *
 * Changing a table needs a lock nothing else may hold, and Postgres queues lock
 * requests: while the migration waits behind one slow query, every later query
 * on that table waits behind the migration. Postgres's default is to wait
 * forever, which turns a slow query in the app into an outage of that table for
 * as long as the query runs. Nobody is watching a deploy to cancel it.
 *
 * So the wait is short. A migration that cannot get its lock fails, the whole
 * run is rolled back, and Kubernetes starts the initContainer again a little
 * later: a busy moment costs a retry instead of holding the table.
 */
export const LOCK_WAIT_MS = 5_000;

/** Postgres's SQLSTATE for "canceling statement due to lock timeout". */
const LOCK_NOT_AVAILABLE = "55P03";

/** Whether `error` is Postgres giving up on a lock after `lock_timeout`. */
function waitedTooLongForLock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE
  );
}

/**
 * Opens the connection the runner migrates through.
 *
 * `max: 1` because migrations are strictly sequential and kysely takes an
 * advisory lock anyway; a pool would only hold connections a preview's small
 * Neon branch could use elsewhere. The SSL rule mirrors `lib/database-factory`
 * (loopback plaintext, everything else TLS without cert pinning, which is what
 * Neon needs), with `127.0.0.1` accepted alongside `localhost` because that is
 * how a test container is usually addressed.
 *
 * Every connection starts with `lock_timeout` set to `LOCK_WAIT_MS`; see there.
 * It is set on the session rather than inside a migration so that no migration
 * has to remember it. kysely's own advisory lock is not shortened by this: it
 * sets its own, longer timeout for that one statement, so a second pod still
 * waits for the first to finish rather than failing.
 */
export function createMigrationDb(connectionString: string): Kysely<unknown> {
  const isLoopback =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1");

  return new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 1,
        ssl: isLoopback ? false : { rejectUnauthorized: false },
      }),
      onCreateConnection: async (connection) => {
        await connection.executeQuery(
          CompiledQuery.raw(`set lock_timeout = ${LOCK_WAIT_MS}`),
        );
      },
    }),
  });
}

/**
 * Refuses to run unless the compiled set is exactly the build's manifest.
 *
 * This is the guard against the one mistake this design makes possible:
 * compiling a migration into the image that is not a real migration. The test
 * harness (`tests/helpers/migrator.ts`) prepends a `00000000_bootstrap`
 * migration that recreates the pre-migrations baseline schema and exists
 * nowhere in `migrations/`. If it — or anything else — were ever swept into the
 * bundle, the runner would happily apply it and leave behind a database the
 * startup check then rejects, which is the exact failure this whole pair of
 * mechanisms exists to prevent.
 *
 * `scripts/build-migration-runner.ts` makes the same assertion at build time so
 * the mistake fails the build. This one is compiled into the artifact, so it
 * holds even if the artifact were built some other way.
 */
export function checkCompiledSet(names: readonly string[]): string | null {
  const compiled = [...names].sort();
  const expected = [...MIGRATION_MANIFEST].sort();
  const compiledSet = new Set(compiled);
  const expectedSet = new Set(expected);

  const extra = compiled.filter((name) => !expectedSet.has(name));
  const missing = expected.filter((name) => !compiledSet.has(name));

  if (extra.length === 0 && missing.length === 0) {
    return null;
  }

  const lines = [
    "Refusing to migrate: the migrations compiled into this runner are not the",
    "migrations this build's manifest lists, so applying them would leave a",
    "database the app's startup check rejects.",
    "",
    `  Compiled: ${compiled.length}`,
    `  Manifest: ${expected.length}`,
  ];

  if (extra.length > 0) {
    lines.push(
      "",
      `  Compiled but not in the manifest (${extra.length}):`,
      ...extra.map((name) => `    - ${name}`),
    );
  }

  if (missing.length > 0) {
    lines.push(
      "",
      `  In the manifest but not compiled (${missing.length}):`,
      ...missing.map((name) => `    - ${name}`),
    );
  }

  lines.push(
    "",
    "  This is a build defect, not a database problem. Rebuild with",
    "  `npm run build:migrate`, which asserts the same thing.",
  );

  return lines.join("\n");
}

/**
 * The migration a database has applied that this build lacks, when that is why
 * kysely refused to run, or null for any other failure. kysely checks this
 * before applying anything, so the database is untouched.
 */
function databaseAheadOf(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /previously executed migration (\S+) is missing/.exec(message)?.[1] ?? null
  );
}

/**
 * Why `connectionString` cannot be migrated through, or null if it can.
 *
 * kysely holds a session-level advisory lock for the whole run, so that two
 * pods starting together apply each migration once. Neon's pooled host
 * (`-pooler`) is PgBouncer in transaction mode, which does not keep a session's
 * locks: the lock and its release can land on different server connections, and
 * a leaked lock then blocks every later run. Neon's consoles show the pooled
 * string by default, which is what makes this worth refusing outright.
 */
export function unusableConnection(connectionString: string): string | null {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return null;
  }
  if (!host.includes("-pooler")) return null;
  return [
    `Refusing to migrate through ${host}: that is Neon's pooled host, which`,
    "cannot hold the session lock kysely takes for the run. Use the direct",
    "connection string (the same host without `-pooler`).",
  ].join("\n");
}

function formatResult(result: MigrationResult): string {
  return `  ${result.status.padEnd(11)} ${result.migrationName}`;
}

/**
 * Applies `migrations` to `db` and returns a process exit code.
 *
 * 0 only when every migration is applied *and* the database then satisfies the
 * app's own startup check. Anything else is non-zero: an initContainer that
 * exited 0 without migrating would let a broken app start, which is worse than
 * not having a runner at all.
 */
export async function runMigrations(
  db: Kysely<unknown>,
  migrations: CompiledMigrations,
  io: RunnerIo = processIo,
): Promise<number> {
  const compiledProblem = checkCompiledSet(Object.keys(migrations));
  if (compiledProblem !== null) {
    io.error(compiledProblem);
    return 1;
  }

  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(migrations),
  });

  const { error, results } = await migrator.migrateToLatest();

  const applied = (results ?? []).filter(
    (result) => result.status === "Success",
  );

  for (const result of results ?? []) {
    io.info(formatResult(result));
  }

  if (error) {
    const ahead = databaseAheadOf(error);
    if (ahead !== null) {
      io.error(
        [
          "The database is ahead of this build: it has already applied",
          `${ahead}, which this image does not know. Nothing was changed.`,
          "",
          "  This is an older image starting against a database a newer build",
          "  migrated: a rollback, or an old pod restarted mid-rollout. The app",
          "  would refuse to boot against it too. Roll forward to the build that",
          "  matches the database.",
        ].join("\n"),
      );
      return 1;
    }
    if (waitedTooLongForLock(error)) {
      const message = error instanceof Error ? error.message : String(error);
      io.error(
        [
          "A migration waited too long for a lock: something else is using a",
          `table it needs, and after ${LOCK_WAIT_MS / 1000}s it gave up rather than hold up every`,
          "other query on that table. The whole run was rolled back and the",
          "database is as it was before it.",
          "",
          "  This container is started again, so a busy moment clears itself. If it",
          "  keeps failing, something is holding the table open: a long query, or a",
          "  transaction left idle. This shows it, on the same database:",
          "",
          "    select pid, state, xact_start, left(query, 80) from pg_stat_activity",
          "    where state <> 'idle' order by xact_start;",
          "",
          `  Postgres said: ${message}`,
        ].join("\n"),
      );
      return 1;
    }
    const detail = error instanceof Error ? error.stack : String(error);
    io.error(
      [
        "Migration failed. kysely runs the whole batch in one transaction on",
        "Postgres, so every migration in this run was rolled back and the",
        "database is as it was before the run.",
        "",
        `  ${detail}`,
      ].join("\n"),
    );
    return 1;
  }

  // Post-condition, using the app's own check rather than a second opinion:
  // whatever the runner just did, the app has to be willing to boot against it.
  // This never modifies anything — it reads the migration table.
  const verified = await verifyMigrations(db);
  if (!verified.ok) {
    io.error(
      [
        "Migrations reported success, but the database still does not match this",
        "build's manifest — the app would refuse to start against it.",
        "",
        verified.message,
      ].join("\n"),
    );
    return 1;
  }

  io.info(
    applied.length === 0
      ? `Already up to date (${MIGRATION_MANIFEST.length} migrations).`
      : `Applied ${applied.length} migration(s); database is at ${MIGRATION_MANIFEST.length} migrations.`,
  );
  return 0;
}

/**
 * The compiled entry point's whole body: read `DATABASE_URL`, migrate, report.
 *
 * Returns an exit code rather than calling `process.exit` so the caller owns
 * that decision — and so this is testable.
 */
export async function runMigrationCli(
  migrations: CompiledMigrations,
  io: RunnerIo = processIo,
): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    io.error(
      [
        "DATABASE_URL is not set, so there is no database to migrate.",
        "",
        "  Set it to the database this deployment will use, as a role that may",
        "  change the schema. In a bifrost preview that is the migrate role bifrost",
        "  mints; in staging and prod it comes from haruspex-{env}-migrate-secrets.",
      ].join("\n"),
    );
    return 1;
  }

  const unusable = unusableConnection(connectionString);
  if (unusable !== null) {
    io.error(unusable);
    return 1;
  }

  io.info(`Migrating ${describeConnection(connectionString)}`);

  const db = createMigrationDb(connectionString);
  try {
    return await runMigrations(db, migrations, io);
  } catch (error) {
    const detail = error instanceof Error ? error.stack : String(error);
    io.error(`Migration runner failed before it could finish:\n\n  ${detail}`);
    return 1;
  } finally {
    await db.destroy().catch(() => {});
  }
}
