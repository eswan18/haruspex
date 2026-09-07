import type { SuggestedPropStatus, VSuggestedProp } from "@/types/db_types";

/**
 * Which slice of the reviewed suggestions the URL is asking for. Null is the
 * default: the reviewed section stays shut.
 *
 * One parameter carries both questions -- whether the section is open, and
 * what it shows -- because they are the same question. There is no state where
 * the section is open and showing nothing.
 */
export type ReviewedFilter = "all" | SuggestedPropStatus;

export const REVIEWED_PARAM = "reviewed";

const FILTERS: ReviewedFilter[] = ["all", "accepted", "rejected"];

/**
 * Read the filter off the URL.
 *
 * Anything but the three exact strings reads as the default, so a hand-typed
 * or stale parameter collapses the section rather than opening it onto an
 * empty list -- the same rule `wantsAll` follows in the dashboard.
 */
export function reviewedFilterOf(
  params: Record<string, string | string[] | undefined>,
): ReviewedFilter | null {
  const asked = params[REVIEWED_PARAM];
  const value = Array.isArray(asked) ? asked[0] : asked;
  return FILTERS.find((f) => f === value) ?? null;
}

export interface ReviewQueue {
  /** Undecided, oldest first: the queue is worked from the top. */
  pending: VSuggestedProp[];
  /** What the reviewed section shows, most recent decision first. */
  reviewed: VSuggestedProp[];
  /**
   * Every reviewed suggestion, not just the shown ones. The disclosure label
   * counts the whole section, so narrowing the filter must not shrink it.
   */
  reviewedCount: number;
}

/** Split the queue into what still needs a decision and what has had one. */
export function partitionQueue(
  suggestions: VSuggestedProp[],
  filter: ReviewedFilter | null,
): ReviewQueue {
  const pending = suggestions.filter((s) => s.status === null);
  const allReviewed = suggestions.filter((s) => s.status !== null);

  const reviewed =
    filter === null
      ? []
      : allReviewed
          .filter((s) => filter === "all" || s.status === filter)
          .sort(byMostRecentDecision);

  return { pending, reviewed, reviewedCount: allReviewed.length };
}

/** A reviewed row always has a decided_at -- the DB constraint guarantees it. */
function byMostRecentDecision(a: VSuggestedProp, b: VSuggestedProp): number {
  return (b.decided_at?.getTime() ?? 0) - (a.decided_at?.getTime() ?? 0);
}
