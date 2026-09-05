import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Make `users.idp_user_id` unique.
 *
 * It had only a plain index (`idx_users_idp_user_id`, from
 * 1768298817000_add-idp-user-id), so nothing stopped two rows claiming the same
 * IdP subject. That mattered more than a duplicate normally would, because the
 * OAuth callback adopts whatever row it finds:
 *
 *     let user = await getUserByIdpUserId(claims.sub);
 *     if (!user) { user = await createUserFromIdp(...) }
 *
 * A row planted under someone else's `sub` is therefore taken as that person on
 * their next login, with whatever `is_admin` it carries. The action that made
 * planting possible is gone (#202) and the directory is admin-only (#203), but
 * both of those are application-layer checks. This is the database refusing the
 * shape outright, so the next unguarded write path -- however it arrives --
 * cannot produce a second row for an existing subject.
 *
 * NULL is still allowed and still non-unique: Postgres treats NULLs as
 * distinct in a unique index, which is what we want, since users created before
 * the IdP migration have no subject at all.
 *
 * DEPLOY NOTE: this fails if duplicates already exist. Check before shipping:
 *
 *   SELECT idp_user_id, COUNT(*) FROM users
 *   WHERE idp_user_id IS NOT NULL
 *   GROUP BY idp_user_id HAVING COUNT(*) > 1;
 *
 * A failed migration blocks boot by design (see lib/migrations/startup.ts), so
 * a duplicate would take the deploy down rather than pass quietly.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Replaces the plain index rather than sitting beside it: a unique index
  // serves lookups just as well, and keeping both would double the write cost
  // for nothing.
  await db.schema.dropIndex("idx_users_idp_user_id").execute();
  await sql<void>`
    CREATE UNIQUE INDEX idx_users_idp_user_id ON users (idp_user_id);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("idx_users_idp_user_id").execute();
  await db.schema
    .createIndex("idx_users_idp_user_id")
    .on("users")
    .column("idp_user_id")
    .execute();
}
