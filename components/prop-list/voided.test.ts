import { describe, expect, it } from "vitest";
import type { PropWithUserForecast } from "@/types/db_types";
import { buildPropViews } from "./build-prop-views";
import { penaltyOf, type PropView } from "./types";

/** A voided prop is settled with no outcome, so the list scores it for nobody. */
describe("voided props in the prop list", () => {
  const resolvedBinary: PropView = {
    propId: 1,
    text: "Anthropic's market cap is higher than OpenAI's",
    category: null,
    kind: "binary",
    yourForecast: 0.7,
    communityAverage: 0.5,
    outcome: true,
    options: [],
    resolved: true,
    voided: false,
    closedAt: null,
  };

  it("has no penalty", () => {
    expect(penaltyOf(resolvedBinary)).toBeCloseTo(0.09, 10);
    expect(
      penaltyOf({ ...resolvedBinary, voided: true, outcome: null }),
    ).toBeNull();
  });

  it("is read from resolution_voided", () => {
    const row = (resolution_voided: boolean | null) =>
      ({
        prop_id: 1,
        prop_text: "x",
        category_name: null,
        prop_kind: "binary",
        user_forecast: 0.7,
        community_average: null,
        resolution: null,
        resolution_id: resolution_voided === null ? null : 3,
        resolution_voided,
        options: [],
        prop_forecasts_due_date: null,
        competition_forecasts_close_date: null,
      }) as unknown as PropWithUserForecast;
    const [voided, answered, open] = buildPropViews({
      props: [row(true), row(false), row(null)],
      isPrivate: false,
    });
    expect(voided.voided).toBe(true);
    expect(answered.voided).toBe(false);
    expect(open.voided).toBe(false);
  });
});
