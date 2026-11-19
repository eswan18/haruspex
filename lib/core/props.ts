import "server-only";

import type { ExpressionBuilder, Transaction } from "kysely";
import { revalidatePath } from "next/cache";
import { withRLS, withRLSAction } from "@/lib/db-helpers";
import { featureEnabled } from "./feature-flags";
import { newPropAudience } from "@/lib/competition-status";
import { announcePropAdded } from "@/lib/notifications/prop-added";
import { isChoiceKind, isPropKind, type PropKind } from "@/lib/prop-kind";
import { canCreateProps, canResolveProp } from "@/lib/prop-write-access";
import {
  validateChoiceOutcomes,
  validateOptionLabels,
  type OptionOutcome,
} from "@/lib/choice-forecast";
import { attachOptions } from "@/lib/attach-options";
import { logger } from "@/lib/logger";
import type {
  Competition,
  Database,
  NewProp,
  NewResolution,
  PropOptionSummary,
  VProp,
  VUser,
} from "@/types/db_types";
import {
  ServerActionResult,
  success,
  error,
  validationError,
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

/**
 * Why `user` may not resolve, unresolve or delete a resolution of `prop`, as
 * the error to return, or null if they may (`canResolveProp`).
 *
 * The manage_resolutions policy refuses the write regardless. Asking first
 * turns that into a reason: a refused insert would surface as a database
 * error, and a refused delete as a silent success, since RLS just filters the
 * rows out.
 *
 * Exported for the unresolve actions; this is not a "use server" file, so it
 * is not callable from the browser.
 */
export async function resolveRefusal(
  trx: Transaction<Database>,
  user: VUser,
  prop: {
    prop_id?: number;
    prop_user_id: number | null;
    competition_id: number | null;
  },
  verb: "resolve" | "unresolve",
): Promise<ServerActionResult<never> | null> {
  const membership =
    prop.competition_id === null
      ? undefined
      : await trx
          .selectFrom("competition_members")
          .select("role")
          .where("competition_id", "=", prop.competition_id)
          .where("user_id", "=", user.id)
          .executeTakeFirst();
  if (
    canResolveProp({
      userId: user.id,
      ownerId: prop.prop_user_id,
      role: membership?.role ?? null,
      isSiteAdmin: user.is_admin,
    })
  ) {
    return null;
  }
  logger.warn(`Unauthorized attempt to ${verb} prop`, {
    propId: prop.prop_id,
    currentUserId: user.id,
  });
  return error(
    `Only the prop's owner, a competition admin or a site admin can ${verb} it`,
    ERROR_CODES.UNAUTHORIZED,
  );
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
export async function resolveProp(
  currentUser: VUser,
  {
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
  },
): Promise<ServerActionResult<void>> {
  logger.debug("Resolving prop", {
    propId,
    resolution,
    outcomeCount: outcomes?.length,
    overwrite,
    currentUserId: currentUser.id,
  });

  const startTime = Date.now();
  // Captured inside the transaction so the success log can name the kind; the
  // `resolution` field is undefined for choice props.
  let resolvedKind: PropKind | undefined;
  try {
    const result = await withRLSAction(currentUser.id, async (trx) => {
      const prop = await trx
        .selectFrom("v_props")
        .select(["prop_id", "prop_kind", "prop_user_id", "competition_id"])
        .where("prop_id", "=", propId)
        .executeTakeFirst();
      if (!prop) {
        return error("Proposition not found", ERROR_CODES.NOT_FOUND);
      }

      const refusal = await resolveRefusal(trx, currentUser, prop, "resolve");
      if (refusal) return refusal;

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
          user_id: currentUser.id,
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

export async function createProp(
  currentUser: VUser,
  {
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
  },
): Promise<ServerActionResult<{ propId: number }>> {
  logger.debug("Creating prop", {
    categoryId: prop.category_id,
    textLength: prop.text?.length,
    currentUserId: currentUser.id,
  });

  const startTime = Date.now();
  try {
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

    // A personal prop is the caller's own, and the flag gates the feature.
    if (prop.user_id != null) {
      if (
        prop.user_id !== currentUser.id ||
        !(await featureEnabled(currentUser.id, "personal-props"))
      ) {
        logger.warn("Unauthorized attempt to create a personal prop", {
          currentUserId: currentUser.id,
        });
        return error(
          "You cannot create personal propositions",
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }

    const result = await withRLSAction(currentUser.id, async (trx) => {
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

        // Who may add to a competition: its admins if private, a site admin
        // if public.
        const membership = await trx
          .selectFrom("competition_members")
          .select(["role"])
          .where("competition_id", "=", prop.competition_id)
          .where("user_id", "=", currentUser.id)
          .executeTakeFirst();
        if (
          !canCreateProps({
            isPrivate: competition.is_private,
            role: membership?.role ?? null,
            isSiteAdmin: currentUser.is_admin,
          })
        ) {
          return error(
            "Only competition admins can create props",
            ERROR_CODES.UNAUTHORIZED,
          );
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

    return success({ propId });
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
