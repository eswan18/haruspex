"use server";

import { randomUUID } from "node:crypto";

import { validateAnnouncement, type AnnouncementInput } from "@/lib/announcement";
import { withRLS } from "@/lib/db-helpers";
import { getUserFromCookies } from "@/lib/get-user";
import { logger } from "@/lib/logger";
import {
  publishAnnouncement,
  resolveAnnouncementAudience,
} from "@/lib/notifications/announcement";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";
import type { VUser } from "@/types/db_types";

/** The signed-in admin, or the refusal to hand back instead. */
async function requireAdmin(
  operation: string,
): Promise<{ admin: VUser } | { refusal: ServerActionResult<never> }> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    logger.warn(`Unauthorized attempt to ${operation}`);
    return {
      refusal: error(
        "You must be logged in to send announcements",
        ERROR_CODES.UNAUTHORIZED,
      ),
    };
  }
  // The /admin layout already blocks non-admins from the page, but a server
  // action is reachable without it.
  if (!currentUser.is_admin) {
    logger.warn(`Non-admin attempt to ${operation}`, {
      userId: currentUser.id,
    });
    return {
      refusal: error(
        "Only admins can send announcements",
        ERROR_CODES.UNAUTHORIZED,
      ),
    };
  }
  return { admin: currentUser };
}

/**
 * How many people an announcement sent now would reach, for the confirmation
 * the admin sees before sending.
 */
export async function getAnnouncementAudienceSize(): Promise<
  ServerActionResult<number>
> {
  const gate = await requireAdmin("count announcement recipients");
  if ("refusal" in gate) return gate.refusal;

  try {
    const recipients = await withRLS(gate.admin.id, (trx) =>
      resolveAnnouncementAudience(trx),
    );
    return success(recipients.length);
  } catch (err) {
    logger.error("Failed to count announcement recipients", err as Error, {
      userId: gate.admin.id,
    });
    return error(
      "Failed to count recipients",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

/**
 * Sends an announcement to every active user who has not turned them off, or,
 * with `test`, to the sending admin alone.
 *
 * A test copy goes to the admin whatever their own setting says: they asked to
 * see it. It is otherwise the same event, unsubscribe link and all, so what
 * they see is what everyone will get.
 *
 * As with the one-to-one email, success means queued, not delivered: comms
 * does the sending, and a Resend rejection shows up only in its logs. A
 * publish that fails is counted rather than fatal, so one bad publish does not
 * stop the rest; the admin is told how many did not go.
 */
export async function sendAnnouncement(
  input: AnnouncementInput & { test: boolean },
): Promise<ServerActionResult<{ queued: number; failed: number }>> {
  const operation = input.test
    ? "send a test announcement"
    : "send an announcement";
  const gate = await requireAdmin(operation);
  if ("refusal" in gate) return gate.refusal;
  const { admin } = gate;

  const checked = validateAnnouncement(
    input,
    process.env.APP_BASE_URL ?? "",
  );
  if (!checked.ok) {
    return error(checked.error, ERROR_CODES.VALIDATION_ERROR);
  }

  const startTime = Date.now();
  // Minted here so our own log line carries it too: it joins this record to
  // comms' record of each Resend message.
  const correlationId = randomUUID();
  const context = { correlationId, senderId: admin.id, test: input.test };

  try {
    let recipients;
    if (input.test) {
      if (!admin.email.trim()) {
        return error(
          "You have no email address on file to send a test to",
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      recipients = [{ id: admin.id, email: admin.email, name: admin.name }];
    } else {
      recipients = await withRLS(admin.id, (trx) =>
        resolveAnnouncementAudience(trx),
      );
    }

    const { queued, failed } = await publishAnnouncement(
      recipients,
      checked.announcement,
      correlationId,
    );

    for (const failure of failed) {
      logger.error("Failed to publish admin.announcement event", failure, context);
    }
    // Deliberately no subject or body in the log line, as with the one-to-one
    // email: who sent it, to how many, and whether it went is what matters.
    logger.info("Announcement queued", {
      ...context,
      recipients: recipients.length,
      queued,
      failed: failed.length,
      hasButton: Boolean(checked.announcement.button),
      duration: Date.now() - startTime,
    });

    if (recipients.length > 0 && queued === 0) {
      return error(
        "Failed to queue the announcement",
        ERROR_CODES.UNKNOWN_ERROR,
      );
    }
    return success({ queued, failed: failed.length });
  } catch (err) {
    logger.error("Failed to send announcement", err as Error, {
      ...context,
      duration: Date.now() - startTime,
    });
    return error(
      "Failed to send the announcement",
      ERROR_CODES.UNKNOWN_ERROR,
    );
  }
}
