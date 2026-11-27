/**
 * A fail-closed startup check that the database schema matches the migrations
 * this build was compiled with.
 *
 * It deliberately does NOT apply migrations. The goal is to refuse to start —
 * with a clear, actionable error — when code is deployed against a database
 * that hasn't been migrated, rather than silently serving against a schema the
 * code doesn't expect and failing much later, at runtime, on whichever query
 * first touches a missing column. Applying migrations is a separate step: the
 * `migrate` initContainer does it on deploy in staging, prod and previews
 * (`./runner`), and `npm exec kysely migrate up` anywhere else.
 *
 * The motivating case is bifrost preview environments: a preview gets its own
 * Neon database branch cut from staging's schema, so a branch that adds a
 * migration produces a preview whose schema is behind its code.
 *
 * A database that is *ahead* of the code is rejected too — an old image rolled
 * back onto a newer schema is just as wrong, and just as worth catching.
 *
 * The list of expected migrations comes from `./manifest`, a generated source
 * file, because the runtime image has no `migrations/` directory to read: the
 * Dockerfile's runner stage copies only `.next/standalone` and `.next/static`.
 */

import { sql, type Kysely } from "kysely";

import { MIGRATION_MANIFEST } from "./manifest";

/**
 * The table kysely records applied migrations in.
 *
 * `.config/kysely.config.ts` calls `defineConfig({ kysely: db })` with no
 * `migrations` overrides, and kysely-ctl passes its (empty) migrator options
 * straight through to kysely's `Migrator`, which falls back to
 * `DEFAULT_MIGRATION_TABLE = 'kysely_migration'`. The integration test asserts
 * this name against a real migrated database so a kysely upgrade that changed
 * the default could not make this check silently vacuous.
 */
export const MIGRATION_TABLE = "kysely_migration";

export type MigrationCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/** Reads the names of the migrations recorded as applied in the database. */
export async function readAppliedMigrations<DB>(
  db: Kysely<DB>,
): Promise<string[]> {
  const result = await sql<{ name: string }>`select name from ${sql.table(
    MIGRATION_TABLE,
  )}`.execute(db);
  return result.rows.map((row) => row.name).sort();
}

function formatList(names: readonly string[]): string {
  return names.map((name) => `    - ${name}`).join("\n");
}

function newest(names: readonly string[]): string {
  return names.length === 0 ? "(none)" : names[names.length - 1];
}

/**
 * Compares the migrations a build expects against the ones a database has
 * applied. Any difference in either direction is a failure.
 */
export function compareMigrations(
  expected: readonly string[],
  applied: readonly string[],
): MigrationCheckResult {
  const expectedSorted = [...expected].sort();
  const appliedSorted = [...applied].sort();
  const appliedSet = new Set(appliedSorted);
  const expectedSet = new Set(expectedSorted);

  const missing = expectedSorted.filter((name) => !appliedSet.has(name));
  const unknown = appliedSorted.filter((name) => !expectedSet.has(name));

  if (missing.length === 0 && unknown.length === 0) {
    return { ok: true };
  }

  const sections: string[] = [
    "Database schema does not match the migrations this build was compiled with.",
    "",
    `  This build expects ${expectedSorted.length} migration(s), newest: ${newest(expectedSorted)}`,
    `  The database has  ${appliedSorted.length} migration(s), newest: ${newest(appliedSorted)}`,
  ];

  if (missing.length > 0) {
    sections.push(
      "",
      `  Missing from the database — the database is behind this build (${missing.length}):`,
      formatList(missing),
    );
  }

  if (unknown.length > 0) {
    sections.push(
      "",
      `  Applied in the database but unknown to this build — the database is ahead of this build (${unknown.length}):`,
      formatList(unknown),
    );
  }

  sections.push(
    "",
    "  Fix: migrate this database. Staging and prod do that on deploy, in the",
    "  pod's `migrate` initContainer, so look there first:",
    "    kubectl logs <pod> -c migrate",
    "  Anywhere else, run the migrations yourself:",
    "    DATABASE_URL='...' npm exec kysely migrate up",
    "  If the database is ahead instead, deploy the build that matches it.",
    "  This check never applies migrations itself.",
  );

  return { ok: false, message: sections.join("\n") };
}

/**
 * Reads the applied migrations and compares them against `expected`.
 *
 * `expected` is injectable so the test harness — which prepends a bootstrap
 * migration that does not live in `migrations/` — can state its own expected
 * set. Production always uses the default.
 */
export async function verifyMigrations<DB>(
  db: Kysely<DB>,
  expected: readonly string[] = MIGRATION_MANIFEST,
): Promise<MigrationCheckResult> {
  let applied: string[];
  try {
    applied = await readAppliedMigrations(db);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: [
        `Could not read the ${MIGRATION_TABLE} table, so the database schema cannot be`,
        "verified against the migrations this build was compiled with.",
        "",
        `  Cause: ${detail}`,
        "",
        `  This usually means no migration has ever been applied to this database`,
        `  (kysely creates ${MIGRATION_TABLE} on its first run).`,
        `  This build expects ${expected.length} migration(s), newest: ${newest([...expected].sort())}`,
        "",
        "  Fix: run the migrations against this database —",
        "    DATABASE_URL='...' npm exec kysely migrate up",
      ].join("\n"),
    };
  }

  return compareMigrations(expected, applied);
}
