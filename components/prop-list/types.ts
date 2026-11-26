export type PropKind = "binary" | "one_of" | "any_of";

/** One option of a choice prop, as the list renders it. */
export interface OptionView {
  optionId: number;
  text: string;
  /** The viewer's probability; null if they never forecasted. */
  yourForecast: number | null;
  communityAverage: number | null;
  /** Null while the prop is unresolved. */
  outcome: boolean | null;
}

/**
 * A prop as the unresolved and resolved lists render it. Deliberately one
 * shape for both: the only difference is whether the outcome fields are set,
 * so a layout that handles this handles both pages.
 */
export interface PropView {
  propId: number;
  text: string;
  category: string | null;
  kind: PropKind;
  /** Binary props only; null for choice kinds, which carry per-option values. */
  yourForecast: number | null;
  communityAverage: number | null;
  /** Binary props only; null while unresolved. */
  outcome: boolean | null;
  /** Empty for binary props. */
  options: OptionView[];
  /** True once a resolution exists, for every kind, including a void. */
  resolved: boolean;
  /** Settled with no outcome; scored for nobody. */
  voided: boolean;
  /** When forecasting closed. */
  closedAt: Date | null;
}

/**
 * The per-prop Brier score, on the 0–1 scale, matching v_forecasts.score:
 * binary is (outcome − p)²; one_of is half the multi-category Brier; any_of is
 * the mean of the per-option Briers. Returns null when the prop is unresolved
 * or the viewer never forecasted, since there is nothing to score.
 */
export function penaltyOf(prop: PropView): number | null {
  if (!prop.resolved || prop.voided) return null;

  if (prop.kind === "binary") {
    if (prop.yourForecast === null || prop.outcome === null) return null;
    return (Number(prop.outcome) - prop.yourForecast) ** 2;
  }

  const scored = prop.options.filter(
    (o) => o.yourForecast !== null && o.outcome !== null,
  );
  if (scored.length === 0) return null;

  const total = scored.reduce(
    (sum, o) => sum + (Number(o.outcome) - o.yourForecast!) ** 2,
    0,
  );
  return prop.kind === "one_of" ? total * 0.5 : total / scored.length;
}

/** How a choice prop's options relate to each other — the scoring rule differs. */
export const KIND_LABEL: Record<PropKind, string | null> = {
  binary: null,
  one_of: "One of",
  any_of: "Any of",
};

/** Every row a layout has to draw for one prop: one for binary, N for choice. */
export interface Line {
  key: string;
  /** The claim being scored. For a choice prop, the option's text. */
  label: string;
  yourForecast: number | null;
  communityAverage: number | null;
  outcome: boolean | null;
}

export function linesOf(prop: PropView): Line[] {
  if (prop.kind === "binary") {
    return [
      {
        key: `p${prop.propId}`,
        label: prop.text,
        yourForecast: prop.yourForecast,
        communityAverage: prop.communityAverage,
        outcome: prop.outcome,
      },
    ];
  }
  return prop.options.map((o) => ({
    key: `o${o.optionId}`,
    label: o.text,
    yourForecast: o.yourForecast,
    communityAverage: o.communityAverage,
    outcome: o.outcome,
  }));
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
