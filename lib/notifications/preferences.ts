import "server-only";
import { sql, type Kysely, type SqlBool, type Transaction } from "kysely";

import {
  notificationDefault,
  OPTIONAL_NOTIFICATION_TYPES,
  type OptionalNotificationType,
} from "@/lib/notifications/types";
import type { Database } from "@/types/db_types";

type Executor = Kysely<Database> | Transaction<Database>;

/** A reader's answer for every optional notification. */
export type EffectivePreferences = Record<OptionalNotificationType, boolean>;

/**
 * A condition for any query that has `users` in scope: does this user want
 * this notification?
 *
 * Correlated rather than joined so it can be dropped into an existing
 * recipient query without disturbing its shape, and so a user with no row
 * still appears — falling back to the registry default, which is the whole
 * meaning of "has never chosen".
 *
 * `fallback` is the registry's default unless given; passing it is for tests
 * that need to pin a default rather than follow the registry's.
 */
export function notificationEnabled(
  type: OptionalNotificationType,
  fallback: boolean = notificationDefault(type),
) {
  return sql<SqlBool>`coalesce((
    select np.enabled
    from notification_preferences np
    where np.user_id = users.id and np.notification_type = ${type}
  ), ${fallback})`;
}

/**
 * What this reader gets today: their explicit choices, with the registry's
 * defaults standing in wherever they have never chosen.
 */
export async function getEffectivePreferences(
  db: Executor,
  userId: number,
): Promise<EffectivePreferences> {
  const rows = await db
    .selectFrom("notification_preferences")
    .select(["notification_type", "enabled"])
    .where("user_id", "=", userId)
    .execute();

  const chosen = new Map(
    rows.map((row) => [row.notification_type, row.enabled]),
  );
  return Object.fromEntries(
    OPTIONAL_NOTIFICATION_TYPES.map((type) => [
      type,
      chosen.get(type) ?? notificationDefault(type),
    ]),
  ) as EffectivePreferences;
}

/**
 * Record one choice.
 *
 * Takes the user id rather than reading the session, so the unsubscribe link
 * in an email — which proves who the reader is with a signed token and no
 * login at all — can use this same path when it arrives.
 *
 * Writes the row whether or not it matches the current default: a choice is
 * stored because it was made, and that is what keeps a later default change
 * from moving this reader.
 */
export async function setPreference(
  db: Executor,
  userId: number,
  type: OptionalNotificationType,
  enabled: boolean,
): Promise<void> {
  await db
    .insertInto("notification_preferences")
    .values({ user_id: userId, notification_type: type, enabled })
    .onConflict((oc) =>
      oc.columns(["user_id", "notification_type"]).doUpdateSet({
        enabled,
        updated_at: sql`now()`,
      }),
    )
    .execute();
}
