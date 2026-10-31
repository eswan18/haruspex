"use server";

import { loadAdminStats, type AdminStats } from "@/lib/admin-stats";
import { withRLS } from "@/lib/db-helpers";
import { getUserFromCookies } from "@/lib/get-user";
import { logger } from "@/lib/logger";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

/** The admin Stats page's numbers, for an admin. */
export async function getAdminStats(): Promise<ServerActionResult<AdminStats>> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    return error("You must be logged in to see stats", ERROR_CODES.UNAUTHORIZED);
  }
  // The /admin layout already blocks non-admins from the page, but a server
  // action is reachable without it.
  if (!currentUser.is_admin) {
    logger.warn("Non-admin attempt to read admin stats", {
      userId: currentUser.id,
    });
    return error("Only admins can see stats", ERROR_CODES.UNAUTHORIZED);
  }

  const startTime = Date.now();
  try {
    const stats = await withRLS(currentUser.id, (trx) => loadAdminStats(trx));
    logger.debug("Admin stats loaded", {
      userId: currentUser.id,
      duration: Date.now() - startTime,
    });
    return success(stats);
  } catch (err) {
    logger.error("Failed to load admin stats", err as Error, {
      userId: currentUser.id,
      duration: Date.now() - startTime,
    });
    return error("Failed to load stats", ERROR_CODES.DATABASE_ERROR);
  }
}
