import { describe, expect, it } from "vitest";

import {
  CLAIM_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  checkSuggestion,
} from "./suggested-prop";

describe("checkSuggestion", () => {
  it("trims the claim and the notes", () => {
    expect(
      checkSuggestion({
        prop: "  A fair claim.  ",
        notes: "  How to settle. ",
      }),
    ).toEqual({ ok: true, prop: "A fair claim.", notes: "How to settle." });
  });

  it("reads empty or blank notes as no notes", () => {
    expect(checkSuggestion({ prop: "A fair claim.", notes: "" })).toEqual({
      ok: true,
      prop: "A fair claim.",
      notes: null,
    });
    expect(
      checkSuggestion({ prop: "A fair claim.", notes: "   " }),
    ).toMatchObject({ notes: null });
    expect(
      checkSuggestion({ prop: "A fair claim.", notes: null }),
    ).toMatchObject({ notes: null });
  });

  it("refuses a claim that is too short once trimmed", () => {
    expect(checkSuggestion({ prop: "  short  ", notes: null }).ok).toBe(false);
    expect(checkSuggestion({ prop: "         ", notes: null }).ok).toBe(false);
  });

  it("refuses a claim or notes over the limit", () => {
    expect(
      checkSuggestion({ prop: "x".repeat(CLAIM_MAX_LENGTH + 1), notes: null })
        .ok,
    ).toBe(false);
    expect(
      checkSuggestion({
        prop: "A fair claim.",
        notes: "x".repeat(NOTES_MAX_LENGTH + 1),
      }).ok,
    ).toBe(false);
  });

  it("says which field it refused", () => {
    expect(checkSuggestion({ prop: "short", notes: null })).toMatchObject({
      ok: false,
      field: "prop",
    });
    expect(
      checkSuggestion({
        prop: "A fair claim.",
        notes: "x".repeat(NOTES_MAX_LENGTH + 1),
      }),
    ).toMatchObject({ ok: false, field: "notes" });
  });

  it("accepts a claim exactly at the limit", () => {
    expect(
      checkSuggestion({ prop: "x".repeat(CLAIM_MAX_LENGTH), notes: null }).ok,
    ).toBe(true);
  });
});
