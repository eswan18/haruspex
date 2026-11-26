import type { OptionOutcome } from "@/lib/choice-forecast";

/**
 * The resolution dialog's choices and what they ask the server for, kept apart
 * from the dialog so they can be tested without its server actions (which
 * reach the database module at import).
 */

/** A yes/no prop's radios. */
export type BinaryChoice = "true" | "false" | "void" | "unresolved";
/** A choice prop's radios; "resolved" goes on to pick the outcomes. */
export type ChoiceMode = "resolved" | "void" | "unresolved";

type Settled = {
  resolution_id: number | null;
  resolution: boolean | null;
  resolution_voided: boolean | null;
};

export function initialBinaryChoice(prop: Settled): BinaryChoice {
  if (prop.resolution_voided) return "void";
  if (prop.resolution === null) return "unresolved";
  return prop.resolution ? "true" : "false";
}

/**
 * A resolved choice prop carries a null `resolution` on its header row, so
 * whether it is resolved comes from `resolution_id`.
 */
export function initialChoiceMode(prop: Settled): ChoiceMode {
  if (prop.resolution_voided) return "void";
  return prop.resolution_id === null ? "unresolved" : "resolved";
}

export type ResolutionRequest =
  | { kind: "unresolve"; args: { propId: number } }
  | {
      kind: "resolve";
      args: {
        propId: number;
        resolution?: boolean;
        outcomes?: OptionOutcome[];
        voided?: true;
        notes: string | undefined;
        overwrite: true;
      };
    };

/**
 * What submitting asks for. The dialog always overwrites: it is where a
 * resolution gets corrected, a void included.
 */
export function resolutionRequest({
  propId,
  notes,
  ...state
}: {
  propId: number;
  notes: string;
} & (
  | { binaryChoice: BinaryChoice }
  | { choice: { mode: ChoiceMode; outcomes: OptionOutcome[] } }
)): ResolutionRequest {
  const mode =
    "choice" in state
      ? state.choice.mode
      : state.binaryChoice === "true" || state.binaryChoice === "false"
        ? "resolved"
        : state.binaryChoice;
  if (mode === "unresolved") return { kind: "unresolve", args: { propId } };

  const common = {
    propId,
    notes: notes.trim() || undefined,
    overwrite: true as const,
  };
  if (mode === "void") {
    return { kind: "resolve", args: { ...common, voided: true } };
  }
  if ("choice" in state) {
    return {
      kind: "resolve",
      args: { ...common, outcomes: state.choice.outcomes },
    };
  }
  return {
    kind: "resolve",
    args: { ...common, resolution: state.binaryChoice === "true" },
  };
}
