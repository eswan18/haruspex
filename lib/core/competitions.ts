import "server-only";

import { withRLS } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";
import { canCreateProps } from "@/lib/prop-write-access";
import type { Competition, VUser } from "@/types/db_types";
import type { CompetitionRole } from "@/lib/db_actions/competition-members";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";
import type { CoreView } from "./views";

export type CompetitionWithRole = Competition & {
  /** The caller's membership role; null for a public season or a non-member. */
  role: CompetitionRole | null;
  /** Whether the caller may add a prop here (see `canCreateProps`). */
  can_add_props: boolean;
};

/**
 * The competitions the caller can see, each with their role and whether they
 * may add props. `"rls"` (the default) is everything row-level security
 * allows; `"member"` also drops private competitions the caller is not in.
 */
export async function listCompetitions(
  caller: VUser | null,
  opts: { view?: CoreView } = {},
): Promise<ServerActionResult<CompetitionWithRole[]>> {
  const view = opts.view ?? "rls";
  logger.debug("Getting all competitions", { currentUserId: caller?.id, view });

  const startTime = Date.now();
  try {
    const { competitions, memberships } = await withRLS(
      caller?.id,
      async (trx) => {
        let query = trx
          .selectFrom("competitions")
          .orderBy("name", "desc")
          .selectAll();
        if (view === "member") {
          query = query.where((eb) =>
            caller
              ? eb.or([
                  eb("is_private", "=", false),
                  eb.exists(
                    eb
                      .selectFrom("competition_members")
                      .select("competition_members.id")
                      .whereRef(
                        "competition_members.competition_id",
                        "=",
                        "competitions.id",
                      )
                      .where("competition_members.user_id", "=", caller.id),
                  ),
                ])
              : eb("is_private", "=", false),
          );
        }
        const [competitions, memberships] = await Promise.all([
          query.execute(),
          caller
            ? trx
                .selectFrom("competition_members")
                .select(["competition_id", "role"])
                .where("user_id", "=", caller.id)
                .execute()
            : Promise.resolve([]),
        ]);
        return { competitions, memberships };
      },
    );

    const roleOf = new Map(memberships.map((m) => [m.competition_id, m.role]));
    const results = competitions.map((competition) => {
      const role = roleOf.get(competition.id) ?? null;
      return {
        ...competition,
        role,
        can_add_props: canCreateProps({
          isPrivate: competition.is_private,
          role,
          isSiteAdmin: caller?.is_admin ?? false,
        }),
      };
    });

    logger.info(`Retrieved ${results.length} competitions`, {
      operation: "listCompetitions",
      table: "competitions",
      view,
      duration: Date.now() - startTime,
    });

    return success(results);
  } catch (err) {
    logger.error("Failed to get competitions", err as Error, {
      operation: "listCompetitions",
      table: "competitions",
      duration: Date.now() - startTime,
    });
    return error("Failed to retrieve competitions", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * The competitions this user could add a prop to.
 *
 * Asked on the server because the answer needs the membership role, which a
 * client has no cheap way to get -- and offering a destination the new-prop
 * route will then refuse is worse than not offering it.
 */
export async function listWritableCompetitions(
  caller: VUser,
): Promise<ServerActionResult<Competition[]>> {
  try {
    // Two plain queries rather than one join: a join would hang `role` off
    // every competition row and leave it to be stripped back off before the
    // rows are Competitions again.
    const { competitions, memberships } = await withRLS(
      caller.id,
      async (trx) => {
        const [competitions, memberships] = await Promise.all([
          trx.selectFrom("competitions").selectAll().execute(),
          trx
            .selectFrom("competition_members")
            .select(["competition_id", "role"])
            .where("user_id", "=", caller.id)
            .execute(),
        ]);
        return { competitions, memberships };
      },
    );

    const roleOf = new Map(memberships.map((m) => [m.competition_id, m.role]));
    const writable = competitions.filter((competition) =>
      canCreateProps({
        isPrivate: competition.is_private,
        role: roleOf.get(competition.id) ?? null,
        isSiteAdmin: caller.is_admin,
      }),
    );

    logger.info("Retrieved writable competitions", {
      operation: "listWritableCompetitions",
      table: "competitions",
      currentUserId: caller.id,
      count: writable.length,
    });

    return success(writable);
  } catch (err) {
    logger.error("Failed to get writable competitions", err as Error, {
      operation: "listWritableCompetitions",
      table: "competitions",
      currentUserId: caller.id,
    });
    return error("Failed to retrieve competitions", ERROR_CODES.DATABASE_ERROR);
  }
}
