"use server";

import { db } from "@/lib/database";
import { featureEnabled } from "@/lib/core/feature-flags";
import { getUserFromCookies } from "../get-user";
import { NewFeatureFlag, VFeatureFlag } from "@/types/db_types";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";

export async function hasFeatureEnabled({
  featureName,
  userId,
}: {
  featureName: string;
  userId: number;
}): Promise<ServerActionResult<boolean>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Checking feature flag", {
    featureName,
    userId,
    currentUserId: currentUser?.id,
  });

  // Make sure the user is who they say they are.
  if (!currentUser || currentUser.id !== userId) {
    logger.warn("Unauthorized feature flag check", {
      featureName,
      userId,
      currentUserId: currentUser?.id,
    });
    return error("Unauthorized", ERROR_CODES.UNAUTHORIZED);
  }

  try {
    return success(await featureEnabled(userId, featureName));
  } catch (err) {
    logger.error("Failed to check feature flag", err as Error, {
      operation: "hasFeatureEnabled",
      table: "feature_flags",
      featureName,
      userId,
    });
    return error("Failed to check feature flag", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function getFeatureFlags(): Promise<
  ServerActionResult<VFeatureFlag[]>
> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting feature flags", {
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    // Only allow admins to view all feature flags.
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to get feature flags", {
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can get all feature flags",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const results = await db
      .selectFrom("v_feature_flags")
      .selectAll()
      .execute();

    const duration = Date.now() - startTime;
    logger.info(`Retrieved ${results.length} feature flags`, {
      operation: "getFeatureFlags",
      table: "v_feature_flags",
      duration,
    });

    return success(results);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get feature flags", err as Error, {
      operation: "getFeatureFlags",
      table: "v_feature_flags",
      duration,
    });
    return error(
      "Failed to retrieve feature flags",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

export async function createFeatureFlag({
  featureFlag,
}: {
  featureFlag: NewFeatureFlag;
}): Promise<ServerActionResult<number>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Creating feature flag", {
    featureName: featureFlag.name,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to create feature flag", {
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can create feature flags",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const { id } = await db
      .insertInto("feature_flags")
      .values(featureFlag)
      .returning("id")
      .executeTakeFirstOrThrow();

    const duration = Date.now() - startTime;
    logger.info("Feature flag created successfully", {
      operation: "createFeatureFlag",
      table: "feature_flags",
      featureFlagId: id,
      featureName: featureFlag.name,
      duration,
    });

    revalidatePath("/admin/feature-flags");
    return success(id);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to create feature flag", err as Error, {
      operation: "createFeatureFlag",
      table: "feature_flags",
      featureName: featureFlag.name,
      duration,
    });
    return error("Failed to create feature flag", ERROR_CODES.DATABASE_ERROR);
  }
}

export async function updateFeatureFlag({
  id,
  enabled,
}: {
  id: number;
  enabled: boolean;
}): Promise<ServerActionResult<void>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Updating feature flag", {
    featureFlagId: id,
    enabled,
    currentUserId: currentUser?.id,
  });

  const startTime = Date.now();
  try {
    if (!currentUser?.is_admin) {
      logger.warn("Unauthorized attempt to update feature flag", {
        featureFlagId: id,
        currentUserId: currentUser?.id,
      });
      return error(
        "Only admins can update feature flags",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    await db
      .updateTable("feature_flags")
      .set("enabled", enabled)
      .where("id", "=", id)
      .execute();

    const duration = Date.now() - startTime;
    logger.info("Feature flag updated successfully", {
      operation: "updateFeatureFlag",
      table: "feature_flags",
      featureFlagId: id,
      enabled,
      duration,
    });

    revalidatePath("/admin/feature-flags");
    return success(undefined);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to update feature flag", err as Error, {
      operation: "updateFeatureFlag",
      table: "feature_flags",
      featureFlagId: id,
      duration,
    });
    return error("Failed to update feature flag", ERROR_CODES.DATABASE_ERROR);
  }
}
