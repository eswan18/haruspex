import { describe, it, expect } from "vitest";
import {
  getPropStatus,
  getPropStatusFromProp,
  getPropStatusLabel,
  isOpenInCompetition,
  PropStatus,
} from "./prop-status";

describe("getPropStatus", () => {
  const now = new Date("2024-06-15T12:00:00Z");

  describe("resolution states", () => {
    it("should return resolved-yes when resolution is true", () => {
      const pastDate = new Date("2024-06-10T12:00:00Z");
      expect(getPropStatus(pastDate, true, { currentDate: now })).toBe(
        "resolved-yes",
      );
    });

    it("should return resolved-no when resolution is false", () => {
      const pastDate = new Date("2024-06-10T12:00:00Z");
      expect(getPropStatus(pastDate, false, { currentDate: now })).toBe(
        "resolved-no",
      );
    });

    it("should prioritize resolution over dates", () => {
      // Even if date is in the future, resolved props show resolution status
      const futureDate = new Date("2024-06-20T12:00:00Z");
      expect(getPropStatus(futureDate, true, { currentDate: now })).toBe(
        "resolved-yes",
      );
    });
  });

  describe("open state", () => {
    it("should return open when no close date", () => {
      expect(getPropStatus(null, null, { currentDate: now })).toBe("open");
    });

    it("should return open when close date is in the future", () => {
      const futureDate = new Date("2024-06-20T12:00:00Z"); // 5 days away
      expect(getPropStatus(futureDate, null, { currentDate: now })).toBe(
        "open",
      );
    });

    it("should return open when close date is soon but still in the future", () => {
      const soonDate = new Date("2024-06-16T10:00:00Z"); // 22 hours away
      expect(getPropStatus(soonDate, null, { currentDate: now })).toBe("open");
    });
  });

  describe("unresolved state", () => {
    it("should return unresolved when past deadline and not resolved", () => {
      const pastDate = new Date("2024-06-14T12:00:00Z"); // 1 day ago
      expect(getPropStatus(pastDate, null, { currentDate: now })).toBe(
        "unresolved",
      );
    });

    it("should return unresolved when exactly at deadline", () => {
      expect(getPropStatus(now, null, { currentDate: now })).toBe("unresolved");
    });
  });
});

describe("getPropStatusFromProp", () => {
  const now = new Date("2024-06-15T12:00:00Z");

  it("should use prop_forecasts_due_date for private competitions", () => {
    const prop = {
      prop_forecasts_due_date: new Date("2024-06-20T12:00:00Z"),
      competition_forecasts_close_date: new Date("2024-06-10T12:00:00Z"), // past
      competition_is_private: true,
      resolution: null,
    };
    // Private competition uses prop date (future), not competition date (past)
    expect(getPropStatusFromProp(prop, { currentDate: now })).toBe("open");
  });

  it("should use competition_forecasts_close_date for public competitions", () => {
    const prop = {
      prop_forecasts_due_date: new Date("2024-06-20T12:00:00Z"), // future
      competition_forecasts_close_date: new Date("2024-06-10T12:00:00Z"), // past
      competition_is_private: false,
      resolution: null,
    };
    // Public competition uses competition date (past)
    expect(getPropStatusFromProp(prop, { currentDate: now })).toBe(
      "unresolved",
    );
  });

  it("should use the prop's own date when it belongs to no competition", () => {
    // A personal prop: every competition_* field is null, so its own deadline
    // is the only one there is.
    const prop = {
      prop_forecasts_due_date: new Date("2024-06-10T12:00:00Z"), // past
      competition_forecasts_close_date: null,
      competition_is_private: null,
      resolution: null,
    };
    expect(getPropStatusFromProp(prop, { currentDate: now })).toBe(
      "unresolved",
    );
  });

  it("should handle missing dates gracefully", () => {
    const prop = {
      resolution: null,
    };
    expect(getPropStatusFromProp(prop, { currentDate: now })).toBe("open");
  });

  it("should return resolution status regardless of competition type", () => {
    const prop = {
      prop_forecasts_due_date: new Date("2024-06-20T12:00:00Z"),
      competition_is_private: true,
      resolution: true,
    };
    expect(getPropStatusFromProp(prop, { currentDate: now })).toBe(
      "resolved-yes",
    );
  });
});

describe("getPropStatusLabel", () => {
  it.each<[PropStatus, string]>([
    ["open", "Open"],
    ["unresolved", "Unresolved"],
    ["resolved-yes", "Yes"],
    ["resolved-no", "No"],
    ["resolved", "Resolved"],
  ])("should return correct label for %s", (status, expected) => {
    expect(getPropStatusLabel(status)).toBe(expected);
  });
});

describe("choice props", () => {
  it("returns resolved when isResolved is set and there is no boolean resolution", () => {
    expect(getPropStatus(null, null, { isResolved: true })).toBe("resolved");
    expect(getPropStatus(new Date(0), null, { isResolved: true })).toBe(
      "resolved",
    );
  });

  it("a boolean resolution still wins", () => {
    expect(getPropStatus(null, true, { isResolved: true })).toBe(
      "resolved-yes",
    );
  });

  it("getPropStatusFromProp reads resolution_id", () => {
    expect(getPropStatusFromProp({ resolution: null, resolution_id: 7 })).toBe(
      "resolved",
    );
    expect(
      getPropStatusFromProp({ resolution: null, resolution_id: null }),
    ).toBe("open");
  });

  it("labels resolved as Resolved", () => {
    expect(getPropStatusLabel("resolved")).toBe("Resolved");
  });
});

describe("voided props", () => {
  const now = new Date("2024-06-15T12:00:00Z");
  const future = new Date("2024-06-20T12:00:00Z");
  const past = new Date("2024-06-10T12:00:00Z");

  it("reads voided even before the deadline", () => {
    expect(
      getPropStatus(future, null, {
        currentDate: now,
        isResolved: true,
        isVoided: true,
      }),
    ).toBe("voided");
  });

  it("reads voided after the deadline, not resolved", () => {
    expect(
      getPropStatus(past, null, {
        currentDate: now,
        isResolved: true,
        isVoided: true,
      }),
    ).toBe("voided");
  });

  it("getPropStatusFromProp reads resolution_voided", () => {
    const base = {
      prop_forecasts_due_date: past,
      competition_forecasts_close_date: null,
      competition_is_private: null,
      resolution: null,
      resolution_id: 7,
    };
    expect(
      getPropStatusFromProp(
        { ...base, resolution_voided: true },
        { currentDate: now },
      ),
    ).toBe("voided");
    expect(
      getPropStatusFromProp(
        { ...base, resolution_voided: false },
        { currentDate: now },
      ),
    ).toBe("resolved");
  });

  it("labels it Voided", () => {
    expect(getPropStatusLabel("voided")).toBe("Voided");
  });
});

describe("isOpenInCompetition", () => {
  const now = new Date("2024-06-15T12:00:00Z");
  const future = new Date("2024-06-20T12:00:00Z");
  const past = new Date("2024-06-10T12:00:00Z");
  const prop = (over: Record<string, unknown> = {}) => ({
    prop_forecasts_due_date: null,
    competition_forecasts_close_date: future,
    resolution_voided: null,
    ...over,
  });

  it("is open before the season's deadline in a public competition", () => {
    expect(isOpenInCompetition(prop(), false, now)).toBe(true);
    expect(
      isOpenInCompetition(
        prop({ competition_forecasts_close_date: past }),
        false,
        now,
      ),
    ).toBe(false);
  });

  it("reads the prop's own deadline in a private competition", () => {
    expect(
      isOpenInCompetition(prop({ prop_forecasts_due_date: past }), true, now),
    ).toBe(false);
    expect(
      isOpenInCompetition(prop({ prop_forecasts_due_date: null }), true, now),
    ).toBe(true);
  });

  it("is closed once voided, even before the deadline", () => {
    expect(
      isOpenInCompetition(prop({ resolution_voided: true }), false, now),
    ).toBe(false);
  });
});
