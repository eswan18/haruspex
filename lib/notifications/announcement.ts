import "server-only";
import type { Kysely, Transaction } from "kysely";

import type { Announcement } from "@/lib/announcement";
import {
  manageLink,
  notificationEnabled,
} from "@/lib/notifications/preferences";
import { unsubscribeLinks } from "@/lib/notifications/unsubscribe-token";
import { publishEvent } from "@/lib/pubsub/client";
import type { Database } from "@/types/db_types";

import type { Recipient } from "./prop-added";

type Executor = Kysely<Database> | Transaction<Database>;

/**
 * Everyone an announcement goes to: every active user with an address who has
 * not turned announcements off. Admins included — they hear what everyone
 * else hears, the sender among them.
 */
export function resolveAnnouncementAudience(
  db: Executor,
): Promise<Recipient[]> {
  return db
    .selectFrom("users")
    .select(["users.id", "users.email", "users.name"])
    .where("users.deactivated_at", "is", null)
    .where("users.email", "!=", "")
    .where(notificationEnabled("admin.announcement"))
    .orderBy("users.id")
    .execute();
}

/**
 * Publishes one `admin.announcement` event per recipient, and reports how many
 * went out.
 *
 * One recipient per event for the reason `announcePropAdded` gives: comms
 * nacks a whole message when any one send fails, so a shared event would
 * re-email everyone before the failure on every redelivery. The shared
 * correlation id is what still ties them all to the one announcement.
 *
 * Never throws: a failed publish is counted and logged, and the rest still go.
 */
export async function publishAnnouncement(
  recipients: Recipient[],
  announcement: Announcement,
  correlationId: string,
): Promise<{ queued: number; failed: Error[] }> {
  const results = await Promise.allSettled(
    recipients.map(({ id, ...recipient }) => {
      const links = unsubscribeLinks(id, "admin.announcement");
      return publishEvent({
        event_type: "admin.announcement",
        source: "haruspex",
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
        notify: [
          {
            ...recipient,
            unsubscribe_url: links.page,
            unsubscribe_post_url: links.post,
          },
        ],
        notify_link: announcement.button?.url,
        manage_link: manageLink("admin.announcement"),
        data: {
          subject: announcement.subject,
          body: announcement.body,
          button_label: announcement.button?.label,
        },
      });
    }),
  );

  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason as Error);
  return { queued: results.length - failed.length, failed };
}
