import { describe, expect, it } from "vitest";

import type { VSuggestedProp } from "@/types/db_types";
import {
  REVIEWED_PARAM,
  partitionQueue,
  reviewedFilterOf,
  type ReviewedFilter,
} from "./review-queue";

let nextId = 1;
function suggestion(over: Partial<VSuggestedProp> = {}): VSuggestedProp {
  return {
    id: nextId++,
    prop_text: "A claim.",
    notes: null,
    created_at: new Date("2026-09-01T00:00:00Z"),
    user_id: 1,
    user_name: "Ada",
    user_email: "ada@example.com",
    status: null,
    decided_at: null,
    decided_by_name: null,
    ...over,
  };
}

const decided = (status: "accepted" | "rejected", day: number) =>
  suggestion({
    status,
    decided_at: new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00Z`),
    decided_by_name: "Rae",
  });

describe("reviewedFilterOf", () => {
  it("reads a collapsed section when the parameter is absent", () => {
    expect(reviewedFilterOf({})).toBeNull();
  });

  it("opens the section on each of the three choices", () => {
    const choices: ReviewedFilter[] = ["all", "accepted", "rejected"];
    for (const choice of choices) {
      expect(reviewedFilterOf({ [REVIEWED_PARAM]: choice })).toBe(choice);
    }
  });

  it("collapses on a value from nowhere rather than showing an empty list", () => {
    expect(reviewedFilterOf({ [REVIEWED_PARAM]: "pending" })).toBeNull();
    expect(reviewedFilterOf({ [REVIEWED_PARAM]: "" })).toBeNull();
    expect(reviewedFilterOf({ [REVIEWED_PARAM]: "ALL" })).toBeNull();
  });

  it("takes the first value when the parameter repeats", () => {
    expect(reviewedFilterOf({ [REVIEWED_PARAM]: ["accepted", "all"] })).toBe(
      "accepted",
    );
  });
});

describe("partitionQueue", () => {
  it("leads with the suggestions nobody has ruled on", () => {
    const pendingOne = suggestion();
    const pendingTwo = suggestion();
    const queue = partitionQueue(
      [decided("accepted", 2), pendingOne, pendingTwo],
      "all",
    );

    expect(queue.pending.map((s) => s.id)).toEqual([
      pendingOne.id,
      pendingTwo.id,
    ]);
  });

  it("counts everything reviewed, whatever the filter shows", () => {
    const queue = partitionQueue(
      [suggestion(), decided("accepted", 2), decided("rejected", 3)],
      "accepted",
    );

    expect(queue.reviewedCount).toBe(2);
    expect(queue.reviewed).toHaveLength(1);
  });

  it("shows both decisions under 'all'", () => {
    const queue = partitionQueue(
      [decided("accepted", 2), decided("rejected", 3)],
      "all",
    );

    expect(queue.reviewed.map((s) => s.status)).toEqual([
      "rejected",
      "accepted",
    ]);
  });

  it("narrows to one decision when asked", () => {
    const queue = partitionQueue(
      [decided("accepted", 2), decided("rejected", 3)],
      "rejected",
    );

    expect(queue.reviewed.map((s) => s.status)).toEqual(["rejected"]);
  });

  it("puts the most recent decision first", () => {
    const older = decided("accepted", 1);
    const newer = decided("rejected", 9);
    const queue = partitionQueue([older, newer], "all");

    expect(queue.reviewed.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it("still partitions when the section is collapsed", () => {
    // The pending list and the count in the disclosure label are needed even
    // when nothing reviewed is on screen.
    const queue = partitionQueue([suggestion(), decided("accepted", 2)], null);

    expect(queue.pending).toHaveLength(1);
    expect(queue.reviewedCount).toBe(1);
    expect(queue.reviewed).toEqual([]);
  });
});
