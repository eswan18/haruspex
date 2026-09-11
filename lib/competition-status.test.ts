import { describe, it, expect } from "vitest";

import { newPropAudience, schedulesByProp } from "./competition-status";

const seasonDates = {
  forecasts_open_date: new Date("2026-01-01T00:00:00Z"),
  forecasts_close_date: new Date("2026-02-01T00:00:00Z"),
  end_date: new Date("2026-12-31T00:00:00Z"),
};
const noDates = {
  forecasts_open_date: null,
  forecasts_close_date: null,
  end_date: null,
};

describe("schedulesByProp", () => {
  it("is true when the competition has no season dates", () => {
    expect(schedulesByProp(noDates)).toBe(true);
  });

  it("is false when the competition has season dates", () => {
    expect(schedulesByProp(seasonDates)).toBe(false);
  });

  it("is true when any one season date is missing", () => {
    // Matches getCompetitionStatus, which treats any null as no timeline.
    expect(schedulesByProp({ ...seasonDates, end_date: null })).toBe(true);
  });
});

describe("newPropAudience", () => {
  it("announces a private competition's new props to its members", () => {
    expect(newPropAudience({ is_private: true, ...noDates })).toBe("members");
  });

  it("announces nothing for a public competition with season dates", () => {
    expect(newPropAudience({ is_private: false, ...seasonDates })).toBeNull();
  });

  it("announces nothing for a public competition that schedules by prop", () => {
    // Not possible today (a check constraint requires season dates on public
    // competitions), and deliberately null until a public audience is defined.
    expect(newPropAudience({ is_private: false, ...noDates })).toBeNull();
  });

  it("announces nothing for a competition with a shared timeline", () => {
    // Also ruled out by a constraint today: a private competition has no
    // season dates. The props share one deadline, so there is nothing to
    // announce about any single one.
    expect(newPropAudience({ is_private: true, ...seasonDates })).toBeNull();
  });
});
