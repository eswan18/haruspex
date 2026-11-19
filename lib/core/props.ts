import "server-only";

import type { ExpressionBuilder } from "kysely";
import { withRLS } from "@/lib/db-helpers";
import { attachOptions } from "@/lib/attach-options";
import { logger } from "@/lib/logger";
import type {
  Database,
  PropOptionSummary,
  VProp,
  VUser,
} from "@/types/db_types";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";
import type { CoreView } from "./views";

export type PropWithOptions = VProp & { options: PropOptionSummary[] };

/** A single id, null, or a list of them, as callers pass an id filter. */
type IdFilter = (number | null)[] | number | null | undefined;

function normalizeIds(ids: IdFilter): (number | null)[] {
  if (typeof ids === "number") return [ids];
  if (ids === null) return [null];
  if (Array.isArray(ids)) return ids;
  return [];
}

/**
 * The member view's filter: the caller's own personal props (or none of
 * anyone's), and props outside private competitions the caller is not in.
 */
function memberVisible(
  eb: ExpressionBuilder<Database, "v_props">,
  caller: VUser | null,
) {
  return eb.and([
    caller
      ? eb.or([
          eb("prop_user_id", "is", null),
          eb("prop_user_id", "=", caller.id),
        ])
      : eb("prop_user_id", "is", null),
    eb.or([
      eb("competition_id", "is", null),
      eb("competition_is_private", "=", false),
      ...(caller
        ? [
            eb.exists(
              eb
                .selectFrom("competition_members")
                .select("competition_members.id")
                .whereRef(
                  "competition_members.competition_id",
                  "=",
                  "v_props.competition_id",
                )
                .where("competition_members.user_id", "=", caller.id),
            ),
          ]
        : []),
    ]),
  ]);
}

/**
 * Props the caller can see, ordered by id. `competitionId` and `userId` each
 * take one id, null (rows with none) or a list; omitted means no filter.
 * `"rls"` (the default) is everything row-level security allows; `"member"`
 * also drops other users' personal props and props of private competitions
 * the caller is not a member of.
 */
export async function listProps(
  caller: VUser | null,
  filters: {
    competitionId?: IdFilter;
    userId?: IdFilter;
    view?: CoreView;
  },
): Promise<ServerActionResult<VProp[]>> {
  const { competitionId, userId } = filters;
  const view = filters.view ?? "rls";

  logger.debug("Getting props", {
    propCompetitionId: JSON.stringify(competitionId),
    propUserId: JSON.stringify(userId),
    currentUserId: caller?.id,
    view,
  });

  const startTime = Date.now();
  try {
    const normalizedUserId = normalizeIds(userId);
    const normalizedCompetitionId = normalizeIds(competitionId);

    const results = await withRLS(caller?.id, async (trx) => {
      let query = trx
        .selectFrom("v_props")
        .orderBy("prop_id", "asc")
        .selectAll();

      if (normalizedCompetitionId.length > 0) {
        const nonNullCompetitionIds = normalizedCompetitionId.filter(
          (id: number | null) => id !== null,
        );
        query = query.where((eb) => {
          const ors = [];
          if (nonNullCompetitionIds.length > 0) {
            ors.push(eb("competition_id", "in", nonNullCompetitionIds));
          }
          if (
            normalizedCompetitionId.find((id: number | null) => id === null) !==
            undefined
          ) {
            // If null is in the array, include rows where competition_id is null.
            ors.push(eb("competition_id", "is", null));
          }
          return eb.or(ors);
        });
      }

      if (normalizedUserId.length > 0) {
        const nonNullUserIds = normalizedUserId.filter(
          (id: number | null) => id !== null,
        );
        query = query.where((eb) => {
          const ors = [];
          if (nonNullUserIds.length > 0) {
            ors.push(eb("prop_user_id", "in", nonNullUserIds));
          }
          if (
            normalizedUserId.find((id: number | null) => id === null) !==
            undefined
          ) {
            // If null is in the array, we want to include public props (where prop_user_id is null).
            ors.push(eb("prop_user_id", "is", null));
          }
          return eb.or(ors);
        });
      }

      if (view === "member") {
        query = query.where((eb) => memberVisible(eb, caller));
      }

      return await query.execute();
    });

    logger.info(`Retrieved ${results.length} props`, {
      operation: "getProps",
      table: "v_props",
      propCompetitionId: JSON.stringify(competitionId),
      propUserId: JSON.stringify(userId),
      view,
      duration: Date.now() - startTime,
    });

    return success(results);
  } catch (err) {
    logger.error("Failed to get props", err as Error, {
      operation: "getProps",
      table: "v_props",
      propCompetitionId: JSON.stringify(competitionId),
      propUserId: JSON.stringify(userId),
      duration: Date.now() - startTime,
    });
    return error("Failed to fetch props", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * One prop with its option summaries, or null when the caller cannot see it.
 * `view` as for `listProps`: in `"member"`, another user's personal prop or a
 * private competition's prop the caller is not in reads as null.
 */
export async function getProp(
  caller: VUser | null,
  propId: number,
  opts: { view?: CoreView } = {},
): Promise<ServerActionResult<PropWithOptions | null>> {
  const view = opts.view ?? "rls";
  logger.debug("Getting prop by ID", {
    propId,
    currentUserId: caller?.id,
    view,
  });

  const startTime = Date.now();
  try {
    const result = await withRLS(caller?.id, async (trx) => {
      const prop = await trx
        .selectFrom("v_props")
        .selectAll()
        .where("prop_id", "=", propId)
        .where((eb) =>
          view === "member" ? memberVisible(eb, caller) : eb.val(true),
        )
        .executeTakeFirst();
      if (!prop) return null;
      const optionsByProp = await attachOptions(
        trx,
        [prop],
        caller?.id ?? null,
      );
      return { ...prop, options: optionsByProp.get(prop.prop_id) ?? [] };
    });

    logger.info("Retrieved prop by ID", {
      operation: "getPropById",
      table: "v_props",
      duration: Date.now() - startTime,
      propId,
      found: !!result,
    });

    return success(result);
  } catch (err) {
    logger.error("Error getting prop by ID", err as Error, {
      operation: "getPropById",
      table: "v_props",
      duration: Date.now() - startTime,
      propId,
    });
    return error("Failed to fetch prop", ERROR_CODES.DATABASE_ERROR);
  }
}
