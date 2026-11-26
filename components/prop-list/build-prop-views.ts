import type { PropWithUserForecast } from "@/types/db_types";
import type { PropKind, PropView } from "./types";

/**
 * A prop's effective deadline. Private competitions carry no competition-level
 * dates and run off per-prop ones instead.
 */
function closeDateOf(
  prop: PropWithUserForecast,
  isPrivate: boolean,
): Date | null {
  return isPrivate
    ? prop.prop_forecasts_due_date
    : prop.competition_forecasts_close_date;
}

/** Flatten the route's props into the one shape every layout takes. */
export function buildPropViews({
  props,
  isPrivate,
}: {
  props: PropWithUserForecast[];
  isPrivate: boolean;
}): PropView[] {
  return props.map((p) => ({
    propId: p.prop_id,
    text: p.prop_text,
    category: p.category_name,
    kind: p.prop_kind as PropKind,
    yourForecast: p.user_forecast,
    communityAverage: p.community_average,
    outcome: p.resolution,
    options: p.options.map((o) => ({
      optionId: o.option_id,
      text: o.text,
      yourForecast: o.user_forecast,
      communityAverage: o.community_average,
      outcome: o.outcome,
    })),
    // `resolution_id` is the "is resolved" flag for every kind: a resolved
    // choice prop has a null `resolution`, with the outcomes on its options.
    resolved: p.resolution_id !== null,
    voided: p.resolution_voided === true,
    closedAt: closeDateOf(p, isPrivate),
  }));
}

/** Past its deadline and still unresolved. */
export function awaitingResult(
  props: PropWithUserForecast[],
  isPrivate: boolean,
  now: Date,
): PropWithUserForecast[] {
  return props.filter((p) => {
    const d = closeDateOf(p, isPrivate);
    return d !== null && new Date(d) <= now && p.resolution_id === null;
  });
}

export function resolvedProps(
  props: PropWithUserForecast[],
): PropWithUserForecast[] {
  return props.filter((p) => p.resolution_id !== null);
}
