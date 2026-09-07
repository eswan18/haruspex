import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Give suggested_props a notes column of its own.
 *
 * The table has only ever had one text column, so the suggestion form appended
 * the notes to the claim as a "\n\nNotes: " suffix and the admin page split
 * them apart again with a regex. This gives notes a column and the view the
 * created_at the table has recorded since 1743559965925 but never exposed.
 *
 * It also restores security_barrier/security_invoker on the view. 1743088073468
 * set them; 1768376738912 then dropped and recreated the view without them, as
 * did 1768587655070 and 1768992592533 -- each of which carefully re-set them on
 * v_users in the same breath. 1768466662120 enabled RLS on the table on the
 * stated assumption that the view still carried security_invoker and so would
 * cascade the policies. It did not, so the admin-only policy has not applied to
 * reads through the view since.
 */

// Exactly what components/dashboard's counterpart in the suggestion form wrote
// and what parsePropText in app/admin/suggested-props read back.
const MARKER = "\n\nNotes: ";

/** The view's shape after this migration. */
async function createView(db: Kysely<any>): Promise<void> {
  await db.schema
    .createView("v_suggested_props")
    .as(
      db
        .selectFrom("suggested_props")
        .innerJoin("v_users", "suggested_props.suggester_user_id", "v_users.id")
        .select([
          "suggested_props.id",
          "prop as prop_text",
          "suggested_props.notes",
          "suggested_props.created_at",
          "suggester_user_id as user_id",
          "name as user_name",
          "email as user_email",
        ]),
    )
    .execute();
  await setViewSecurity(db);
}

async function setViewSecurity(db: Kysely<any>): Promise<void> {
  await sql<void>`
    ALTER VIEW v_suggested_props
    SET (security_barrier = true, security_invoker = true)
  `.execute(db);
}

/**
 * Split notes written before the column existed back out of the claim. A no-op
 * on rows carrying no marker, and idempotent: a split row has no marker left.
 *
 * Exported so the integration test can run this exact statement. Test files run
 * in parallel against one shared container database, so a test cannot migrate
 * down and back up to stage pre-migration rows without pulling the schema out
 * from under every other suite mid-run.
 */
export async function backfillGluedNotes(db: Kysely<any>): Promise<void> {
  await sql<void>`
    UPDATE suggested_props
    SET
      notes = btrim(substring(prop from position(${MARKER} in prop) + ${MARKER.length})),
      prop = btrim(left(prop, position(${MARKER} in prop) - 1))
    WHERE position(${MARKER} in prop) > 0
  `.execute(db);
}

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("suggested_props")
    .addColumn("notes", "text")
    .execute();

  await backfillGluedNotes(db);

  await db.schema.dropView("v_suggested_props").execute();
  await createView(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropView("v_suggested_props").execute();

  // Glue the notes back onto the claim, the way the form used to.
  await sql<void>`
    UPDATE suggested_props
    SET prop = prop || ${MARKER} || notes
    WHERE notes IS NOT NULL
  `.execute(db);

  await db.schema.alterTable("suggested_props").dropColumn("notes").execute();

  // Deliberately NOT a faithful restore: the view goes back to its previous
  // columns but keeps security_barrier/security_invoker, which it was missing
  // before this migration. Rolling back a column should not also reopen the
  // hole in the RLS cascade -- reinstating that is never what a rollback wants.
  await db.schema
    .createView("v_suggested_props")
    .as(
      db
        .selectFrom("suggested_props")
        .innerJoin("v_users", "suggested_props.suggester_user_id", "v_users.id")
        .select([
          "suggested_props.id",
          "prop as prop_text",
          "suggester_user_id as user_id",
          "name as user_name",
          "email as user_email",
        ]),
    )
    .execute();
  await setViewSecurity(db);
}
