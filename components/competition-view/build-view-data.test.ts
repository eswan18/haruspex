import { describe, expect, it } from "vitest";
import { buildViewData } from "./build-view-data";
import type { CompetitionScore } from "@/lib/db_actions";
import type { Competition, PropWithUserForecast } from "@/types/db_types";

const NOW = new Date("2026-09-02T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function competition(over: Partial<Competition> = {}): Competition {
  return {
    id: 6,
    name: "2026 Open",
    is_private: false,
    forecasts_open_date: day(-100),
    forecasts_close_date: day(30),
    end_date: day(120),
    created_at: day(-200),
    updated_at: day(-200),
    ...over,
  } as Competition;
}

let nextPropId = 1;
function prop(over: Partial<PropWithUserForecast> = {}): PropWithUserForecast {
  return {
    prop_id: nextPropId++,
    prop_text: "A prop",
    prop_forecasts_due_date: null,
    competition_forecasts_close_date: day(30),
    competition_is_private: false,
    resolution_id: null,
    user_forecast_id: null,
    ...over,
  } as PropWithUserForecast;
}

function scores(over: Partial<CompetitionScore> = {}): CompetitionScore {
  return {
    overallScores: [],
    categoryScores: [],
    incompleteUserIds: [],
    ...over,
  };
}

const build = (args: Partial<Parameters<typeof buildViewData>[0]> = {}) =>
  buildViewData({
    competition: competition(),
    props: [],
    scores: scores(),
    fieldSize: 0,
    currentUserId: 9,
    now: NOW,
    ...args,
  });

describe("buildViewData", () => {
  describe("partitioning props", () => {
    it("counts a prop past its close date and unresolved as awaiting a result", () => {
      const data = build({
        props: [prop({ competition_forecasts_close_date: day(-1) })],
      });
      expect(data.counts).toMatchObject({
        open: 0,
        unresolved: 1,
        resolved: 0,
      });
    });

    it("counts a resolved prop as resolved even though its date has passed", () => {
      const data = build({
        props: [
          prop({ competition_forecasts_close_date: day(-1), resolution_id: 3 }),
        ],
      });
      expect(data.counts).toMatchObject({
        open: 0,
        unresolved: 0,
        resolved: 1,
      });
    });

    it("counts a prop resolved before its deadline as resolved, not open", () => {
      const data = build({
        props: [
          prop({ competition_forecasts_close_date: day(5), resolution_id: 3 }),
        ],
      });
      expect(data.counts).toMatchObject({
        open: 0,
        unresolved: 0,
        resolved: 1,
      });
      expect(data.counts.toForecast).toBe(0);
    });

    it("counts a voided prop as resolved, not open, before its deadline", () => {
      const data = build({
        props: [
          prop({
            competition_forecasts_close_date: day(5),
            resolution_id: 3,
            resolution_voided: true,
          }),
        ],
      });
      expect(data.counts).toMatchObject({ open: 0, resolved: 1 });
      expect(data.counts.toForecast).toBe(0);
    });

    it("treats a prop with no deadline as open", () => {
      const data = build({
        props: [prop({ competition_forecasts_close_date: null })],
      });
      expect(data.counts.open).toBe(1);
    });

    it("uses per-prop dates for a private competition, not competition dates", () => {
      // The competition-level date is still in the future, but the prop's own
      // deadline has passed -- private competitions run off the latter.
      const data = build({
        competition: competition({ is_private: true }),
        props: [
          prop({
            prop_forecasts_due_date: day(-1),
            competition_forecasts_close_date: day(30),
          }),
        ],
      });
      expect(data.counts).toMatchObject({ open: 0, unresolved: 1 });
    });
  });

  describe("what the viewer owes", () => {
    it("lists only open props the viewer has not forecasted", () => {
      const data = build({
        props: [
          prop({ prop_text: "owed" }),
          prop({ prop_text: "already done", user_forecast_id: 42 }),
          prop({
            prop_text: "closed",
            competition_forecasts_close_date: day(-1),
          }),
        ],
      });
      expect(data.owed.map((p) => p.propText)).toEqual(["owed"]);
      expect(data.counts.toForecast).toBe(1);
    });

    it("sorts by soonest deadline and puts undated props last", () => {
      const data = build({
        props: [
          prop({
            prop_text: "later",
            competition_forecasts_close_date: day(20),
          }),
          prop({
            prop_text: "undated",
            competition_forecasts_close_date: null,
          }),
          prop({
            prop_text: "sooner",
            competition_forecasts_close_date: day(2),
          }),
        ],
      });
      expect(data.owed.map((p) => p.propText)).toEqual([
        "sooner",
        "later",
        "undated",
      ]);
    });
  });

  describe("standings", () => {
    const overallScores = [
      { userId: 1, userName: "Best", score: 0.1 },
      { userId: 9, userName: "Viewer", score: 0.3 },
      { userId: 2, userName: "Worst", score: 0.5 },
    ];

    it("orders by ascending Brier score, since lower is better", () => {
      const data = build({ scores: scores({ overallScores }) });
      expect(data.standings.map((s) => s.userName)).toEqual([
        "Best",
        "Viewer",
        "Worst",
      ]);
    });

    it("ranks the viewer among complete forecasters only", () => {
      // "Best" has a partial forecast set, so their score isn't comparable and
      // they must not push the viewer down a place.
      const data = build({
        scores: scores({ overallScores, incompleteUserIds: [1] }),
      });
      expect(data.you).toEqual({ rank: 1, score: 0.3, incomplete: false });
    });

    it("reports no standing for a viewer who isn't scored", () => {
      const data = build({
        scores: scores({ overallScores }),
        currentUserId: 999,
      });
      expect(data.you).toBeNull();
    });

    it("flags incomplete forecasters so the board can mark them", () => {
      const data = build({
        scores: scores({ overallScores, incompleteUserIds: [2] }),
      });
      expect(data.standings.find((s) => s.userId === 2)?.incomplete).toBe(true);
    });
  });

  describe("phase", () => {
    it("is scoring, not final, once forecasting shuts but results are pending", () => {
      const data = build({
        competition: competition({
          forecasts_close_date: day(-1),
          end_date: day(30),
        }),
      });
      expect(data.phase).toBe("scoring");
    });

    it("is final past the end date", () => {
      const data = build({
        competition: competition({
          forecasts_close_date: day(-30),
          end_date: day(-1),
        }),
      });
      expect(data.phase).toBe("final");
    });

    it("treats a private competition's null dates as live", () => {
      const data = build({
        competition: competition({
          is_private: true,
          forecasts_open_date: null,
          forecasts_close_date: null,
          end_date: null,
        }),
      });
      expect(data.phase).toBe("live");
    });
  });
});
