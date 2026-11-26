import { vi, describe, expect, beforeEach } from "vitest";
import { getTestDb } from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import {
  shouldRunContainerTests,
  ifRunningContainerTestsIt,
} from "../../tests/helpers/testUtils";

let getCompetitionScores: typeof import("./competition-scores").getCompetitionScores;
let getUserScoreBreakdown: typeof import("./competition-scores").getUserScoreBreakdown;

// `competition-scores.ts` transitively imports the server-only `attachOptions` helper.
vi.mock("server-only", () => ({}));

// Mock getUserFromCookies
vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

import { getUserFromCookies } from "@/lib/get-user";

describe("getCompetitionScores", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      // Import the actual function for testing
      const competitionScoresModule = await import("./competition-scores");
      getCompetitionScores = competitionScoresModule.getCompetitionScores;
      getUserScoreBreakdown = competitionScoresModule.getUserScoreBreakdown;
    } else {
      vi.clearAllMocks();
    }
  });

  describe("authentication", () => {
    ifRunningContainerTestsIt(
      "should return error when user is not authenticated",
      async () => {
        vi.mocked(getUserFromCookies).mockResolvedValue(null);

        const result = await getCompetitionScores({ competitionId: 1 });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe(
            "You must be logged in to view competition scores",
          );
          expect(result.code).toBe("UNAUTHORIZED");
        }
      },
    );
  });

  describe("data aggregation", () => {
    ifRunningContainerTestsIt(
      "should return empty scores for competition with no forecasts",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);

        const competition = await factory.createCompetition();

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.overallScores).toEqual([]);
          expect(result.data.categoryScores).toEqual([]);
          expect(result.data.incompleteUserIds).toEqual([]);
        }
      },
    );

    ifRunningContainerTestsIt(
      "should aggregate scores correctly for multiple users and categories",
      async () => {
        const user1 = await factory.createUser({ name: "User One" });
        const user2 = await factory.createUser({ name: "User Two" });
        vi.mocked(getUserFromCookies).mockResolvedValue(user1);

        const competition = await factory.createCompetition();

        // Create categories
        const politicsCategory = await factory.createCategory({
          name: "Politics",
        });

        const economicsCategory = await factory.createCategory({
          name: "Economics",
        });

        // Create props in different categories
        const prop1 = await factory.createCompetitionProp(competition.id, {
          category_id: politicsCategory.id,
          text: "Biden will win 2024",
        });

        const prop2 = await factory.createCompetitionProp(competition.id, {
          category_id: economicsCategory.id,
          text: "Inflation will drop 2%",
        });

        const prop3 = await factory.createCompetitionProp(competition.id, {
          category_id: politicsCategory.id,
          text: "Democrats will keep the Senate",
        });

        // Create forecasts with different probabilities
        await factory.createForecast(user1.id, prop1.id, { forecast: 0.7 }); // user1 prediction: 70%
        await factory.createForecast(user1.id, prop2.id, { forecast: 0.4 }); // user1 prediction: 40%
        await factory.createForecast(user1.id, prop3.id, { forecast: 0.6 }); // user1 prediction: 60%

        await factory.createForecast(user2.id, prop1.id, { forecast: 0.8 }); // user2 prediction: 80%
        await factory.createForecast(user2.id, prop2.id, { forecast: 0.3 }); // user2 prediction: 30%
        await factory.createForecast(user2.id, prop3.id, { forecast: 0.5 }); // user2 prediction: 50%

        // Create resolutions (actual outcomes)
        await factory.createResolution(prop1.id, {
          resolution: true, // Biden won
          notes: "Test resolution",
          user_id: user1.id,
        });

        await factory.createResolution(prop2.id, {
          resolution: false, // Inflation didn't drop below 2%
          notes: "Test resolution",
          user_id: user1.id,
        });

        await factory.createResolution(prop3.id, {
          resolution: true, // Democrats kept the Senate
          notes: "Test resolution",
          user_id: user1.id,
        });

        // Note: When props are resolved, ALL users who forecast on those props get scores
        // So both user1 and user2 should appear in the scores
        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          const { overallScores, categoryScores, incompleteUserIds } = result.data;

          // All users forecasted all props, so none are incomplete
          expect(incompleteUserIds).toEqual([]);

          // Check overall scores (both users have resolved forecasts)
          expect(overallScores).toHaveLength(2);
          expect(overallScores).toContainEqual({
            userId: user1.id,
            userName: user1.name,
            score: expect.any(Number), // Brier score calculation
          });
          expect(overallScores).toContainEqual({
            userId: user2.id,
            userName: user2.name,
            score: expect.any(Number), // Brier score calculation
          });

          // Check category scores (both users in both categories)
          expect(categoryScores).toHaveLength(4); // 2 users × 2 categories

          // Politics category scores (both users have 2 forecasts each)
          const politicsScoresUser1 = categoryScores.find(
            (c) =>
              c.categoryId === politicsCategory!.id && c.userId === user1.id,
          );
          expect(politicsScoresUser1).toBeDefined();
          expect(politicsScoresUser1!.userName).toBe(user1.name);
          // (0.7 - 1)^2 = 0.09 and (0.6 - 1)^2 = 0.16, so average is 0.125
          expect(politicsScoresUser1!.score).toBeCloseTo(0.125, 6);

          const politicsScoresUser2 = categoryScores.find(
            (c) =>
              c.categoryId === politicsCategory!.id && c.userId === user2.id,
          );
          expect(politicsScoresUser2).toBeDefined();
          expect(politicsScoresUser2!.userName).toBe(user2.name);
          // (0.8 - 1)^2 = 0.04 and (0.5 - 1)^2 = 0.25, so average is 0.145
          expect(politicsScoresUser2!.score).toBeCloseTo(0.145, 6);

          // Economics category scores (both users have 1 forecast each)
          const economicsScoresUser1 = categoryScores.find(
            (c) =>
              c.categoryId === economicsCategory!.id && c.userId === user1.id,
          );
          expect(economicsScoresUser1).toBeDefined();
          expect(economicsScoresUser1!.userName).toBe(user1.name);
          // (0.4 - 0)^2 = 0.16
          expect(economicsScoresUser1!.score).toBeCloseTo(0.16, 6);

          const economicsScoresUser2 = categoryScores.find(
            (c) =>
              c.categoryId === economicsCategory!.id && c.userId === user2.id,
          );
          expect(economicsScoresUser2).toBeDefined();
          expect(economicsScoresUser2!.userName).toBe(user2.name);
          // (0.3 - 0)^2 = 0.09
          expect(economicsScoresUser2!.score).toBeCloseTo(0.09, 6);
        }
      },
    );

    ifRunningContainerTestsIt(
      "should calculate Brier scores correctly",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);

        const competition = await factory.createCompetition();

        // Create a single prop
        const prop = await factory.createCompetitionProp(competition.id, {
          text: "Will this happen?",
        });

        // User predicts 80% probability
        await factory.createForecast(user.id, prop.id, { forecast: 0.8 });

        // Actual outcome: it happened (true)
        await factory.createResolution(prop.id, {
          resolution: true,
          notes: "Test resolution",
          user_id: user.id,
        });

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          const { overallScores, incompleteUserIds } = result.data;

          // Single user forecasted the only prop, so they are complete
          expect(incompleteUserIds).toEqual([]);

          // Brier score = (resolution - forecast)^2 = (1 - 0.8)^2 = 0.04
          expect(overallScores).toHaveLength(1);
          expect(overallScores[0].userId).toBe(user.id);
          expect(overallScores[0].userName).toBe(user.name);
          expect(overallScores[0].score).toBeCloseTo(0.04, 6); // (1 - 0.8)^2 = 0.04
        }
      },
    );

    ifRunningContainerTestsIt(
      "should exclude users who haven't forecasted all props when excludeIncomplete is true",
      async () => {
        const completeUser = await factory.createUser({
          name: "Complete User",
        });
        const incompleteUser = await factory.createUser({
          name: "Incomplete User",
        });
        vi.mocked(getUserFromCookies).mockResolvedValue(completeUser);

        const competition = await factory.createCompetition();

        const prop1 = await factory.createCompetitionProp(competition.id, {
          text: "Prop 1",
        });
        const prop2 = await factory.createCompetitionProp(competition.id, {
          text: "Prop 2",
        });
        const prop3 = await factory.createCompetitionProp(competition.id, {
          text: "Prop 3",
        });

        // Complete user forecasts on all 3 props
        await factory.createForecast(completeUser.id, prop1.id, {
          forecast: 0.7,
        });
        await factory.createForecast(completeUser.id, prop2.id, {
          forecast: 0.4,
        });
        await factory.createForecast(completeUser.id, prop3.id, {
          forecast: 0.6,
        });

        // Incomplete user only forecasts on 2 of 3 props
        await factory.createForecast(incompleteUser.id, prop1.id, {
          forecast: 0.8,
        });
        await factory.createForecast(incompleteUser.id, prop2.id, {
          forecast: 0.3,
        });

        // Resolve all props
        await factory.createResolution(prop1.id, {
          resolution: true,
          notes: "resolved",
          user_id: completeUser.id,
        });
        await factory.createResolution(prop2.id, {
          resolution: false,
          notes: "resolved",
          user_id: completeUser.id,
        });
        await factory.createResolution(prop3.id, {
          resolution: true,
          notes: "resolved",
          user_id: completeUser.id,
        });

        // Without excludeIncomplete: both users appear, incomplete user is flagged
        const allResult = await getCompetitionScores({
          competitionId: competition.id,
        });
        expect(allResult.success).toBe(true);
        if (allResult.success) {
          expect(allResult.data.overallScores).toHaveLength(2);
          expect(allResult.data.incompleteUserIds).toEqual([incompleteUser.id]);
        }

        // With excludeIncomplete: only the complete user appears
        const filteredResult = await getCompetitionScores({
          competitionId: competition.id,
          excludeIncomplete: true,
        });
        expect(filteredResult.success).toBe(true);
        if (filteredResult.success) {
          expect(filteredResult.data.overallScores).toHaveLength(1);
          expect(filteredResult.data.overallScores[0].userId).toBe(
            completeUser.id,
          );
          // Category scores should also be filtered
          filteredResult.data.categoryScores.forEach((cs) => {
            expect(cs.userId).toBe(completeUser.id);
          });
        }
      },
    );

    ifRunningContainerTestsIt(
      "should handle competition with no resolved forecasts",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);

        const competition = await factory.createCompetition();

        // Create prop but no resolution
        await factory.createCompetitionProp(competition.id, {
          text: "Unresolved proposition",
        });

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.overallScores).toEqual([]);
          expect(result.data.categoryScores).toEqual([]);
          expect(result.data.incompleteUserIds).toEqual([]);
        }
      },
    );
  });

  describe("choice props", () => {
    ifRunningContainerTestsIt(
      "scores a choice prop once per prop and reports its options in the breakdown",
      async () => {
        const user = await factory.createUser({ name: "Choice User" });
        vi.mocked(getUserFromCookies).mockResolvedValue(user);

        const competition = await factory.createCompetition();

        // Binary prop: forecast 0.6, resolves false -> (0 - 0.6)^2 = 0.36
        const binaryProp = await factory.createCompetitionProp(competition.id, {
          text: "Binary prop",
        });
        await factory.createForecast(user.id, binaryProp.id, {
          forecast: 0.6,
        });
        await factory.createResolution(binaryProp.id, {
          resolution: false,
          user_id: user.id,
        });

        // one_of prop: uniform 0.25 over four options, first one resolves true
        // -> 0.5 * ((1 - .25)^2 + 3 * (0 - .25)^2) = 0.5 * 0.75 = 0.375
        const { prop: choiceProp, options } = await factory.createChoiceProp(
          "one_of",
          ["North", "South", "East", "West"],
          { competition_id: competition.id, text: "Choice prop" },
        );
        await factory.createChoiceForecast(
          user.id,
          choiceProp.id,
          options.map((o) => ({ optionId: o.id, probability: 0.25 })),
        );
        await factory.createChoiceResolution(
          choiceProp.id,
          options.map((o, i) => ({ optionId: o.id, outcome: i === 0 })),
          { user_id: user.id },
        );

        const scores = await getCompetitionScores({
          competitionId: competition.id,
        });
        expect(scores.success).toBe(true);
        if (!scores.success) return;
        // Each prop contributes exactly one number: (0.36 + 0.375) / 2
        expect(scores.data.overallScores).toHaveLength(1);
        expect(scores.data.overallScores[0].userId).toBe(user.id);
        expect(scores.data.overallScores[0].score).toBeCloseTo(0.3675, 6);
        expect(scores.data.incompleteUserIds).toEqual([]);

        const breakdown = await getUserScoreBreakdown({
          competitionId: competition.id,
          userId: user.id,
        });
        expect(breakdown.success).toBe(true);
        if (!breakdown.success) return;

        expect(breakdown.data.overallScore).toBeCloseTo(0.3675, 6);
        expect(breakdown.data.forecastScores).toHaveLength(2);

        const binaryScore = breakdown.data.forecastScores.find(
          (f) => f.propId === binaryProp.id,
        )!;
        expect(binaryScore.kind).toBe("binary");
        expect(binaryScore.forecast).toBeCloseTo(0.6, 6);
        expect(binaryScore.resolution).toBe(false);
        expect(binaryScore.score).toBeCloseTo(0.36, 6);
        expect(binaryScore.options).toEqual([]);

        const choiceScore = breakdown.data.forecastScores.find(
          (f) => f.propId === choiceProp.id,
        )!;
        expect(choiceScore.kind).toBe("one_of");
        expect(choiceScore.forecast).toBeNull();
        expect(choiceScore.resolution).toBeNull();
        expect(choiceScore.score).toBeCloseTo(0.375, 6);
        expect(choiceScore.options).toHaveLength(4);
        expect(choiceScore.options.map((o) => o.text)).toEqual([
          "North",
          "South",
          "East",
          "West",
        ]);
        expect(choiceScore.options.map((o) => o.userForecast)).toEqual([
          0.25, 0.25, 0.25, 0.25,
        ]);
        expect(choiceScore.options.map((o) => o.outcome)).toEqual([
          true,
          false,
          false,
          false,
        ]);
      },
    );
  });

  describe("error handling", () => {
    ifRunningContainerTestsIt(
      "should return error for non-existent competition",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);

        const result = await getCompetitionScores({ competitionId: 999999 });

        expect(result.success).toBe(true);
        if (result.success) {
          // Non-existent competition should return empty scores
          expect(result.data.overallScores).toEqual([]);
          expect(result.data.categoryScores).toEqual([]);
          expect(result.data.incompleteUserIds).toEqual([]);
        }
      },
    );
  });

  describe("voided props", () => {
    /** P1 (yes) and P2 (no) are resolved; P3 is voided. */
    async function competitionWithAVoid() {
      const competition = await factory.createCompetition();
      const p1 = await factory.createCompetitionProp(competition.id);
      const p2 = await factory.createCompetitionProp(competition.id);
      const p3 = await factory.createCompetitionProp(competition.id);
      await factory.createResolution(p1.id, { resolution: true });
      await factory.createResolution(p2.id, { resolution: false });
      await factory.createResolution(p3.id, { resolution: null, voided: true });
      return { competition, p1, p2, p3 };
    }

    ifRunningContainerTestsIt(
      "counts a forecaster who skipped only the voided prop as complete",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);
        const { competition, p1, p2 } = await competitionWithAVoid();
        await factory.createForecast(user.id, p1.id, { forecast: 0.8 });
        await factory.createForecast(user.id, p2.id, { forecast: 0.4 });

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.incompleteUserIds).toEqual([]);
        }
      },
    );

    ifRunningContainerTestsIt(
      "does not let a forecast on the voided prop cover a real gap",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);
        const { competition, p1, p3 } = await competitionWithAVoid();
        await factory.createForecast(user.id, p1.id, { forecast: 0.8 });
        await factory.createForecast(user.id, p3.id, { forecast: 0.9 });

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.incompleteUserIds).toEqual([user.id]);
        }
      },
    );

    ifRunningContainerTestsIt(
      "leaves the voided prop out of the average",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user);
        const { competition, p1, p2, p3 } = await competitionWithAVoid();
        await factory.createForecast(user.id, p1.id, { forecast: 0.8 });
        await factory.createForecast(user.id, p2.id, { forecast: 0.4 });
        await factory.createForecast(user.id, p3.id, { forecast: 0.0 });

        const result = await getCompetitionScores({
          competitionId: competition.id,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          // (1 - 0.8)^2 = 0.04 and (0 - 0.4)^2 = 0.16; the void counts for nothing.
          expect(result.data.overallScores).toHaveLength(1);
          expect(result.data.overallScores[0].score).toBeCloseTo(0.1, 10);
        }
      },
    );
  });
});
