import { describe, expect, it } from "vitest";
import { closedNote } from "./build";

/** What the prop sheet says under the scale once forecasting is over. */
describe("closedNote", () => {
  it("says a voided prop takes no forecast, whether or not you made one", () => {
    expect(
      closedNote({ resolution_voided: true, user_forecast_id: null }),
    ).toEqual({
      text: "This prop was voided, so it takes no forecasts.",
      miss: false,
    });
    expect(
      closedNote({ resolution_voided: true, user_forecast_id: 4 }),
    ).toEqual({
      text: "This prop was voided, so your forecast is not scored.",
      miss: false,
    });
  });

  it("keeps the deadline notes for everything else", () => {
    expect(
      closedNote({ resolution_voided: null, user_forecast_id: null }),
    ).toEqual({
      text: "You did not forecast this one before the deadline.",
      miss: true,
    });
    expect(
      closedNote({ resolution_voided: false, user_forecast_id: 4 }),
    ).toEqual({
      text: "Forecasting is closed. This is the forecast you submitted.",
      miss: false,
    });
  });
});
