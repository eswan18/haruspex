import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * A reader's suggestion must arrive undecided.
 *
 * users_insert_own (1768466662120) checked only that you suggested as
 * yourself, so a reader could insert a suggestion already marked accepted,
 * with themselves as the decider. The app never sent one -- createSuggestedProp
 * now builds the row from the session -- but the policy is what holds when the
 * app is wrong. Admins are unaffected: admin_all_access is a separate,
 * permissive policy.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql<void>`DROP POLICY "users_insert_own" ON suggested_props`.execute(
    db,
  );
  await sql<void>`
    CREATE POLICY "users_insert_own" ON suggested_props
    FOR INSERT
    WITH CHECK (
      current_user_id() = suggester_user_id
      AND status IS NULL
      AND decided_by IS NULL
      AND decided_at IS NULL
    );
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql<void>`DROP POLICY "users_insert_own" ON suggested_props`.execute(
    db,
  );
  await sql<void>`
    CREATE POLICY "users_insert_own" ON suggested_props
    FOR INSERT
    WITH CHECK (current_user_id() = suggester_user_id);
  `.execute(db);
}
