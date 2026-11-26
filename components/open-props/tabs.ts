/**
 * The filter bar's vocabulary, kept out of the component so it can be tested.
 *
 * `open-props.tsx` reaches the database through `@/lib/db_actions`, which a
 * unit test cannot import; see the note in CLAUDE.md.
 */
import { getPropStatusFromProp } from "@/lib/prop-status";
import type { PropWithUserForecast } from "@/types/db_types";

/**
 * What the filter bar offers, which depends on what the list holds.
 *
 * A competition's open list is already filtered to open props, so the only
 * useful cut is how far the reader has got: `forecast`. A personal list holds
 * every prop its author ever wrote, at every stage of its life, so the useful
 * cut is the stage: `stage`.
 */
export type Tabs = "forecast" | "stage";

export type Choice = "todo" | "done" | "open" | "scoring" | "final" | "all";

export const CHOICES: Record<Tabs, { id: Choice; label: string }[]> = {
  forecast: [
    { id: "todo", label: "To do" },
    { id: "done", label: "Done" },
    { id: "all", label: "All" },
  ],
  // The same three words the season stamp uses, so a reader meets one
  // vocabulary for "where is this in its life" across the app.
  stage: [
    { id: "open", label: "Open" },
    { id: "scoring", label: "Scoring" },
    { id: "final", label: "Final" },
    { id: "all", label: "All" },
  ],
};

/**
 * Where the chosen subset is kept.
 *
 * In the query string rather than in component state, so a filtered list is a
 * link: it can be sent to someone, bookmarked, or returned to. The default is
 * written as the absence of the parameter, which keeps the plain URL canonical.
 */
export const TAB_PARAM = "tab";

/** Which choice a list starts on. */
export const DEFAULT_CHOICE: Record<Tabs, Choice> = {
  // The competition list leads with the work outstanding.
  forecast: "todo",
  // A personal list is a record as much as a to-do, so it leads with all of it.
  stage: "all",
};

/**
 * The choice a URL is asking for, or the list's default.
 *
 * Read back through the offered choices so a hand-typed or stale value —
 * `?tab=scoring` on a list that only offers to-do/done — falls back to the
 * default instead of filtering everything away with no cell lit.
 */
export function resolveChoice(tabs: Tabs, asked: string | null): Choice {
  return CHOICES[tabs].find((c) => c.id === asked)?.id ?? DEFAULT_CHOICE[tabs];
}

/**
 * How far the reader has got: props they have forecast, out of those that
 * want a forecast. A voided prop wants none, so it counts on neither side.
 */
export function forecastProgress(props: PropWithUserForecast[]): {
  done: number;
  total: number;
} {
  const counted = props.filter((p) => p.resolution_voided !== true);
  return {
    done: counted.filter((p) => p.user_forecast_id !== null).length,
    total: counted.length,
  };
}

/** Whether a prop belongs in the chosen subset. */
export function matches(choice: Choice, prop: PropWithUserForecast): boolean {
  if (choice === "all") return true;
  // `user_forecast_id`, not `user_forecast`: the latter is null for a choice
  // prop even once every option has been answered.
  if (choice === "todo") return prop.user_forecast_id === null;
  if (choice === "done") return prop.user_forecast_id !== null;

  const status = getPropStatusFromProp(prop);
  if (choice === "open") return status === "open";
  if (choice === "scoring") return status === "unresolved";
  return status !== "open" && status !== "unresolved";
}
