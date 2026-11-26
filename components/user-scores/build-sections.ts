import type { UserCategoryScore, UserForecastScore } from "@/lib/db_actions";
import type { PropKind, PropView } from "@/components/prop-list/types";
import type { ScoreSection } from "./user-scores";

/** One resolved forecast, in the shape the shared axis draws. */
function toPropView(f: UserForecastScore): PropView {
  return {
    propId: f.propId,
    text: f.propText,
    category: f.categoryName,
    kind: f.kind as PropKind,
    yourForecast: f.forecast,
    // This endpoint carries no community average, so no field tick is drawn.
    communityAverage: null,
    outcome: f.resolution,
    options: f.options.map((o, i) => ({
      optionId: i,
      text: o.text,
      yourForecast: o.userForecast,
      communityAverage: null,
      outcome: o.outcome,
    })),
    resolved: true,
    // Only scored forecasts reach this sheet, and a void is scored for nobody.
    voided: false,
    closedAt: null,
  };
}

/**
 * Group a forecaster's resolved forecasts into category sections.
 *
 * Cheapest first, at both levels: the sheet reads as a run of forecasts that
 * cost almost nothing, ending in the ones that hurt — which puts the worst
 * calls where the eye stops rather than where it starts.
 */
export function buildSections({
  forecastScores,
  categoryScores,
}: {
  forecastScores: UserForecastScore[];
  categoryScores: UserCategoryScore[];
}): ScoreSection[] {
  const byCategory = new Map<string, UserForecastScore[]>();
  for (const f of forecastScores) {
    const key = f.categoryId === null ? "uncategorised" : String(f.categoryId);
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(f);
    else byCategory.set(key, [f]);
  }

  const scoreOf = new Map(
    categoryScores.map((cs) => [String(cs.categoryId), cs.score]),
  );
  const labelOf = new Map(
    forecastScores
      .filter((f) => f.categoryId !== null)
      .map((f) => [String(f.categoryId), f.categoryName ?? "Uncategorised"]),
  );

  return [...byCategory.entries()]
    .map(([key, forecasts]): ScoreSection => {
      const sorted = [...forecasts].sort(
        (a, b) => (a.score ?? 0) - (b.score ?? 0),
      );
      return {
        key,
        label:
          key === "uncategorised"
            ? "Uncategorised"
            : (labelOf.get(key) ?? "Uncategorised"),
        score: scoreOf.get(key) ?? null,
        props: sorted.map(toPropView),
        penalties: Object.fromEntries(
          forecasts.map((f) => [f.propId, f.score]),
        ),
      };
    })
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
}

/** Every forecast on one list, cheapest first, with no category breaks. */
export function buildFlat({
  forecastScores,
}: {
  forecastScores: UserForecastScore[];
}): ScoreSection {
  const sorted = [...forecastScores].sort(
    (a, b) => (a.score ?? 0) - (b.score ?? 0),
  );
  return {
    key: "all",
    label: "",
    score: null,
    props: sorted.map(toPropView),
    penalties: Object.fromEntries(
      forecastScores.map((f) => [f.propId, f.score]),
    ),
  };
}
