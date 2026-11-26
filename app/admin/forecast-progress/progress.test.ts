import { describe, expect, it } from "vitest";
import { userProgress } from "./progress";

/** One forecaster's row on the admin progress page. */
describe("userProgress", () => {
  it("counts forecasts against props still owed", () => {
    expect(
      userProgress({
        forecasts: [{ resolution_voided: null }, { resolution_voided: false }],
        unforecasted: 2,
      }),
    ).toEqual({ forecasted: 2, unforecasted: 2, percentComplete: 0.5 });
  });

  it("does not count a forecast on a voided prop as progress", () => {
    // The owed side already leaves voids out; this keeps the two in step.
    expect(
      userProgress({
        forecasts: [{ resolution_voided: true }],
        unforecasted: 9,
      }),
    ).toEqual({ forecasted: 0, unforecasted: 9, percentComplete: 0 });
  });
});
