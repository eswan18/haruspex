"use server";
import { logger } from "@/lib/logger";
import { getUserFromCookies } from "@/lib/get-user";
import { sql } from "kysely";
import {
  ServerActionResult,
  success,
  error,
  ERROR_CODES,
} from "@/lib/server-action-result";
import { withRLS } from "@/lib/db-helpers";
import { attachOptions } from "@/lib/attach-options";
import type { PropKind } from "@/lib/prop-kind";

export interface UserScore {
  userId: number;
  userName: string;
  score: number;
}

export interface UserCategoryScore {
  userId: number;
  userName: string;
  categoryId: number;
  score: number;
}

export interface CompetitionScore {
  overallScores: UserScore[];
  categoryScores: UserCategoryScore[];
  incompleteUserIds: number[];
}

export interface UserForecastScore {
  forecastId: number;
  propId: number;
  propText: string;
  categoryId: number | null;
  categoryName: string | null;
  kind: PropKind;
  /** Set for binary props, null for choice props (per-option values instead). */
  forecast: number | null;
  /** Set for binary props, null for choice props (per-option outcomes instead). */
  resolution: boolean | null;
  score: number | null;
  /** Empty for binary props; one entry per option, by position, for choice props. */
  options: { text: string; userForecast: number; outcome: boolean }[];
}

export interface UserScoreBreakdown {
  userId: number;
  userName: string;
  overallScore: number;
  categoryScores: UserCategoryScore[];
  forecastScores: UserForecastScore[];
}

export async function getCompetitionScores({
  competitionId,
  excludeIncomplete = false,
}: {
  competitionId: number;
  excludeIncomplete?: boolean;
}): Promise<ServerActionResult<CompetitionScore>> {
  // Scores are computed as the mean of the squared differences between the forecast and the resolution.
  const currentUser = await getUserFromCookies();
  logger.debug("Getting competition scores", {
    competitionId,
    currentUserId: currentUser?.id,
  });
  const startTime = Date.now();

  try {
    if (!currentUser) {
      logger.warn("Unauthorized attempt to get competition scores");
      return error(
        "You must be logged in to view competition scores",
        ERROR_CODES.UNAUTHORIZED,
      );
    }
    const results = await withRLS(currentUser?.id, async (trx) => {
      // Execute both queries in parallel for better performance
      const [overallResults, categoryResults] = await Promise.all([
        // Get overall scores (averaged by user across all categories)
        trx
          .selectFrom("v_forecasts")
          .select(["user_id", "user_name", sql`AVG(score)`.as("average_score")])
          .where("competition_id", "=", competitionId)
          .where("score", "is not", null)
          .groupBy(["user_id", "user_name"])
          .execute(),

        // Get category scores (averaged by user per category)
        trx
          .selectFrom("v_forecasts")
          .select([
            "user_id",
            "user_name",
            "category_id",
            sql`AVG(score)`.as("average_score"),
          ])
          .where("competition_id", "=", competitionId)
          .where("score", "is not", null)
          .where("category_id", "is not", null)
          .groupBy(["user_id", "user_name", "category_id"])
          .execute(),
      ]);

      // Compute which users have forecasted on every prop in the competition.
      // A voided prop counts on neither side: skipping one leaves nothing to
      // score, and forecasting one does not make up for a prop skipped.
      const [totalPropsResult, userForecastCounts] = await Promise.all([
        trx
          .selectFrom("v_props")
          .select(sql`COUNT(*)`.as("count"))
          .where("competition_id", "=", competitionId)
          .where("resolution_voided", "is not", true)
          .executeTakeFirstOrThrow(),
        trx
          .selectFrom("v_forecasts")
          .select(["user_id", sql`COUNT(DISTINCT prop_id)`.as("count")])
          .where("competition_id", "=", competitionId)
          .where("resolution_voided", "is not", true)
          .groupBy("user_id")
          .execute(),
      ]);
      const totalProps = Number(totalPropsResult.count);
      const completeUserIds = new Set(
        userForecastCounts
          .filter((row) => Number(row.count) >= totalProps)
          .map((row) => row.user_id),
      );
      // All user IDs that appear in scores but aren't complete
      const allScoredUserIds = new Set(
        overallResults.map((row) => row.user_id),
      );
      const incompleteUserIds = [...allScoredUserIds].filter(
        (id) => !completeUserIds.has(id),
      );

      return { overallResults, categoryResults, completeUserIds, incompleteUserIds };
    });

    const duration = Date.now() - startTime;
    logger.debug("Retrieved aggregated scores from database", {
      operation: "getCompetitionScores",
      table: "v_forecasts",
      duration,
      competitionId,
      currentUserId: currentUser?.id,
      overallCount: results.overallResults.length,
      categoryCount: results.categoryResults.length,
    });

    // Transform results into the expected array format, filtering out
    // incomplete users if requested.
    const { completeUserIds } = results;
    const includeUser = (userId: number) =>
      !excludeIncomplete || completeUserIds.has(userId);

    const overallScores: UserScore[] = results.overallResults
      .filter((row) => includeUser(row.user_id))
      .map((row) => ({
        userId: row.user_id,
        userName: row.user_name,
        score: Number(row.average_score),
      }));

    const categoryScores: UserCategoryScore[] = results.categoryResults
      .filter((row) => includeUser(row.user_id))
      .map((row) => ({
        userId: row.user_id,
        userName: row.user_name,
        categoryId: row.category_id!,
        score: Number(row.average_score),
      }));

    logger.info("Competition scores calculated successfully", {
      operation: "getCompetitionScores",
      competitionId,
      currentUserId: currentUser?.id,
      userCount: overallScores.length,
      categoryCount: categoryScores.length,
      duration: Date.now() - startTime,
    });

    return success({
      overallScores,
      categoryScores,
      incompleteUserIds: results.incompleteUserIds,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get competition scores", err as Error, {
      operation: "getCompetitionScores",
      table: "v_forecasts",
      duration,
      competitionId,
      currentUserId: currentUser?.id,
    });
    return error(
      "Failed to retrieve competition scores",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}

export async function getUserScoreBreakdown({
  competitionId,
  userId,
}: {
  competitionId: number;
  userId: number;
}): Promise<ServerActionResult<UserScoreBreakdown>> {
  const currentUser = await getUserFromCookies();
  logger.debug("Getting user score breakdown", {
    competitionId,
    userId,
    currentUserId: currentUser?.id,
  });
  const startTime = Date.now();

  try {
    if (!currentUser) {
      logger.warn("Unauthorized attempt to get user score breakdown");
      return error(
        "You must be logged in to view user scores",
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const results = await withRLS(currentUser?.id, async (trx) => {
      // Get user info and overall score
      const [userInfo] = await trx
        .selectFrom("v_forecasts")
        .select(["user_id", "user_name", sql`AVG(score)`.as("average_score")])
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .where("score", "is not", null)
        .groupBy(["user_id", "user_name"])
        .execute();

      if (!userInfo) {
        return null;
      }

      // Get category scores
      const categoryResults = await trx
        .selectFrom("v_forecasts")
        .select([
          "user_id",
          "user_name",
          "category_id",
          sql`AVG(score)`.as("average_score"),
        ])
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .where("score", "is not", null)
        .where("category_id", "is not", null)
        .groupBy(["user_id", "user_name", "category_id"])
        .execute();

      // Get individual forecast scores
      const forecastResults = await trx
        .selectFrom("v_forecasts")
        .select([
          "forecast_id",
          "prop_id",
          "prop_text",
          "prop_kind",
          "category_id",
          "category_name",
          "forecast",
          "resolution",
          "score",
        ])
        .where("competition_id", "=", competitionId)
        .where("user_id", "=", userId)
        .where("score", "is not", null)
        .orderBy("category_id", "asc")
        .orderBy("prop_id", "asc")
        .execute();

      // Option summaries for the choice props among them, for this user.
      const optionsByProp = await attachOptions(trx, forecastResults, userId);

      return {
        userInfo,
        categoryResults,
        forecastResults,
        optionsByProp,
      };
    });

    if (!results || !results.userInfo) {
      return error(
        "User not found or has no scores for this competition",
        ERROR_CODES.NOT_FOUND,
      );
    }

    const duration = Date.now() - startTime;
    logger.debug("Retrieved user score breakdown from database", {
      operation: "getUserScoreBreakdown",
      table: "v_forecasts",
      duration,
      competitionId,
      userId,
      currentUserId: currentUser?.id,
      forecastCount: results.forecastResults.length,
    });

    const categoryScores: UserCategoryScore[] = results.categoryResults.map(
      (row) => ({
        userId: row.user_id,
        userName: row.user_name,
        categoryId: row.category_id!,
        score: Number(row.average_score),
      }),
    );

    const forecastScores: UserForecastScore[] = results.forecastResults.map(
      (row) => ({
        forecastId: row.forecast_id,
        propId: row.prop_id,
        propText: row.prop_text,
        categoryId: row.category_id,
        categoryName: row.category_name,
        kind: row.prop_kind,
        forecast: row.forecast !== null ? Number(row.forecast) : null,
        resolution: row.resolution,
        score: row.score !== null ? Number(row.score) : null,
        // Scored rows are resolved and forecasted, so every option of a choice
        // prop has both a probability and an outcome.
        options: (results.optionsByProp.get(row.prop_id) ?? []).map((o) => ({
          text: o.text,
          userForecast: o.user_forecast ?? 0,
          outcome: o.outcome ?? false,
        })),
      }),
    );

    logger.info("User score breakdown calculated successfully", {
      operation: "getUserScoreBreakdown",
      competitionId,
      userId,
      currentUserId: currentUser?.id,
      forecastCount: forecastScores.length,
      duration: Date.now() - startTime,
    });

    return success({
      userId: results.userInfo.user_id,
      userName: results.userInfo.user_name,
      overallScore: Number(results.userInfo.average_score),
      categoryScores,
      forecastScores,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Failed to get user score breakdown", err as Error, {
      operation: "getUserScoreBreakdown",
      table: "v_forecasts",
      duration,
      competitionId,
      userId,
      currentUserId: currentUser?.id,
    });
    return error(
      "Failed to retrieve user score breakdown",
      ERROR_CODES.DATABASE_ERROR,
    );
  }
}
