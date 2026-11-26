"use server";
import { getUserFromCookies } from "../get-user";
import {
  VProp,
  PropUpdate,
  NewProp,
  PropOptionSummary,
} from "@/types/db_types";
import {
  ServerActionResult,
  ERROR_CODES,
  error,
  success,
  validationError,
} from "@/lib/server-action-result";
import { logger } from "@/lib/logger";
import { withRLS, withRLSAction } from "@/lib/db-helpers";
import {
  createProp as coreCreateProp,
  getProp,
  listProps,
  resolveProp as coreResolveProp,
  resolveRefusal,
} from "@/lib/core/props";
import type { OptionOutcome } from "@/lib/choice-forecast";

export async function getPropById(
  propId: number,
): Promise<
  ServerActionResult<(VProp & { options: PropOptionSummary[] }) | null>
> {
  const currentUser = await getUserFromCookies();
  return getProp(currentUser, propId);
}

export async function getProps({
  competitionId,
  userId,
}: {
  competitionId?: (number | null)[] | number | null;
  userId?: (number | null)[] | number | null;
}): Promise<ServerActionResult<VProp[]>> {
  const currentUser = await getUserFromCookies();
  return listProps(currentUser, { competitionId, userId });
}

export async function resolveProp(args: {
  propId: number;
  /** Required for yes/no props, forbidden for choice ones. */
  resolution?: boolean;
  /** Required for choice props, forbidden for yes/no ones. */
  outcomes?: OptionOutcome[];
  /** Settles the prop with no outcome, instead of a resolution or outcomes. */
  voided?: boolean;
  notes?: string;
  overwrite?: boolean;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    return error(
      "You must be logged in to resolve propositions",
      ERROR_CODES.UNAUTHORIZED,
    );
  }
  return coreResolveProp(currentUser, args);
}

export async function unresolveProp({
  propId,
}: {
  propId: number;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Unresolving prop", {
    propId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error(
        "You must be logged in to unresolve propositions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      const prop = await trx
        .selectFrom("v_props")
        .select(["prop_id", "prop_user_id", "competition_id"])
        .where("prop_id", "=", propId)
        .executeTakeFirst();
      if (!prop) {
        return error("Proposition not found", ERROR_CODES.NOT_FOUND);
      }
      const refusal = await resolveRefusal(trx, currentUser, prop, "unresolve");
      if (refusal) return refusal;

      const deleted = await trx
        .deleteFrom("resolutions")
        .where("prop_id", "=", propId)
        .executeTakeFirst();
      if (deleted.numDeletedRows === BigInt(0)) {
        return error(
          `Proposition ${propId} has no resolution`,
          ERROR_CODES.NOT_FOUND,
        );
      }
      return success(undefined);
    });
    if (!result.success) return result;

    const duration = Date.now() - startTime;
    logger.info("Prop unresolved successfully", {
      operation: "unresolveProp",
      table: "resolutions",
      propId,
      duration,
    });

    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to unresolve prop", err as Error, {
      operation: "unresolveProp",
      table: "resolutions",
      propId,
      duration,
    });
    return error("Failed to unresolve prop", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function updateProp({
  id,
  prop,
}: {
  id: number;
  prop: PropUpdate;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Updating prop", {
    propId: id,
    updateFields: Object.keys(prop),
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      logger.warn("Unauthorized attempt to update prop", { propId: id });
      return error(
        "You must be logged in to update propositions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // The kind is fixed at creation (a database trigger enforces this too);
    // reject the update before it reaches the database.
    if (prop.kind !== undefined) {
      logger.warn("Attempted to change the kind of a prop", { propId: id });
      return error(
        "The kind of a proposition cannot be changed",
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Validate prop data
    if (prop.text && prop.text.trim().length < 8) {
      logger.warn("Validation error: prop text too short", {
        propId: id,
        textLength: prop.text?.length,
      });
      return validationError(
        "Proposition text must be at least 8 characters long",
        { text: ["Text is too short"] },
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    await withRLS(currentUser?.id, async (trx) => {
      await trx.updateTable("props").set(prop).where("id", "=", id).execute();
    });

    const duration = Date.now() - startTime;
    logger.info("Prop updated successfully", {
      operation: "updateProp",
      table: "props",
      propId: id,
      duration,
    });

    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to update prop", err as Error, {
      operation: "updateProp",
      table: "props",
      propId: id,
      duration,
    });
    return error("Failed to update proposition", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function createProp(args: {
  prop: NewProp;
  /** Required for choice props, forbidden for binary ones. */
  options?: string[];
  /**
   * The author's opt-in to emailing the competition about this prop. Only
   * honoured where `newPropAudience` names someone to tell; off by default so
   * no caller sends mail it did not ask for.
   */
  notifyMembers?: boolean;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    logger.warn("Unauthorized attempt to create prop");
    return error(
      "You must be logged in to create propositions",
      ERROR_CODES.UNAUTHORIZED,
    );
  }
  const result = await coreCreateProp(currentUser, args);
  return result.success ? success(undefined) : result;
}

export async function deleteResolution({
  id,
}: {
  id: number;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Deleting resolution", {
    resolutionId: id,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      return error(
        "You must be logged in to delete resolutions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
      const prop = await trx
        .selectFrom("resolutions")
        .innerJoin("props", "props.id", "resolutions.prop_id")
        .select([
          "props.id as prop_id",
          "props.user_id as prop_user_id",
          "props.competition_id",
        ])
        .where("resolutions.id", "=", id)
        .executeTakeFirst();
      if (!prop) {
        return error("Resolution not found", ERROR_CODES.NOT_FOUND);
      }
      const refusal = await resolveRefusal(trx, currentUser, prop, "unresolve");
      if (refusal) return refusal;

      const deleted = await trx
        .deleteFrom("resolutions")
        .where("id", "=", id)
        .executeTakeFirst();
      if (deleted.numDeletedRows === BigInt(0)) {
        return error("Resolution not found", ERROR_CODES.NOT_FOUND);
      }
      return success(undefined);
    });
    if (!result.success) return result;

    const duration = Date.now() - startTime;
    logger.info("Resolution deleted successfully", {
      operation: "deleteResolution",
      table: "resolutions",
      resolutionId: id,
      duration,
    });

    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to delete resolution", err as Error, {
      operation: "deleteResolution",
      table: "resolutions",
      resolutionId: id,
      duration,
    });
    return error("Failed to delete resolution", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function deleteProp({
  id,
}: {
  id: number;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Deleting prop", {
    propId: id,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    await withRLS(currentUser?.id, async (trx) => {
      await trx.deleteFrom("props").where("id", "=", id).execute();
    });

    const duration = Date.now() - startTime;
    logger.info("Prop deleted successfully", {
      operation: "deleteProp",
      table: "props",
      propId: id,
      duration,
    });

    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to delete prop", err as Error, {
      operation: "deleteProp",
      table: "props",
      propId: id,
      duration,
    });
    return error("Failed to delete prop", ERROR_CODES.DATABASE_ERROR);
  }
}
