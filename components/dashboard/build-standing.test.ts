import { describe, expect, it } from "vitest";

import { buildStanding } from "./build-standing";
import type { CompetitionScore } from "@/lib/db_actions";
import type { Competition } from "@/types/db_types";

const NOW = new Date("2024-03-05T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function competition(over: Partial<Competition> = {}): Competition {
  return {
    id: 6,
    name: "2026 Open",
    is_private: false,
    forecasts_open_date: day(-100),
    forecasts_close_date: day(30),
    end_date: day(120),
    ...over,
  } as Competition;
}

function scores(over: Partial<CompetitionScore> = {}): CompetitionScore {
  return {
    overallScores: [],
    categoryScores: [],
    incompleteUserIds: [],
    ...over,
  };
}

const ADA = { userId: 1, userName: "Ada", score: 0.121 };
const BO = { userId: 2, userName: "Bo", score: 0.147 };
const CY = { userId: 3, userName: "Cy", score: 0.163 };
const DEE = { userId: 4, userName: "Dee", score: 0.184 };

const build = (args: Partial<Parameters<typeof buildStanding>[0]> = {}) =>
  buildStanding({
    competition: competition(),
    scores: scores(),
    currentUserId: DEE.userId,
    now: NOW,
    ...args,
  });

describe("buildStanding", () => {
  describe("the leaders", () => {
    it("names the three best complete forecasters", () => {
      const standing = build({
        scores: scores({ overallScores: [CY, ADA, DEE, BO] }),
      });

      expect(standing.leaders.map((l) => l.userName)).toEqual([
        "Ada",
        "Bo",
        "Cy",
      ]);
    });

    it("passes over a partial forecaster with a leading score", () => {
      const standing = build({
        scores: scores({
          overallScores: [ADA, BO, CY, DEE],
          incompleteUserIds: [ADA.userId],
        }),
      });

      expect(standing.leaders.map((l) => l.userName)).toEqual([
        "Bo",
        "Cy",
        "Dee",
      ]);
    });
  });

  describe("where you stand", () => {
    it("does not count a partial forecaster ahead of you", () => {
      const standing = build({
        scores: scores({
          overallScores: [ADA, BO, CY, DEE],
          incompleteUserIds: [ADA.userId, BO.userId],
        }),
        currentUserId: DEE.userId,
      });

      expect(standing.you).toEqual({ rank: 2, score: DEE.score });
    });

    it("leaves you unranked when your own set is partial", () => {
      const standing = build({
        scores: scores({
          overallScores: [ADA, BO, DEE],
          incompleteUserIds: [DEE.userId],
        }),
        currentUserId: DEE.userId,
      });

      expect(standing.you).toBeNull();
    });

    it("leaves you unranked when you have no score at all", () => {
      const standing = build({
        scores: scores({ overallScores: [ADA, BO] }),
        currentUserId: DEE.userId,
      });

      expect(standing.you).toBeNull();
    });
  });

  describe("the field", () => {
    it("counts only the forecasters you are ranked against", () => {
      const standing = build({
        scores: scores({
          overallScores: [ADA, BO, CY, DEE],
          incompleteUserIds: [ADA.userId],
        }),
      });

      expect(standing.fieldSize).toBe(3);
    });
  });

  describe("the season itself", () => {
    it("carries the competition's identity through", () => {
      const standing = build({
        competition: competition({ id: 12, name: "Spring", is_private: true }),
      });

      expect(standing.id).toBe(12);
      expect(standing.name).toBe("Spring");
      expect(standing.isPrivate).toBe(true);
    });

    it("stays featured while props are still resolving", () => {
      const standing = build({
        competition: competition({
          forecasts_close_date: day(-10),
          end_date: day(30),
        }),
      });

      expect(standing.phase).toBe("scoring");
    });

    it("is final once the competition has ended", () => {
      const standing = build({
        competition: competition({
          forecasts_close_date: day(-40),
          end_date: day(-10),
        }),
      });

      expect(standing.phase).toBe("final");
    });
  });
});
