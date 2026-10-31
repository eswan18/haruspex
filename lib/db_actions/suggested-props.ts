"use server";

import { SuggestedPropStatus, VSuggestedProp } from "@/types/db_types";
import { getUserFromCookies } from "@/lib/get-user";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import {
  ServerActionResult,
  ServerActionResultWithValidation,
  success,
  error,
  validationError,
  ERROR_CODES,
} from "@/lib/server-action-result";
import { withRLS } from "@/lib/db-helpers";
import { checkSuggestion } from "@/lib/suggested-prop";

export async function getSuggestedProps(): Promise<
  ServerActionResult<VSuggestedProp[]>
> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting suggested props", {
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to get suggested props", {
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can view suggested props",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const results = await withRLS(currentUser.id, async (trx) => {
      return await trx.selectFrom("v_suggested_props").selectAll().execute();
    });

    const duration = Date.now() - startTime;
    logger.info(`Retrieved ${results.length} suggested props`, {
      operation: "getSuggestedProps",
      table: "v_suggested_props",
      duration,
    });

    return success(results);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get suggested props", err as Error, {
      operation: "getSuggestedProps",
      table: "v_suggested_props",
      duration,
    });
    return error(
      "Failed to retrieve suggested props",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

/**
 * One suggestion, for seeding the new-prop form from an accepted one.
 *
 * Admin-only, like the list it comes from: the caller has the id in a URL,
 * which is not authority to read the row.
 */
export async function getSuggestedPropById({
  id,
}: {
  id: number;
}): Promise<ServerActionResult<VSuggestedProp | null>> {
  const currentUser = await getUserFromCookies();

  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to read a suggested prop", {
        suggestedPropId: id,
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can view suggested props",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const row = await withRLS(currentUser.id, async (trx) => {
      return trx
        .selectFrom("v_suggested_props")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    });

    return success(row ?? null);
  } catch (err) {
    logger.error("Failed to get suggested prop", err as Error, {
      operation: "getSuggestedPropById",
      table: "v_suggested_props",
      suggestedPropId: id,
    });
    return error(
      "Failed to retrieve the suggestion",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

/**
 * A reader's suggestion. Only the text crosses from the client: who suggested
 * it comes from the session, and a suggestion always starts undecided.
 *
 * No RETURNING on the insert. Under RLS a returned row must also pass the
 * table's SELECT policies, which are admin-only, so for every reader it failed
 * with "new row violates row-level security policy" -- and nothing here needs
 * the id.
 */
export async function createSuggestedProp({
  prop,
  notes,
}: {
  prop: string;
  notes: string | null;
}): Promise<ServerActionResultWithValidation<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Creating suggested prop", {
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser) {
      logger.warn("Unauthorized attempt to create suggested prop");
      return error("You must be logged in", ERROR_CODES.UNAUTHORIZED);
    }

    const checked = checkSuggestion({ prop, notes });
    if (!checked.ok) {
      return validationError(
        checked.error,
        { [checked.field]: [checked.error] },
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    await withRLS(currentUser.id, async (trx) => {
      await trx
        .insertInto("suggested_props")
        .values({
          prop: checked.prop,
          notes: checked.notes,
          suggester_user_id: currentUser.id,
        })
        .execute();
    });

    const duration = Date.now() - startTime;
    logger.info("Suggested prop created successfully", {
      operation: "createSuggestedProp",
      table: "suggested_props",
      suggesterUserId: currentUser.id,
      duration,
    });

    revalidatePath("/admin/suggested-props");
    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to create suggested prop", err as Error, {
      operation: "createSuggestedProp",
      table: "suggested_props",
      suggesterUserId: currentUser?.id,
      duration,
    });
    return error("Failed to create suggested prop", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function setSuggestedPropStatus({
  id,
  status,
}: {
  id: number;
  /** Null reopens it: back to pending, with the decision cleared. */
  status: SuggestedPropStatus | null;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Setting suggested prop status", {
    suggestedPropId: id,
    status,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to set suggested prop status", {
        suggestedPropId: id,
        status,
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can review suggested props",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    await withRLS(currentUser.id, async (trx) => {
      await trx
        .updateTable("suggested_props")
        .set({
          status,
          // Who decided comes from the session, never the request -- the same
          // rule resolutions follow. Clearing the status clears both, which is
          // what suggested_props_decision_check insists on.
          decided_by: status === null ? null : currentUser.id,
          decided_at: status === null ? null : new Date(),
        })
        .where("id", "=", id)
        .execute();
    });

    const duration = Date.now() - startTime;
    logger.info("Suggested prop status set successfully", {
      operation: "setSuggestedPropStatus",
      table: "suggested_props",
      suggestedPropId: id,
      status,
      duration,
    });

    revalidatePath("/admin/suggested-props");
    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to set suggested prop status", err as Error, {
      operation: "setSuggestedPropStatus",
      table: "suggested_props",
      suggestedPropId: id,
      status,
      duration,
    });
    return error("Failed to update the suggestion", ERROR_CODES.DATABASE_ERROR);
  }
}
