import { describe, expect, it } from "vitest";

import type { PropWithUserForecast } from "@/types/db_types";

import { CHOICES, forecastProgress, matches, resolveChoice } from "./tabs";

describe("resolveChoice", () => {
  it("falls back to the list's default when the URL asks for nothing", () => {
    expect(resolveChoice("forecast", null)).toBe("todo");
    expect(resolveChoice("stage", null)).toBe("all");
  });

  it("honours a choice the list actually offers", () => {
    expect(resolveChoice("forecast", "done")).toBe("done");
    expect(resolveChoice("stage", "scoring")).toBe("scoring");
  });

  it("falls back when the choice belongs to the other list", () => {
    // ?tab=scoring on a competition's open list, which offers to-do/done/all:
    // filtering everything away with no cell lit would be worse than ignoring
    // the parameter.
    expect(resolveChoice("forecast", "scoring")).toBe("todo");
    expect(resolveChoice("stage", "todo")).toBe("all");
  });

  it("falls back on a value from nowhere", () => {
    expect(resolveChoice("stage", "nonsense")).toBe("all");
    expect(resolveChoice("forecast", "")).toBe("todo");
  });

  it("every offered choice resolves to itself", () => {
    for (const tabs of ["forecast", "stage"] as const) {
      for (const { id } of CHOICES[tabs]) {
        expect(resolveChoice(tabs, id)).toBe(id);
      }
    }
  });
});

describe("matches", () => {
  const personal = {
    competition_id: null,
    competition_is_private: null,
    competition_forecasts_close_date: null,
    resolution: null,
    resolution_id: null,
    user_forecast_id: null,
  } as unknown as PropWithUserForecast;

  const open = {
    ...personal,
    prop_forecasts_due_date: new Date(Date.now() + 86_400_000),
  };
  const scoring = {
    ...personal,
    prop_forecasts_due_date: new Date(Date.now() - 86_400_000),
  };
  const settled = {
    ...scoring,
    resolution: false,
    resolution_id: 1,
  } as unknown as PropWithUserForecast;

  it("puts each prop in exactly one stage", () => {
    expect(matches("open", open)).toBe(true);
    expect(matches("scoring", open)).toBe(false);
    expect(matches("final", open)).toBe(false);

    expect(matches("open", scoring)).toBe(false);
    expect(matches("scoring", scoring)).toBe(true);
    expect(matches("final", scoring)).toBe(false);

    expect(matches("open", settled)).toBe(false);
    expect(matches("scoring", settled)).toBe(false);
    expect(matches("final", settled)).toBe(true);
  });

  it("counts a choice prop resolved without a boolean as final", () => {
    const choiceProp = {
      ...scoring,
      resolution: null,
      resolution_id: 9,
    } as unknown as PropWithUserForecast;
    expect(matches("final", choiceProp)).toBe(true);
  });

  it("cuts by forecast rather than stage for the other vocabulary", () => {
    const done = { ...open, user_forecast_id: 5 } as PropWithUserForecast;
    expect(matches("todo", open)).toBe(true);
    expect(matches("done", open)).toBe(false);
    expect(matches("todo", done)).toBe(false);
    expect(matches("done", done)).toBe(true);
  });

  it("all takes everything", () => {
    for (const prop of [open, scoring, settled]) {
      expect(matches("all", prop)).toBe(true);
    }
  });
});

describe("forecastProgress", () => {
  const row = (forecastId: number | null, voided: boolean | null) =>
    ({
      user_forecast_id: forecastId,
      resolution_voided: voided,
    }) as PropWithUserForecast;

  it("counts forecast props out of all of them", () => {
    expect(forecastProgress([row(1, null), row(null, null)])).toEqual({
      done: 1,
      total: 2,
    });
  });

  it("leaves voided props out, forecast or not", () => {
    expect(
      forecastProgress([row(1, null), row(null, true), row(2, true)]),
    ).toEqual({ done: 1, total: 1 });
  });
});
