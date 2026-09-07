"use server";

import { withRLS, withRLSAction } from "@/lib/db-helpers";
import {
  Competition,
  CompetitionUpdate,
  NewCompetition,
} from "@/types/db_types";
import { getUserFromCookies } from "../get-user";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { canCreateProps } from "@/lib/prop-write-access";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

function validateCompetitionDates({
  forecasts_open_date,
  forecasts_close_date,
  end_date,
}: {
  forecasts_open_date: Date | null | undefined;
  forecasts_close_date: Date | null | undefined;
  end_date: Date | null | undefined;
}): ServerActionResult<void> {
  // Private competitions have null/undefined dates - skip validation
  if (
    forecasts_open_date == null ||
    forecasts_close_date == null ||
    end_date == null
  ) {
    return success(undefined);
  }

  if (forecasts_open_date >= forecasts_close_date) {
    return error(
      "Open date must be before close date",
      ERROR_CODES.VALIDATION_ERROR,
    );
  }
  if (forecasts_close_date >= end_date) {
    return error(
      "Close date must be before end date",
      ERROR_CODES.VALIDATION_ERROR,
    );
  }
  return success(undefined);
}

export async function getCompetitionById(
  id: number,
): Promise<ServerActionResult<Competition>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting competition by ID", {
    competitionId: id,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    const competition = await withRLS(currentUser?.id, async (trx) => {
      return trx
        .selectFrom("competitions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    });

    const duration = Date.now() - startTime;
    if (competition) {
      logger.info("Competition retrieved successfully", {
        operation: "getCompetitionById",
        table: "competitions",
        competitionId: id,
        duration,
      });
      return success(competition);
    } else {
      logger.warn("Competition not found", {
        operation: "getCompetitionById",
        table: "competitions",
        competitionId: id,
        duration,
      });
      return error("Competition not found", ERROR_CODES.NOT_FOUND);
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get competition by ID", err as Error, {
      operation: "getCompetitionById",
      table: "competitions",
      competitionId: id,
      duration,
    });
    return error("Failed to retrieve competition", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * The competitions this user could add a prop to.
 *
 * Asked on the server because the answer needs the membership role, which a
 * client has no cheap way to get -- and offering a destination the new-prop
 * route will then refuse is worse than not offering it. One left join rather
 * than a role lookup per competition.
 */
export async function getWritableCompetitions(): Promise<
  ServerActionResult<Competition[]>
> {
  const currentUser = await getUserFromCookies();

  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    // Two plain queries rather than one join: a join would hang `role` off
    // every competition row and leave it to be stripped back off before the
    // rows are Competitions again.
    const { competitions, memberships } = await withRLS(
      currentUser.id,
      async (trx) => {
        const [competitions, memberships] = await Promise.all([
          trx.selectFrom("competitions").selectAll().execute(),
          trx
            .selectFrom("competition_members")
            .select(["competition_id", "role"])
            .where("user_id", "=", currentUser.id)
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
        isSiteAdmin: currentUser.is_admin,
      }),
    );

    logger.info("Retrieved writable competitions", {
      operation: "getWritableCompetitions",
      table: "competitions",
      currentUserId: currentUser.id,
      count: writable.length,
    });

    return success(writable);
  } catch (err) {
    logger.error("Failed to get writable competitions", err as Error, {
      operation: "getWritableCompetitions",
      table: "competitions",
      currentUserId: currentUser?.id,
    });
    return error("Failed to retrieve competitions", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function getCompetitions(): Promise<
  ServerActionResult<Competition[]>
> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting all competitions", {
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    const results = await withRLS(currentUser?.id, async (trx) => {
      return trx
        .selectFrom("competitions")
        .orderBy("name", "desc")
        .selectAll()
        .execute();
    });

    const duration = Date.now() - startTime;
    logger.info(`Retrieved ${results.length} competitions`, {
      operation: "getCompetitions",
      table: "competitions",
      duration,
    });

    return success(results);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get competitions", err as Error, {
      operation: "getCompetitions",
      table: "competitions",
      duration,
    });
    return error("Failed to retrieve competitions", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function updateCompetition({
  id,
  competition,
}: {
  id: number;
  competition: CompetitionUpdate;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Updating competition", {
    competitionId: id,
    updateFields: Object.keys(competition),
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    // Prevent changing is_private — conversions are not supported yet.
    if ("is_private" in competition) {
      delete (competition as Record<string, unknown>)["is_private"];
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      // System admins can update any competition.
      // Competition admins can update their own private competitions.
      if (!currentUser.is_admin) {
        const membership = await trx
          .selectFrom("competition_members")
          .select("role")
          .where("competition_id", "=", id)
          .where("user_id", "=", currentUser.id)
          .executeTakeFirst();

        const comp = await trx
          .selectFrom("competitions")
          .select("is_private")
          .where("id", "=", id)
          .executeTakeFirst();

        if (!comp?.is_private || membership?.role !== "admin") {
          logger.warn("Unauthorized attempt to update competition", {
            competitionId: id,
            currentUserId: currentUser.id,
          });
          return error(
            "Only admins can update competitions",
            ERROR_CODES.UNAUTHORIZED,
          );
        }
      }

      // If any of the date fields are being changed, validate ordering using the
      // new values overlaid on the existing row.
      if (
        "forecasts_open_date" in competition ||
        "forecasts_close_date" in competition ||
        "end_date" in competition
      ) {
        const existing = await trx
          .selectFrom("competitions")
          .select(["forecasts_open_date", "forecasts_close_date", "end_date"])
          .where("id", "=", id)
          .executeTakeFirst();
        if (!existing) {
          return error("Competition not found", ERROR_CODES.NOT_FOUND);
        }
        const openDate =
          "forecasts_open_date" in competition &&
          competition.forecasts_open_date !== undefined
            ? competition.forecasts_open_date
            : existing.forecasts_open_date;
        const closeDate =
          "forecasts_close_date" in competition &&
          competition.forecasts_close_date !== undefined
            ? competition.forecasts_close_date
            : existing.forecasts_close_date;
        const endDate =
          "end_date" in competition && competition.end_date !== undefined
            ? competition.end_date
            : existing.end_date;
        const validationResult = validateCompetitionDates({
          forecasts_open_date: openDate,
          forecasts_close_date: closeDate,
          end_date: endDate,
        });
        if (!validationResult.success) {
          return validationResult;
        }
      }

      await trx
        .updateTable("competitions")
        .set(competition)
        .where("id", "=", id)
        .execute();

      return success(undefined);
    });

    if (result.success) {
      const duration = Date.now() - startTime;
      logger.info("Competition updated successfully", {
        operation: "updateCompetition",
        table: "competitions",
        competitionId: id,
        duration,
      });

      revalidatePath("/competitions");
      revalidatePath("/admin/competitions");
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to update competition", err as Error, {
      operation: "updateCompetition",
      table: "competitions",
      competitionId: id,
      duration,
    });
    return error("Failed to update competition", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function createCompetition({
  competition,
}: {
  competition: NewCompetition;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Creating competition", {
    competitionName: competition.name,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to create competition", {
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can create competitions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Validate dates on create
    const validationResult = validateCompetitionDates({
      forecasts_open_date: competition.forecasts_open_date,
      forecasts_close_date: competition.forecasts_close_date,
      end_date: competition.end_date,
    });
    if (!validationResult.success) {
      return validationResult;
    }

    await withRLS(currentUser.id, async (trx) => {
      // Insert the competition and get its ID
      const result = await trx
        .insertInto("competitions")
        .values({
          ...competition,
          created_by_user_id: currentUser.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // For private competitions, add the creator as an admin member
      if (competition.is_private) {
        await trx
          .insertInto("competition_members")
          .values({
            competition_id: result.id,
            user_id: currentUser.id,
            role: "admin",
          })
          .execute();

        logger.debug("Added creator as admin member", {
          competitionId: result.id,
          userId: currentUser.id,
        });
      }
    });

    const duration = Date.now() - startTime;
    logger.info("Competition created successfully", {
      operation: "createCompetition",
      table: "competitions",
      competitionName: competition.name,
      isPrivate: competition.is_private,
      duration,
    });

    revalidatePath("/competitions");
    revalidatePath("/admin/competitions");
    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to create competition", err as Error, {
      operation: "createCompetition",
      table: "competitions",
      competitionName: competition.name,
      duration,
    });
    return error("Failed to create competition", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Delete a competition, but only while it holds no props.
 *
 * `props.competition_id` carries no ON DELETE rule, so the database refuses to
 * drop a competition that still has props — and rightly: the props, every
 * forecast against them and every score derived from them would go too. The
 * count is checked here so an admin gets a sentence rather than a constraint
 * violation. Members go quietly, since `competition_members` cascades and a
 * membership means nothing without the competition it is in.
 */
export async function deleteCompetition({
  id,
}: {
  id: number;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Deleting competition", {
    competitionId: id,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to delete competition", {
        competitionId: id,
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can delete competitions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const propCount = await withRLS(currentUser.id, async (trx) => {
      const row = await trx
        .selectFrom("props")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("competition_id", "=", id)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    });

    if (propCount > 0) {
      logger.warn("Refused to delete a competition that still has props", {
        competitionId: id,
        propCount,
      });
      return error(
        `This competition still has ${propCount} ${
          propCount === 1 ? "prop" : "props"
        }. Delete or move them first.`,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    await withRLS(currentUser.id, async (trx) => {
      await trx.deleteFrom("competitions").where("id", "=", id).execute();
    });

    const duration = Date.now() - startTime;
    logger.info("Competition deleted successfully", {
      operation: "deleteCompetition",
      table: "competitions",
      competitionId: id,
      duration,
    });

    revalidatePath("/competitions");
    revalidatePath("/admin/competitions");
    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to delete competition", err as Error, {
      operation: "deleteCompetition",
      table: "competitions",
      competitionId: id,
      duration,
    });
    return error("Failed to delete competition", ERROR_CODES.DATABASE_ERROR);
  }
}
