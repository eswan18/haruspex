import "server-only";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";

import type { NewPropAudience } from "@/lib/competition-status";
import { withRLS } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";
import { publishEvent, type NotifyTarget } from "@/lib/pubsub/client";
import type { Database } from "@/types/db_types";

type AudienceResolver = (
  db: Kysely<Database>,
  scope: { competitionId: number; authorId: number },
) => Promise<NotifyTarget[]>;

/**
 * How each kind of `NewPropAudience` becomes a list of people.
 *
 * A Record rather than a switch so that adding a kind to `NewPropAudience`
 * without a resolver here is a type error, not a silently empty send.
 */
const resolvers: Record<NewPropAudience, AudienceResolver> = {
  // Everyone in the competition, admins included, bar whoever wrote the prop.
  // Deactivated users keep their membership rows but should hear nothing.
  members: (db, { competitionId, authorId }) =>
    db
      .selectFrom("competition_members")
      .innerJoin("users", "users.id", "competition_members.user_id")
      .select(["users.email", "users.name"])
      .where("competition_members.competition_id", "=", competitionId)
      .where("users.deactivated_at", "is", null)
      .where("users.id", "!=", authorId)
      .orderBy("users.id")
      .execute(),
};

/** The people a new prop's announcement goes to. */
export function resolveNewPropAudience(
  db: Kysely<Database>,
  audience: NewPropAudience,
  scope: { competitionId: number; authorId: number },
): Promise<NotifyTarget[]> {
  return resolvers[audience](db, scope);
}

/**
 * Emails a competition's audience about a prop that was just added to it.
 *
 * Called fire-and-forget after the prop is committed, so it never throws: a
 * notification that fails to go out is logged, and the prop stands regardless.
 *
 * Publishes one event per recipient rather than one event naming them all.
 * comms sends to an event's targets in turn and nacks the whole message if any
 * send fails, so a shared event would re-email everyone before the failure on
 * each redelivery. One recipient per event means a retry repeats only that
 * recipient. They share a correlation id, so the one prop can still be traced
 * to all of its emails.
 */
export async function announcePropAdded({
  authorId,
  audience,
  competition,
  prop,
}: {
  authorId: number;
  audience: NewPropAudience;
  competition: { id: number; name: string };
  prop: { id: number; text: string; forecasts_due_date: Date | null };
}): Promise<void> {
  const correlationId = randomUUID();
  const context = {
    correlationId,
    competitionId: competition.id,
    propId: prop.id,
    audience,
  };

  let recipients: NotifyTarget[];
  try {
    // As the author, under RLS: the same view of the membership they had when
    // they added the prop.
    recipients = await withRLS(authorId, (trx) =>
      resolveNewPropAudience(trx, audience, {
        competitionId: competition.id,
        authorId,
      }),
    );
  } catch (err) {
    logger.error("Failed to resolve new-prop audience", err as Error, context);
    return;
  }

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      publishEvent({
        event_type: "competition.prop_added",
        source: "haruspex",
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
        notify: [recipient],
        notify_link: `${process.env.APP_BASE_URL}/competitions/${competition.id}/props/${prop.id}`,
        data: {
          competition_id: competition.id,
          competition_name: competition.name,
          prop_id: prop.id,
          prop_text: prop.text,
          forecasts_due_date: prop.forecasts_due_date?.toISOString() ?? null,
        },
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected");
  for (const failure of failed) {
    logger.error(
      "Failed to publish competition.prop_added event",
      (failure as PromiseRejectedResult).reason as Error,
      context,
    );
  }
  logger.info("New prop announced", {
    ...context,
    recipients: recipients.length,
    failed: failed.length,
  });
}
