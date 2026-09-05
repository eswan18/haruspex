"use server";

import { withRLS, withRLSAction } from "@/lib/db-helpers";
import {
  CompetitionMember,
  PublicUser,
  VCompetitionMember,
} from "@/types/db_types";
import { getUserFromCookies } from "../get-user";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { publishEvent } from "@/lib/pubsub/client";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

export type CompetitionRole = "admin" | "forecaster";

/**
 * Get all members of a competition with user details
 */
export async function getCompetitionMembers(
  competitionId: number,
): Promise<ServerActionResult<VCompetitionMember[]>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting competition members", {
    competitionId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    const members = await withRLS(currentUser?.id, async (trx) => {
      return trx
        .selectFrom("v_competition_members")
        .selectAll()
        .where("competition_id", "=", competitionId)
        .orderBy("role", "asc") // admins first
        .orderBy("user_name", "asc")
        .execute();
    });

    const duration = Date.now() - startTime;
    logger.info(`Retrieved ${members.length} competition members`, {
      operation: "getCompetitionMembers",
      table: "v_competition_members",
      competitionId,
      duration,
    });

    return success(members);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get competition members", err as Error, {
      operation: "getCompetitionMembers",
      table: "v_competition_members",
      competitionId,
      duration,
    });
    return error(
      "Failed to retrieve competition members",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

/**
 * Get the current user's role in a competition
 * Returns null if the user is not a member
 */
export async function getCurrentUserRole(
  competitionId: number,
): Promise<ServerActionResult<CompetitionRole | null>> {
  const currentUser = await getUserFromCookies();

  if (!currentUser) {
    return success(null);
  }

  logger.debug("Getting current user role", {
    competitionId,
    currentUserId: currentUser.id,
  });

  const startTime = Date.now();
  try {
    const membership = await withRLS(currentUser.id, async (trx) => {
      return trx
        .selectFrom("competition_members")
        .select("role")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", currentUser.id)
        .executeTakeFirst();
    });

    const duration = Date.now() - startTime;
    logger.info("Retrieved current user role", {
      operation: "getCurrentUserRole",
      table: "competition_members",
      competitionId,
      userId: currentUser.id,
      role: membership?.role ?? null,
      duration,
    });

    return success(membership?.role ?? null);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get current user role", err as Error, {
      operation: "getCurrentUserRole",
      table: "competition_members",
      competitionId,
      userId: currentUser.id,
      duration,
    });
    return error("Failed to retrieve user role", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Remove a member from a competition
 * Only competition admins can remove members
 * Admins cannot remove themselves if they're the last admin
 */
export async function removeCompetitionMember({
  competitionId,
  userId,
}: {
  competitionId: number;
  userId: number;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Removing competition member", {
    competitionId,
    userId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      // Check if current user is an admin of this competition
      const currentUserMembership = await trx
        .selectFrom("competition_members")
        .select("role")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", currentUser.id)
        .executeTakeFirst();

      if (currentUserMembership?.role !== "admin") {
        logger.warn("Unauthorized attempt to remove competition member", {
          competitionId,
          currentUserId: currentUser.id,
          currentRole: currentUserMembership?.role,
        });
        return error(
          "Only competition admins can remove members",
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // If removing self, check that they're not the last admin
      if (userId === currentUser.id) {
        const adminCount = await trx
          .selectFrom("competition_members")
          .select((eb) => eb.fn.count("id").as("count"))
          .where("competition_id", "=", competitionId)
          .where("role", "=", "admin")
          .executeTakeFirst();

        if (Number(adminCount?.count) <= 1) {
          return error(
            "Cannot remove the last admin from a competition",
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      const deleteResult = await trx
        .deleteFrom("competition_members")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .executeTakeFirst();

      if (Number(deleteResult.numDeletedRows) === 0) {
        return error(
          "Member not found in this competition",
          ERROR_CODES.NOT_FOUND,
        );
      }

      return success(undefined);
    });

    if (result.success) {
      const duration = Date.now() - startTime;
      logger.info("Competition member removed successfully", {
        operation: "removeCompetitionMember",
        table: "competition_members",
        competitionId,
        removedUserId: userId,
        duration,
      });
      revalidatePath(`/competitions/${competitionId}`);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to remove competition member", err as Error, {
      operation: "removeCompetitionMember",
      table: "competition_members",
      competitionId,
      userId,
      duration,
    });
    return error("Failed to remove member", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Update a member's role in a competition
 * Only competition admins can update roles
 * Cannot demote the last admin
 */
export async function updateMemberRole({
  competitionId,
  userId,
  newRole,
}: {
  competitionId: number;
  userId: number;
  newRole: CompetitionRole;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Updating competition member role", {
    competitionId,
    userId,
    newRole,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      // Check if current user is an admin of this competition
      const currentUserMembership = await trx
        .selectFrom("competition_members")
        .select("role")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", currentUser.id)
        .executeTakeFirst();

      if (currentUserMembership?.role !== "admin") {
        logger.warn("Unauthorized attempt to update member role", {
          competitionId,
          currentUserId: currentUser.id,
          currentRole: currentUserMembership?.role,
        });
        return error(
          "Only competition admins can update roles",
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // Get the member's current role
      const targetMembership = await trx
        .selectFrom("competition_members")
        .select("role")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .executeTakeFirst();

      if (!targetMembership) {
        return error(
          "Member not found in this competition",
          ERROR_CODES.NOT_FOUND,
        );
      }

      // If demoting an admin, check that they're not the last admin
      if (targetMembership.role === "admin" && newRole !== "admin") {
        const adminCount = await trx
          .selectFrom("competition_members")
          .select((eb) => eb.fn.count("id").as("count"))
          .where("competition_id", "=", competitionId)
          .where("role", "=", "admin")
          .executeTakeFirst();

        if (Number(adminCount?.count) <= 1) {
          return error(
            "Cannot demote the last admin",
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      await trx
        .updateTable("competition_members")
        .set({ role: newRole, updated_at: new Date() })
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .execute();

      return success(undefined);
    });

    if (result.success) {
      const duration = Date.now() - startTime;
      logger.info("Competition member role updated successfully", {
        operation: "updateMemberRole",
        table: "competition_members",
        competitionId,
        userId,
        newRole,
        duration,
      });
      revalidatePath(`/competitions/${competitionId}`);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to update member role", err as Error, {
      operation: "updateMemberRole",
      table: "competition_members",
      competitionId,
      userId,
      duration,
    });
    return error("Failed to update role", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Get the count of members in a competition
 */
export async function getMemberCount(
  competitionId: number,
): Promise<ServerActionResult<number>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting competition member count", {
    competitionId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    const result = await withRLS(currentUser?.id, async (trx) => {
      return trx
        .selectFrom("competition_members")
        .select((eb) => eb.fn.count("id").as("count"))
        .where("competition_id", "=", competitionId)
        .executeTakeFirst();
    });

    const count = Number(result?.count ?? 0);

    const duration = Date.now() - startTime;
    logger.info("Retrieved competition member count", {
      operation: "getMemberCount",
      table: "competition_members",
      competitionId,
      count,
      duration,
    });

    return success(count);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get member count", err as Error, {
      operation: "getMemberCount",
      table: "competition_members",
      competitionId,
      duration,
    });
    return error("Failed to get member count", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Get all active users who are NOT already members of a competition.
 * Used for the searchable user picker in the invite dialog.
 */
export async function getEligibleMembers(
  competitionId: number,
): Promise<ServerActionResult<Pick<PublicUser, "id" | "name" | "username">[]>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting eligible members", {
    competitionId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      // Only competition admins (or system admins) can view eligible members
      if (!currentUser.is_admin) {
        const membership = await trx
          .selectFrom("competition_members")
          .select("role")
          .where("competition_id", "=", competitionId)
          .where("user_id", "=", currentUser.id)
          .executeTakeFirst();

        if (membership?.role !== "admin") {
          return error(
            "Only competition admins can view eligible members",
            ERROR_CODES.UNAUTHORIZED,
          );
        }
      }

      // Get IDs of existing members
      const existingMemberIds = trx
        .selectFrom("competition_members")
        .select("user_id")
        .where("competition_id", "=", competitionId);

      const users = await trx
        .selectFrom("users")
        .select(["id", "name", "username"])
        .where("deactivated_at", "is", null)
        .where("id", "not in", existingMemberIds)
        .orderBy("name", "asc")
        .execute();

      return success(users);
    });

    if (result.success) {
      const duration = Date.now() - startTime;
      logger.debug(`Retrieved ${result.data.length} eligible members`, {
        operation: "getEligibleMembers",
        table: "users",
        competitionId,
        duration,
      });
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get eligible members", err as Error, {
      operation: "getEligibleMembers",
      table: "users",
      competitionId,
      duration,
    });
    return error("Failed to fetch eligible users", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Add a member to a competition by user ID.
 * Only competition admins can add members.
 */
export async function addCompetitionMemberById({
  competitionId,
  userId,
  role,
}: {
  competitionId: number;
  userId: number;
  role: CompetitionRole;
}): Promise<ServerActionResult<CompetitionMember>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Adding competition member by ID", {
    competitionId,
    userId,
    role,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      // Only competition admins (or system admins) can add members
      if (!currentUser.is_admin) {
        const currentUserMembership = await trx
          .selectFrom("competition_members")
          .select("role")
          .where("competition_id", "=", competitionId)
          .where("user_id", "=", currentUser.id)
          .executeTakeFirst();

        if (currentUserMembership?.role !== "admin") {
          return error(
            "Only competition admins can add members",
            ERROR_CODES.UNAUTHORIZED,
          );
        }
      }

      // Verify the target user exists and is active
      const userToAdd = await trx
        .selectFrom("users")
        .select(["id", "name", "email"])
        .where("id", "=", userId)
        .where("deactivated_at", "is", null)
        .executeTakeFirst();

      if (!userToAdd) {
        return error(
          "No active user found with that ID",
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Check if user is already a member
      const existingMembership = await trx
        .selectFrom("competition_members")
        .select("id")
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .executeTakeFirst();

      if (existingMembership) {
        return error(
          "User is already a member of this competition",
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const inserted = await trx
        .insertInto("competition_members")
        .values({
          competition_id: competitionId,
          user_id: userId,
          role,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Look up competition for notification
      const competition = await trx
        .selectFrom("competitions")
        .select(["name", "is_private"])
        .where("id", "=", competitionId)
        .executeTakeFirst();

      return success({ inserted, userToAdd: userToAdd!, competition });
    });

    if (result.success) {
      const { inserted, userToAdd, competition } = result.data;
      const duration = Date.now() - startTime;
      logger.info("Competition member added successfully", {
        operation: "addCompetitionMemberById",
        table: "competition_members",
        competitionId,
        addedUserId: inserted.user_id,
        role,
        duration,
      });
      revalidatePath(`/competitions/${competitionId}`);

      // Notify the added user (fire-and-forget, only for private competitions)
      if (competition?.is_private) {
        publishEvent({
          event_type: "competition.member_added",
          source: "haruspex",
          timestamp: new Date().toISOString(),
          notify: [{ email: userToAdd.email, name: userToAdd.name }],
          notify_link: `${process.env.APP_BASE_URL}/competitions/${competitionId}`,
          data: {
            competition_name: competition.name,
            competition_id: competitionId,
          },
        }).catch((err) => {
          logger.error("Failed to publish competition.member_added event", err as Error, {
            competitionId,
            userId,
          });
        });
      }

      return success(inserted);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to add competition member by ID", err as Error, {
      operation: "addCompetitionMemberById",
      table: "competition_members",
      competitionId,
      userId,
      duration,
    });
    return error("Failed to add member", ERROR_CODES.DATABASE_ERROR);
  }
}
