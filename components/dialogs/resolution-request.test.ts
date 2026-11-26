import { describe, expect, it } from "vitest";
import {
  initialBinaryChoice,
  initialChoiceMode,
  resolutionRequest,
} from "./resolution-request";

/** What the resolution dialog starts on, and what it asks the server to do. */
describe("resolution dialog state", () => {
  const unresolved = {
    resolution_id: null,
    resolution: null,
    resolution_voided: null,
  };
  const voided = {
    resolution_id: 3,
    resolution: null,
    resolution_voided: true,
  };

  it("starts a voided prop on Void, for both kinds", () => {
    expect(initialBinaryChoice(voided)).toBe("void");
    expect(initialChoiceMode(voided)).toBe("void");
  });

  it("starts the others where they stand", () => {
    expect(initialBinaryChoice(unresolved)).toBe("unresolved");
    expect(
      initialBinaryChoice({
        resolution_id: 3,
        resolution: false,
        resolution_voided: false,
      }),
    ).toBe("false");
    expect(initialChoiceMode(unresolved)).toBe("unresolved");
    expect(
      initialChoiceMode({
        resolution_id: 3,
        resolution: null,
        resolution_voided: false,
      }),
    ).toBe("resolved");
  });

  it("asks for a void with notes and overwrite, carrying no answer", () => {
    expect(
      resolutionRequest({
        propId: 41,
        binaryChoice: "void",
        notes: "  OpenAI stayed private  ",
      }),
    ).toEqual({
      kind: "resolve",
      args: {
        propId: 41,
        voided: true,
        notes: "OpenAI stayed private",
        overwrite: true,
      },
    });
    expect(
      resolutionRequest({
        propId: 41,
        choice: { mode: "void", outcomes: [] },
        notes: "",
      }),
    ).toEqual({
      kind: "resolve",
      args: { propId: 41, voided: true, notes: undefined, overwrite: true },
    });
  });

  it("asks for a yes/no answer, choice outcomes, or an unresolve", () => {
    expect(
      resolutionRequest({ propId: 41, binaryChoice: "true", notes: "" }),
    ).toEqual({
      kind: "resolve",
      args: { propId: 41, resolution: true, notes: undefined, overwrite: true },
    });
    const outcomes = [
      { optionId: 1, outcome: true },
      { optionId: 2, outcome: false },
    ];
    expect(
      resolutionRequest({
        propId: 41,
        choice: { mode: "resolved", outcomes },
        notes: "x",
      }),
    ).toEqual({
      kind: "resolve",
      args: { propId: 41, outcomes, notes: "x", overwrite: true },
    });
    expect(
      resolutionRequest({ propId: 41, binaryChoice: "unresolved", notes: "x" }),
    ).toEqual({ kind: "unresolve", args: { propId: 41 } });
  });
});
