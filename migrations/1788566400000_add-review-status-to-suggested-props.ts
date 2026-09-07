import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Let an admin accept or reject a suggestion.
 *
 * Pending is the absence of a decision, not a third value: status, decided_at
 * and decided_by are null together on a suggestion nobody has ruled on. Two
 * CHECK constraints hold that. `status` is text with a CHECK rather than a
 * Postgres enum, following props.kind in 1788220800000.
 *
 * decided_by is deliberately outside the invariant: #201 records an actor as
 * `currentUser?.id ?? null`, so a decision with no known actor is legal.
 *
 * The view is recreated to carry the decision, which means re-setting
 * security_barrier/security_invoker on it -- see 1788480000000 for what
 * forgetting that costs.
 */

/** The view's shape after this migration. */
async function createView(db: Kysely<any>): Promise<void> {
  await db.schema
    .createView("v_suggested_props")
    .as(
      db
        .selectFrom("suggested_props")
        .innerJoin("v_users", "suggested_props.suggester_user_id", "v_users.id")
        // Left, not inner: an undecided suggestion has no decider, and an
        // inner join here would hide every pending row -- the default view.
        .leftJoin(
          "v_users as decider",
          "suggested_props.decided_by",
          "decider.id",
        )
        .select([
          "suggested_props.id",
          "prop as prop_text",
          "suggested_props.notes",
          "suggested_props.created_at",
          "suggester_user_id as user_id",
          // Qualified: both joins carry `name` and `email`.
          "v_users.name as user_name",
          "v_users.email as user_email",
          "suggested_props.status",
          "suggested_props.decided_at",
          "decider.name as decided_by_name",
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

export async function up(db: Kysely<any>): Promise<void> {
  await sql<void>`ALTER TABLE suggested_props ADD COLUMN status text`.execute(
    db,
  );
  await sql<void>`ALTER TABLE suggested_props ADD COLUMN decided_by integer REFERENCES users(id)`.execute(
    db,
  );
  await sql<void>`ALTER TABLE suggested_props ADD COLUMN decided_at timestamptz`.execute(
    db,
  );

  // NULL passes a CHECK, so this constrains the decided rows only.
  await sql<void>`
    ALTER TABLE suggested_props ADD CONSTRAINT suggested_props_status_check
    CHECK (status IN ('accepted', 'rejected'))
  `.execute(db);

  // A decision has a timestamp, and a timestamp means a decision.
  await sql<void>`
    ALTER TABLE suggested_props ADD CONSTRAINT suggested_props_decision_check
    CHECK ((status IS NULL) = (decided_at IS NULL))
  `.execute(db);

  await db.schema.dropView("v_suggested_props").execute();
  await createView(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropView("v_suggested_props").execute();

  await sql<void>`ALTER TABLE suggested_props DROP CONSTRAINT suggested_props_decision_check`.execute(
    db,
  );
  await sql<void>`ALTER TABLE suggested_props DROP CONSTRAINT suggested_props_status_check`.execute(
    db,
  );
  await db.schema
    .alterTable("suggested_props")
    .dropColumn("decided_at")
    .dropColumn("decided_by")
    .dropColumn("status")
    .execute();

  // Back to the shape 1788480000000 left, security options included.
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
