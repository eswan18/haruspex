import { promises as fsPromises } from "node:fs";
import * as path from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const useContainers = process.env.TEST_USE_CONTAINERS === "true";
const MIGRATION = "1795721754183_add-voided-resolutions";

/**
 * Rolling back the voided-props migration, on a database of its own: down()
 * must restore the schema, and must refuse while a void is stored, since
 * dropping the column would leave it as a resolution with no result.
 */
describe.skipIf(!useContainers)("rolling back voided props", () => {
  const opened: Kysely<any>[] = [];

  function connect(name: string): Kysely<any> {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${name}`;
    const db = new Kysely<any>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    opened.push(db);
    return db;
  }

  afterAll(async () => {
    await Promise.all(opened.map((db) => db.destroy()));
  });

  async function migratedDatabase(name: string) {
    const admin = connect("postgres");
    await sql.raw(`drop database if exists ${name}`).execute(admin);
    await sql.raw(`create database ${name}`).execute(admin);
    const db = connect(name);
    const baseline =
      await import("@/tests/helpers/000000000000_create-initial-schema");
    await baseline.up(db);
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs: fsPromises,
        path,
        migrationFolder: path.join(process.cwd(), "migrations"),
      }),
    });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
    return { db, migrator };
  }

  it("removes the column and its views' field, and comes back up", async () => {
    const { db, migrator } = await migratedDatabase("voided_rollback");

    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results?.[0]?.migrationName).toBe(MIGRATION);
    const cols = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'resolutions' AND column_name = 'voided'`.execute(db);
    expect(cols.rows[0].n).toBe(0);
    await expect(
      sql`SELECT resolution_voided FROM v_props LIMIT 1`.execute(db),
    ).rejects.toThrow();
    const kind = await sql<{ config: string[] | null }>`
      SELECT proconfig AS config FROM pg_proc
      WHERE proname = 'check_resolution_matches_prop_kind'`.execute(db);
    expect(kind.rows[0].config).toBeNull();

    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    await sql`SELECT resolution_voided FROM v_props LIMIT 1`.execute(db);
  }, 120000);

  it("refuses to roll back while a void is stored", async () => {
    const { db, migrator } = await migratedDatabase("voided_rollback_refused");
    // A prop needs a category, competition or owner (a CHECK on props).
    const category = await sql<{ id: number }>`
      INSERT INTO categories (name) VALUES ('Rollback') RETURNING id`.execute(
      db,
    );
    const prop = await sql<{ id: number }>`
      INSERT INTO props (text, category_id)
      VALUES ('Voided before rollback', ${category.rows[0].id})
      RETURNING id`.execute(db);
    await sql`
      INSERT INTO resolutions (prop_id, resolution, voided)
      VALUES (${prop.rows[0].id}, NULL, true)`.execute(db);

    const down = await migrator.migrateDown();

    expect(String(down.error)).toMatch(/voided/);
    const cols = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'resolutions' AND column_name = 'voided'`.execute(db);
    expect(cols.rows[0].n).toBe(1);
  }, 120000);
});
