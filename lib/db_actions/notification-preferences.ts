"use server";

import { withRLS } from "@/lib/db-helpers";
import { getUserFromCookies } from "@/lib/get-user";
import { logger } from "@/lib/logger";
import {
  getEffectivePreferences,
  setPreference,
  type EffectivePreferences,
} from "@/lib/notifications/preferences";
import {
  isOptionalNotification,
  type OptionalNotificationType,
} from "@/lib/notifications/types";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

/** What the account page shows: this reader's answer for every optional type. */
export async function getNotificationPreferences(): Promise<
  ServerActionResult<EffectivePreferences>
> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    return error(
      "You must be signed in to read your notification settings",
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  try {
    const preferences = await withRLS(currentUser.id, (trx) =>
      getEffectivePreferences(trx, currentUser.id),
    );
    return success(preferences);
  } catch (err) {
    logger.error("Failed to read notification preferences", err as Error, {
      userId: currentUser.id,
    });
    return error(
      "Failed to read your notification settings",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

/**
 * Record one choice for the signed-in reader.
 *
 * The session is all this adds: the writing itself is `setPreference`, which
 * takes a user id, so an unsubscribe link proving its reader with a signed
 * token can record the same choice without a login.
 */
export async function setNotificationPreference({
  type,
  enabled,
}: {
  type: OptionalNotificationType;
  enabled: boolean;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    return error(
      "You must be signed in to change your notification settings",
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  // A server action is a public endpoint whatever the form sends, and some
  // mail (an admin writing to one person) has no off switch to offer.
  if (!isOptionalNotification(type)) {
    logger.warn("Rejected a preference for a non-optional notification", {
      userId: currentUser.id,
      type,
    });
    return error(
      "That notification cannot be turned off",
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  try {
    await withRLS(currentUser.id, (trx) =>
      setPreference(trx, currentUser.id, type, enabled),
    );
    logger.info("Notification preference recorded", {
      userId: currentUser.id,
      type,
      enabled,
    });
    return success(undefined);
  } catch (err) {
    logger.error("Failed to record notification preference", err as Error, {
      userId: currentUser.id,
      type,
    });
    return error(
      "Failed to save your notification setting",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}
