import "server-only";

import { withRLS } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";

/**
 * Records that a user used the app today (UTC), for the admin Stats page's
 * active-user counts. Called from `getUserFromCookies` on every signed-in
 * request, never for an impersonated one: an admin looking around as someone
 * is not that person using the site.
 *
 * The database sees at most one write per user per day per server process.
 * This map remembers the last day this process recorded for each user, so
 * every later request that day returns without touching the database; with
 * several pods, a second pod's write for the same day is a no-op insert. One
 * entry per user ever seen, so it is bounded by the number of accounts.
 *
 * Fire-and-forget: the request never waits on it, and a failure is logged and
 * forgotten (the entry is cleared so a later request tries again) rather than
 * breaking a page over a statistic.
 */
const recordedDay = new Map<number, string>();

/** The UTC calendar day of `now`, as the YYYY-MM-DD the table stores. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Never rejects. The caller does not await it (`void recordActiveDay(…)`); the
 * promise is returned so tests can.
 */
export function recordActiveDay(
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  const day = utcDay(now);
  if (recordedDay.get(userId) === day) return Promise.resolve();
  recordedDay.set(userId, day);

  return withRLS(userId, async (trx) => {
    await trx
      .insertInto("user_active_days")
      .values({ user_id: userId, day })
      .onConflict((oc) => oc.columns(["user_id", "day"]).doNothing())
      .execute();
  }).catch((err) => {
    if (recordedDay.get(userId) === day) recordedDay.delete(userId);
    logger.warn("Failed to record an active day", {
      userId,
      day,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** For tests: forget what this process has recorded. */
export function resetRecordedDays(): void {
  recordedDay.clear();
}
