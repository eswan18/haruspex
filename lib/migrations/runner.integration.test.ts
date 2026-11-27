import { promises as fsPromises } from "node:fs";
import * as path from "node:path";

import { Kysely, PostgresDialect, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRunnerArtifact,
  runArtifact,
  type RunnerArtifact,
} from "@/tests/helpers/migrationRunnerArtifact";

import { readAppliedMigrations, verifyMigrations } from "./check";
import { MIGRATION_MANIFEST } from "./manifest";
import { LOCK_WAIT_MS } from "./runner";

const useContainers = process.env.TEST_USE_CONTAINERS === "true";

const HARNESS_BOOTSTRAP = "00000000_bootstrap";
const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

describe.skipIf(!useContainers)("the compiled migration runner, end to end", () => {
  let artifact: RunnerArtifact;
  const opened: Kysely<unknown>[] = [];

  beforeAll(async () => {
    artifact = await buildRunnerArtifact();
  }, 300000);

  afterAll(async () => {
    await Promise.all(opened.map((db) => db.destroy()));
    await artifact.cleanup();
  });

  function urlFor(databaseName: string): string {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    return url.toString();
  }

  function connect(databaseName: string): Kysely<unknown> {
    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: urlFor(databaseName),
          max: 1,
          ssl: false,
        }),
      }),
    });
    opened.push(db);
    return db;
  }

  /**
   * Creates a database shaped like a bifrost preview's Neon branch: the
   * pre-migrations baseline schema that the real production database already
   * had, plus however many migrations staging had run when the branch was cut.
   *
   * The baseline is applied by calling the harness module's `up` directly, NOT
   * through a `Migrator` — production's baseline predates kysely, so production's
   * `kysely_migration` table holds only the real migrations, and a preview cut
   * from it looks the same. (`tests/helpers/migrator.ts` does record it, which is
   * why the check's own integration test has to allow for it.)
   */
  async function createPreviewBranch(
    name: string,
    migrationsAlreadyRun: number,
  ): Promise<Kysely<unknown>> {
    const admin = connect("postgres");
    await sql.raw(`drop database if exists ${name}`).execute(admin);
    await sql.raw(`create database ${name}`).execute(admin);

    const db = connect(name);
    const baseline = await import(
      "@/tests/helpers/000000000000_create-initial-schema"
    );
    await baseline.up(db);

    if (migrationsAlreadyRun > 0) {
      const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({
          fs: fsPromises,
          path,
          migrationFolder: MIGRATIONS_DIR,
        }),
      });
      const { error } = await migrator.migrateTo(
        MIGRATION_MANIFEST[migrationsAlreadyRun - 1],
      );
      if (error) {
        throw error;
      }
    }

    return db;
  }

  it("brings a preview branch that is behind up to the build's schema", async () => {
    // The motivating case: a branch adds a migration, the preview's database is
    // cut from staging without it, and the initContainer has to close the gap.
    const db = await createPreviewBranch(
      "runner_behind",
      MIGRATION_MANIFEST.length - 1,
    );
    expect((await readAppliedMigrations(db)).length).toBe(
      MIGRATION_MANIFEST.length - 1,
    );

    const result = await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_behind"),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      MIGRATION_MANIFEST[MIGRATION_MANIFEST.length - 1],
    );
    expect(await readAppliedMigrations(db)).toEqual([...MIGRATION_MANIFEST]);
  }, 300000);

  it("leaves a database the app's own startup check accepts", async () => {
    // The contract between the two halves: after the runner exits 0, the check
    // that would otherwise kill the app has to pass against the same database.
    const db = await createPreviewBranch("runner_check_agrees", 0);

    const result = await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_check_agrees"),
    });

    expect(result.code).toBe(0);
    expect(await verifyMigrations(db)).toEqual({ ok: true });
  }, 300000);

  it("records exactly the real migrations, and no bootstrap", async () => {
    // The harness's bootstrap migration is not a migration; if it had been
    // compiled in, it would show up here as an extra row and the startup check
    // would then reject the database the runner just built.
    //
    // toEqual against the manifest pins the set, the order, and the count at
    // once, so there is deliberately no separate length assertion — a hardcoded
    // count would have to be bumped by every migration that ever lands, and
    // would fail in a way that reads like a real defect rather than a stale
    // literal.
    const db = await createPreviewBranch("runner_exact_set", 0);

    await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_exact_set"),
    });

    const applied = await readAppliedMigrations(db);
    expect(applied).toEqual([...MIGRATION_MANIFEST]);
    expect(applied).not.toContain(HARNESS_BOOTSTRAP);
  }, 300000);

  it("is a no-op, and still exits 0, when the database is already current", async () => {
    // An initContainer runs on every pod start, including restarts.
    await createPreviewBranch("runner_idempotent", 0);
    const env = { DATABASE_URL: urlFor("runner_idempotent") };

    expect((await runArtifact(artifact.outFile, env)).code).toBe(0);
    const second = await runArtifact(artifact.outFile, env);

    expect(second.code).toBe(0);
    expect(second.stdout).toContain("Already up to date");
  }, 300000);

  it("exits non-zero when the database is ahead of the build", async () => {
    // An old image rolled onto a newer schema. kysely calls this corrupted and
    // refuses; the runner must not paper over it and report success.
    const db = await createPreviewBranch("runner_ahead", 0);
    await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_ahead"),
    });
    await sql`
      insert into kysely_migration (name, timestamp)
      values ('9999999999999_from-a-newer-build', now()::text)
    `.execute(db);

    const result = await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_ahead"),
    });

    expect(result.code).not.toBe(0);
    // Said as what it is: an older image, not a failed migration.
    expect(result.stderr).toContain("ahead of this build");
    expect(result.stderr).toContain("9999999999999_from-a-newer-build");
    expect(result.stderr).not.toContain("Migration failed");
  }, 300000);

  it("exits non-zero when a migration cannot be applied", async () => {
    // A branch cut from a database that never had the baseline schema: the very
    // first migration references a table that does not exist. The runner has to
    // fail rather than leave a half-migrated database looking successful.
    const admin = connect("postgres");
    await sql.raw(`drop database if exists runner_no_baseline`).execute(admin);
    await sql.raw(`create database runner_no_baseline`).execute(admin);

    const result = await runArtifact(artifact.outFile, {
      DATABASE_URL: urlFor("runner_no_baseline"),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Migration failed");
    // kysely runs the whole batch in one transaction on Postgres.
    expect(result.stderr).toContain("rolled back");
    expect(result.stdout).toContain("Error");
  }, 300000);

  it("gives up on a table another session holds, and migrates once it is free", async () => {
    // A migration needs a lock on every table it changes, and while it waits
    // for one, everything else that wants that table waits behind it. Left to
    // wait forever, one long query in the app turns a deploy into an outage of
    // that table. The runner gives up after a few seconds instead, and the
    // initContainer is started again.
    //
    // The first migration adds a foreign key to `users`, so a session holding
    // `users` is in its way: what a slow query or an idle transaction in the
    // app looks like from here.
    const db = await createPreviewBranch("runner_locked_table", 0);
    const env = { DATABASE_URL: urlFor("runner_locked_table") };
    const blocker = new Client({
      connectionString: env.DATABASE_URL,
      ssl: false,
    });
    await blocker.connect();
    await blocker.query("begin");
    await blocker.query("lock table users in access exclusive mode");
    // Without a limit the runner would wait for as long as the lock is held.
    // Let go of it eventually, so losing the limit fails this test (the run
    // then succeeds, and the assertions below say so) rather than hanging it.
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await blocker.query("rollback");
    };
    const watchdog = setTimeout(() => void release(), 45000);

    try {
      const blocked = await runArtifact(artifact.outFile, env);

      expect(blocked.code).toBe(1);
      expect(blocked.stderr).toContain("waited too long for a lock");
      // Said as what it is, with the same promise any failure makes.
      expect(blocked.stderr).not.toContain("Migration failed");
      expect(blocked.stderr).toContain("rolled back");
      // Nothing was changed: the first migration's table is not there.
      const { rows } = await sql<{ present: boolean }>`
        select to_regclass('public.suggested_props') is not null as present
      `.execute(db);
      expect(rows[0].present).toBe(false);

      // The retry, with the table free again. It also proves the failed run
      // let go of kysely's own lock, which would otherwise block this one.
      await release();
      const retried = await runArtifact(artifact.outFile, env);

      expect(retried.code).toBe(0);
      expect(await readAppliedMigrations(db)).toEqual([...MIGRATION_MANIFEST]);
    } finally {
      clearTimeout(watchdog);
      await release().catch(() => {});
      await blocker.end();
    }
  }, 300000);

  it("still waits its turn behind another runner, past the lock limit", async () => {
    // Two pods starting together: kysely serialises them with an advisory
    // lock, and the second must wait for the first, not give up after the few
    // seconds a table lock is allowed. kysely sets its own timeout for that
    // one wait, which is what this pins. The lock id is kysely's
    // (dialect/postgres/postgres-adapter); if an upgrade changes it, this
    // stops waiting and the elapsed-time assertion says so.
    const KYSELY_MIGRATION_LOCK = "3853314791062309107";
    const heldFor = LOCK_WAIT_MS + 3000;
    await createPreviewBranch("runner_second_pod", 0);
    const env = { DATABASE_URL: urlFor("runner_second_pod") };
    const firstPod = new Client({
      connectionString: env.DATABASE_URL,
      ssl: false,
    });
    await firstPod.connect();
    await firstPod.query(`select pg_advisory_lock(${KYSELY_MIGRATION_LOCK})`);
    const finish = setTimeout(
      () =>
        void firstPod.query(
          `select pg_advisory_unlock(${KYSELY_MIGRATION_LOCK})`,
        ),
      heldFor,
    );

    try {
      const started = Date.now();
      const second = await runArtifact(artifact.outFile, env);

      expect(second.code).toBe(0);
      expect(Date.now() - started).toBeGreaterThanOrEqual(heldFor - 500);
    } finally {
      clearTimeout(finish);
      await firstPod.end();
    }
  }, 300000);

  it("exits non-zero when the database is unreachable", async () => {
    const url = new URL(urlFor("nothing_here"));
    url.port = "1";

    const result = await runArtifact(artifact.outFile, {
      DATABASE_URL: url.toString(),
    });

    expect(result.code).toBe(1);
  }, 300000);
});
