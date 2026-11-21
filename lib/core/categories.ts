import "server-only";

import { db } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { Category, VUser } from "@/types/db_types";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

/**
 * Categories are readable by anyone; whether to serve an anonymous caller is
 * the entry point's call (the server action requires a login).
 */
export async function listCategories(
  caller: VUser | null,
): Promise<ServerActionResult<Category[]>> {
  logger.debug("Getting categories", { currentUserId: caller?.id });

  const startTime = Date.now();
  try {
    const results = await db.selectFrom("categories").selectAll().execute();

    logger.debug(`Retrieved ${results.length} categories`, {
      operation: "listCategories",
      table: "categories",
      duration: Date.now() - startTime,
    });

    return success(results);
  } catch (err) {
    logger.error("Failed to get categories", err as Error, {
      operation: "listCategories",
      table: "categories",
      duration: Date.now() - startTime,
    });
    return error("Failed to fetch categories", ERROR_CODES.DATABASE_ERROR);
  }
}
