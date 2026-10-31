import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Which days each user used the app: one row per user per UTC day they were
 * signed in, written on their first request of the day (lib/active-days.ts).
 *
 * It is the whole of the admin Stats page's "active users": a day's actives
 * are its rows, and a week's or a month's are the distinct users across its
 * days. One row per user per day at most, so it stays small (tens of
 * thousands of rows a year at this app's size); raw page views are
 * deliberately not stored.
 *
 * No history before this migration: there was nothing that recorded it.
 *
 * RLS: a user may record and read only their own days; admins read all of
 * them, since when someone used the site is nobody else's business. A user
 * reading their own rows is not a feature but a requirement: the recorder's
 * INSERT ... ON CONFLICT DO NOTHING is checked against SELECT policies too, and
 * without this it fails on every write. The write policy allows INSERT alone,
 * so no one can rewrite or remove the record through the app; ON DELETE
 * CASCADE on the user is the only way rows go.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("user_active_days")
    .addColumn("user_id", "integer", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("day", "date", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("user_active_days_pkey", ["user_id", "day"])
    .execute();

  // The stats queries range over days first; the primary key leads with
  // user_id and cannot serve them.
  await db.schema
    .createIndex("user_active_days_day_idx")
    .on("user_active_days")
    .column("day")
    .execute();

  await sql<void>`ALTER TABLE user_active_days ENABLE ROW LEVEL SECURITY`.execute(
    db,
  );

  await sql<void>`
    CREATE POLICY record_own_active_day ON user_active_days
    FOR INSERT
    WITH CHECK (user_id = current_user_id());
  `.execute(db);

  await sql<void>`
    CREATE POLICY read_own_or_admin_active_days ON user_active_days
    FOR SELECT
    USING (user_id = current_user_id() OR is_current_user_admin());
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql<void>`DROP POLICY read_own_or_admin_active_days ON user_active_days`.execute(
    db,
  );
  await sql<void>`DROP POLICY record_own_active_day ON user_active_days`.execute(
    db,
  );
  await db.schema.dropTable("user_active_days").execute();
}
