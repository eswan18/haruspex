"use server";
import { Category } from "@/types/db_types";
import { getUserFromCookies } from "../get-user";
import { listCategories } from "@/lib/core/categories";
import { logger } from "@/lib/logger";
import {
  ServerActionResult,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

export async function getCategories(): Promise<ServerActionResult<Category[]>> {
  const currentUser = await getUserFromCookies();
  if (!currentUser) {
    logger.warn("Unauthorized attempt to get categories");
    return error(
      "You must be logged in to view categories",
      ERROR_CODES.UNAUTHORIZED,
    );
  }
  return listCategories(currentUser);
}
