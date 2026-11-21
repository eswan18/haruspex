import "server-only";

import { withRLS } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";
import type { VSuggestedProp, VUser } from "@/types/db_types";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

/**
 * Every suggestion, for a site admin: the review queue and its history.
 *
 * The admin check lives here, not only at the entry points, so the admin page
 * and an agent cannot disagree about who may read the queue.
 */
export async function listSuggestedProps(
  caller: VUser | null,
): Promise<ServerActionResult<VSuggestedProp[]>> {
  logger.debug("Getting suggested props", { currentUserId: caller?.id });

  const startTime = Date.now();
  try {
    if (!caller?.is_admin) {
      logger.warn("Unauthorized attempt to get suggested props", {
        currentUserId: caller?.id,
      });
      return error(
        "Only admins can view suggested props",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const results = await withRLS(caller.id, async (trx) => {
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
