import "server-only";

import { sql } from "kysely";
import { db } from "@/lib/database";
import { logger } from "@/lib/logger";

/**
 * Whether a feature is on for a user. A flag row for the user beats the
 * blanket (null-user) row; an unset flag is off. Throws on a database error.
 */
export async function featureEnabled(
  userId: number,
  featureName: string,
): Promise<boolean> {
  const startTime = Date.now();
  const result = await db
    .selectFrom("feature_flags")
    .select("enabled")
    .where("name", "=", featureName)
    .where((eb) => eb("user_id", "=", userId).or("user_id", "is", null))
    // By putting nulls last, we allow a blanket toggle for all users to be overriden by a specific user's setting.
    .orderBy(sql`user_id nulls last`)
    .executeTakeFirst();

  // Assume unset flags are disabled.
  const enabled = result?.enabled ?? false;

  logger.info("Feature flag check completed", {
    operation: "featureEnabled",
    table: "feature_flags",
    featureName,
    userId,
    enabled,
    duration: Date.now() - startTime,
  });

  return enabled;
}
