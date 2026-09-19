import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * What a reader has decided about the mail we send them.
 *
 * A row means the reader chose; no row means they have never said, and they
 * follow the default in `lib/notifications/types.ts`. That is the whole point
 * of the design: a default can be changed for the undecided without moving
 * anyone who actually chose. The flip side is that changing a default DOES
 * move the undecided, so a default change ships with a migration that writes
 * the old value as an explicit row for every user without one — see the
 * tripwire in `lib/notifications/types.test.ts`.
 *
 * `notification_type` is text rather than an enum, following props.kind and
 * suggested_props.status: the registry in the app is the list, and a type it
 * does not know is simply one nothing publishes.
 *
 * RLS: anyone may read. A new prop's audience is resolved as the author, and
 * an author must be able to see that another member opted out, or the opt-out
 * would be silently ignored — which is exactly the failure this table exists
 * to prevent. Writes are your own rows only, and unlike the forecasts
 * policies (1743562246323) the read and write policies are separate, so
 * `USING (1 = 1)` cannot hand anyone else's row to a DELETE.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("notification_preferences")
    .addColumn("user_id", "integer", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("notification_type", "text", (col) => col.notNull())
    .addColumn("enabled", "boolean", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("notification_preferences_pkey", [
      "user_id",
      "notification_type",
    ])
    .execute();

  await sql<void>`ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY`.execute(
    db,
  );

  await sql<void>`
    CREATE POLICY read_all_notification_preferences ON notification_preferences
    FOR SELECT
    USING (true);
  `.execute(db);

  await sql<void>`
    CREATE POLICY write_own_notification_preferences ON notification_preferences
    FOR ALL
    USING (user_id = current_user_id())
    WITH CHECK (user_id = current_user_id());
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql<void>`DROP POLICY write_own_notification_preferences ON notification_preferences`.execute(
    db,
  );
  await sql<void>`DROP POLICY read_all_notification_preferences ON notification_preferences`.execute(
    db,
  );
  await db.schema.dropTable("notification_preferences").execute();
}
