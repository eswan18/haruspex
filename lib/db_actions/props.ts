"use server";
import { getUserFromCookies } from "../get-user";
import { revalidatePath } from "next/cache";
import {
  Competition,
  VProp,
  PropUpdate,
  NewProp,
  NewResolution,
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
import { attachOptions } from "@/lib/attach-options";
import { newPropAudience } from "@/lib/competition-status";
import { announcePropAdded } from "@/lib/notifications/prop-added";
import { isChoiceKind, isPropKind, type PropKind } from "@/lib/prop-kind";
import {
  validateChoiceOutcomes,
  validateOptionLabels,
  type OptionOutcome,
} from "@/lib/choice-forecast";

export async function getPropById(
  propId: number,
): Promise<
  ServerActionResult<(VProp & { options: PropOptionSummary[] }) | null>
> {
  const currentUser = await getUserFromCookies();

  logger.debug("Getting prop by ID", {
    propId,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    const result = await withRLS(currentUser?.id, async (trx) => {
      const prop = await trx
        .selectFrom("v_props")
        .selectAll()
        .where("prop_id", "=", propId)
        .executeTakeFirst();
      if (!prop) return null;
      const optionsByProp = await attachOptions(
        trx,
        [prop],
        currentUser?.id ?? null,
      );
      return { ...prop, options: optionsByProp.get(prop.prop_id) ?? [] };
    });

    const duration = Date.now() - startTime;
    logger.info(`Retrieved prop by ID`, {
      operation: "getPropById",
      table: "v_props",
      duration,
      propId,
      found: !!result,
    });

    return success(result);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Error getting prop by ID", err as Error, {
      operation: "getPropById",
      table: "v_props",
      duration,
      propId,
    });
    return error("Failed to fetch prop", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function getProps({
  competitionId,
  userId,
}: {
  competitionId?: (number | null)[] | number | null;
  userId?: (number | null)[] | number | null;
}): Promise<ServerActionResult<VProp[]>> {
  const currentUser = await getUserFromCookies();

  logger.debug("Getting props", {
    propCompetitionId: JSON.stringify(competitionId),
    propUserId: JSON.stringify(userId),
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    // Clients can pass a single user ID (or null) or a single competition ID (or null) or
    // an array of IDs.
    // Standardize the input to an array of IDs.
    let normalizedUserId: (number | null)[];
    if (typeof userId === "number") {
      normalizedUserId = [userId];
    } else if (userId === null) {
      normalizedUserId = [null];
    } else if (Array.isArray(userId)) {
      normalizedUserId = userId;
    } else {
      normalizedUserId = [];
    }

    let normalizedCompetitionId: (number | null)[];
    if (typeof competitionId === "number") {
      normalizedCompetitionId = [competitionId];
    } else if (competitionId === null) {
      normalizedCompetitionId = [null];
    } else if (Array.isArray(competitionId)) {
      normalizedCompetitionId = competitionId;
    } else {
      normalizedCompetitionId = [];
    }

    // Build and execute the query.
    const results = await withRLS(currentUser?.id, async (trx) => {
      let query = trx
        .selectFrom("v_props")
        .orderBy("prop_id", "asc")
        .selectAll();

      if (normalizedCompetitionId.length > 0) {
        // Add filters for competitions, if requested.
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
        // Add filters for users, if requested.
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

      return await query.execute();
    });

    const duration = Date.now() - startTime;
    logger.info(`Retrieved ${results.length} props`, {
      operation: "getProps",
      table: "v_props",
      propCompetitionId: JSON.stringify(competitionId),
      propUserId: JSON.stringify(userId),
      duration,
    });

    return success(results);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get props", err as Error, {
      operation: "getProps",
      table: "v_props",
      propCompetitionId: JSON.stringify(competitionId),
      propUserId: JSON.stringify(userId),
      duration,
    });
    return error("Failed to fetch props", ERROR_CODES.DATABASE_ERROR);
  }
}

/**
 * Records a prop's outcome.
 *
 * Yes/no props resolve with a single `resolution` and no `outcomes`; choice
 * props are the reverse, and their header row carries a null `resolution`
 * (an `enforce_resolution_kind` trigger insists on that) with one
 * `resolution_options` row per option. Header and children are written in the
 * same transaction, so a rejected resolution leaves nothing behind.
 */
export async function resolveProp({
  propId,
  resolution,
  outcomes,
  notes,
  overwrite = false,
}: {
  propId: number;
  /** Required for yes/no props, forbidden for choice ones. */
  resolution?: boolean;
  /** Required for choice props, forbidden for yes/no ones. */
  outcomes?: OptionOutcome[];
  notes?: string;
  overwrite?: boolean;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Resolving prop", {
    propId,
    resolution,
    outcomeCount: outcomes?.length,
    overwrite,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  // Captured inside the transaction so the success log can name the kind; the
  // `resolution` field is undefined for choice props.
  let resolvedKind: PropKind | undefined;
  try {
    const result = await withRLSAction(currentUser?.id, async (trx) => {
      const prop = await trx
        .selectFrom("v_props")
        .select("prop_kind")
        .where("prop_id", "=", propId)
        .executeTakeFirst();
      if (!prop) {
        return error("Proposition not found", ERROR_CODES.NOT_FOUND);
      }

      const kind = prop.prop_kind;
      resolvedKind = kind;
      const choice = isChoiceKind(kind);
      if (!choice && (resolution === undefined || outcomes !== undefined)) {
        return error(
          "Yes/no propositions resolve with a single true/false",
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      if (choice && (outcomes === undefined || resolution !== undefined)) {
        return error(
          "Choice propositions resolve with an outcome per option",
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (choice) {
        const options = await trx
          .selectFrom("prop_options")
          .select("id")
          .where("prop_id", "=", propId)
          .execute();
        const validationErrors = validateChoiceOutcomes(
          kind,
          options.map((o) => o.id),
          outcomes!,
        );
        if (validationErrors.length > 0) {
          logger.warn("Validation error resolving a choice prop", {
            propId,
            validationErrors,
          });
          return error(
            validationErrors.join("; "),
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      // Then check that this prop doesn't already have a resolution.
      const existingResolution = await trx
        .selectFrom("resolutions")
        .where("prop_id", "=", propId)
        .select(["id", "resolution"])
        .executeTakeFirst();
      if (!!existingResolution && !overwrite) {
        logger.warn("Attempted to resolve prop that already has resolution", {
          propId,
          existingResolution: existingResolution.resolution,
          overwrite,
        });
        return error(
          `Proposition ${propId} already has a resolution`,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Choice props hold their outcome in the child rows, not the header.
      const headerValue = choice ? null : resolution!;
      let resolutionId: number;
      if (existingResolution) {
        // Update the existing record.
        const updated = await trx
          .updateTable("resolutions")
          .set({ resolution: headerValue, notes })
          .where("prop_id", "=", propId)
          .returning("id")
          .executeTakeFirstOrThrow();
        resolutionId = updated.id;
        logger.debug("Updated existing resolution", { propId, kind });
      } else {
        // Insert a new record.
        const record: NewResolution = {
          prop_id: propId,
          resolution: headerValue,
          // Who resolved it comes from the session, never the request. This
          // is a server action, so a caller-supplied author could name anyone,
          // and the only caller never sent one.
          user_id: currentUser?.id ?? null,
          notes,
        };
        const inserted = await trx
          .insertInto("resolutions")
          .values(record)
          .returning("id")
          .executeTakeFirstOrThrow();
        resolutionId = inserted.id;
        logger.debug("Created new resolution", { propId, kind });
      }

      if (choice) {
        // Overwriting replaces the whole set, so clear it before reinserting.
        await trx
          .deleteFrom("resolution_options")
          .where("resolution_id", "=", resolutionId)
          .execute();
        await trx
          .insertInto("resolution_options")
          .values(
            outcomes!.map((o) => ({
              resolution_id: resolutionId,
              prop_id: propId,
              option_id: o.optionId,
              outcome: o.outcome,
            })),
          )
          .execute();
      }

      return success(undefined);
    });

    if (result.success) {
      const duration = Date.now() - startTime;
      logger.info("Prop resolved successfully", {
        operation: "resolveProp",
        table: "resolutions",
        propId,
        kind: resolvedKind,
        resolution,
        outcomeCount: outcomes?.length,
        duration,
      });
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to resolve prop", err as Error, {
      operation: "resolveProp",
      table: "resolutions",
      propId,
      duration,
    });
    return error("Failed to resolve prop", ERROR_CODES.DATABASE_ERROR);
  }
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
    await withRLS(currentUser?.id, async (trx) => {
      await trx
        .deleteFrom("resolutions")
        .where("prop_id", "=", propId)
        .execute();
    });

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

export async function createProp({
  prop,
  options,
  notifyMembers = false,
}: {
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
  logger.debug("Creating prop", {
    categoryId: prop.category_id,
    textLength: prop.text?.length,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      logger.warn("Unauthorized attempt to create prop");
      return error(
        "You must be logged in to create propositions",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Validate prop data
    const validationErrors: Record<string, string[]> = {};

    if (!prop.text || prop.text.trim().length < 8) {
      validationErrors.text = [
        "Proposition text must be at least 8 characters long",
      ];
    }

    // Category is required for non-personal, non-competition props
    if (
      prop.category_id == null &&
      prop.user_id === null &&
      prop.competition_id === null
    ) {
      validationErrors.category_id = ["Category is required"];
    }

    // Validate dates for props with deadlines (private competition props)
    if (prop.forecasts_due_date && prop.resolution_due_date) {
      const now = new Date();
      if (prop.forecasts_due_date <= now) {
        validationErrors.forecasts_due_date = [
          "Forecast deadline must be in the future",
        ];
      }
      if (prop.resolution_due_date <= now) {
        validationErrors.resolution_due_date = [
          "Resolution deadline must be in the future",
        ];
      }
      if (prop.resolution_due_date <= prop.forecasts_due_date) {
        validationErrors.resolution_due_date =
          validationErrors.resolution_due_date || [];
        validationErrors.resolution_due_date.push(
          "Resolution deadline must be after forecast deadline",
        );
      }
    }

    // Options are required for choice props and forbidden for binary ones.
    const kind: PropKind = prop.kind ?? "binary";
    const trimmedOptions = (options ?? []).map((o) => o.trim());
    if (prop.kind !== undefined && !isPropKind(prop.kind)) {
      // A kind the app does not know about: the CHECK constraint would reject
      // it anyway, and the option rules below have no meaning for it, so stop
      // here rather than validating options against a guessed kind.
      validationErrors.kind = ["Unknown proposition type"];
    } else if (isChoiceKind(kind)) {
      const optionErrors = validateOptionLabels(trimmedOptions);
      if (optionErrors.length > 0) {
        validationErrors.options = optionErrors;
      }
    } else if (trimmedOptions.length > 0) {
      validationErrors.options = ["Yes/no propositions do not have options"];
    }

    if (Object.keys(validationErrors).length > 0) {
      logger.warn("Validation error creating prop", {
        validationErrors,
        textLength: prop.text?.length,
        categoryId: prop.category_id,
      });
      return validationError(
        "Please fix the validation errors",
        validationErrors,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await withRLSAction(currentUser?.id, async (trx) => {
      // Read here for the permission checks, and handed back so the
      // announcement after commit knows who to tell.
      let competition:
        | Pick<
            Competition,
            | "name"
            | "is_private"
            | "forecasts_open_date"
            | "forecasts_close_date"
            | "end_date"
          >
        | undefined;

      // For competition props, verify the user is a competition admin
      if (prop.competition_id) {
        competition = await trx
          .selectFrom("competitions")
          .select([
            "name",
            "is_private",
            "forecasts_open_date",
            "forecasts_close_date",
            "end_date",
          ])
          .where("id", "=", prop.competition_id)
          .executeTakeFirst();

        if (!competition) {
          return error("Competition not found", ERROR_CODES.NOT_FOUND);
        }

        // Public competition props must have a category
        if (!competition.is_private && prop.category_id == null) {
          return validationError(
            "Please fix the validation errors",
            {
              category_id: [
                "Category is required for public competition props",
              ],
            },
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        // For private competitions, only admins can create props
        if (competition.is_private) {
          const membership = await trx
            .selectFrom("competition_members")
            .select(["role"])
            .where("competition_id", "=", prop.competition_id)
            .where("user_id", "=", currentUser.id)
            .executeTakeFirst();

          if (membership?.role !== "admin") {
            return error(
              "Only competition admins can create props",
              ERROR_CODES.UNAUTHORIZED,
            );
          }
        }
      }

      const { id: propId } = await trx
        .insertInto("props")
        .values(prop)
        .returning("id")
        .executeTakeFirstOrThrow();
      if (isChoiceKind(kind)) {
        await trx
          .insertInto("prop_options")
          .values(
            trimmedOptions.map((text, position) => ({
              prop_id: propId,
              text,
              position,
            })),
          )
          .execute();
      }
      return success({ propId, competition });
    });

    if (!result.success) {
      return result;
    }

    const duration = Date.now() - startTime;
    logger.info("Prop created successfully", {
      operation: "createProp",
      table: "props",
      kind,
      optionCount: trimmedOptions.length,
      categoryId: prop.category_id,
      textLength: prop.text?.length,
      duration,
    });

    const { propId, competition } = result.data;
    if (prop.competition_id) {
      revalidatePath(`/competitions/${prop.competition_id}`);

      const audience =
        notifyMembers && competition ? newPropAudience(competition) : null;
      if (competition && audience) {
        // Fire-and-forget, after commit: announcePropAdded never throws, and
        // the prop stands whether or not the mail goes out.
        void announcePropAdded({
          authorId: currentUser.id,
          audience,
          competition: { id: prop.competition_id, name: competition.name },
          prop: {
            id: propId,
            text: prop.text,
            forecasts_due_date: prop.forecasts_due_date ?? null,
          },
        });
      }
    }

    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to create prop", err as Error, {
      operation: "createProp",
      table: "props",
      categoryId: prop.category_id,
      competitionId: prop.competition_id,
      duration,
    });

    const errorMessage = (err as Error).message;
    if (errorMessage.includes("duplicate")) {
      return error(
        "A proposition with this text already exists",
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return error("Failed to create proposition", ERROR_CODES.DATABASE_ERROR);
  }
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
    await withRLS(currentUser?.id, async (trx) => {
      await trx.deleteFrom("resolutions").where("id", "=", id).execute();
    });

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
