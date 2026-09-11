/**
 * Competition status utilities
 *
 * This module provides centralized logic for determining competition status
 * based on forecast due dates and end dates.
 */

export type CompetitionStatus =
  | "upcoming"
  | "forecasts-open"
  | "forecasts-closed"
  | "ended"
  | "private"; // Private competitions don't have competition-level dates

/**
 * Where a competition sits relative to now.
 *
 * Null dates mean a private competition, whose deadlines live on each prop
 * rather than the season — so it has no timeline of its own to place.
 */
export function getCompetitionStatus(
  forecastsOpenDate: Date | null,
  forecastsCloseDate: Date | null,
  endDate: Date | null,
  currentDate: Date = new Date(),
): CompetitionStatus {
  // Private competitions have null dates - they use per-prop dates instead
  if (
    forecastsOpenDate === null ||
    forecastsCloseDate === null ||
    endDate === null
  ) {
    return "private";
  }

  if (currentDate < forecastsOpenDate) {
    return "upcoming";
  } else if (currentDate < forecastsCloseDate) {
    return "forecasts-open";
  } else if (currentDate < endDate) {
    return "forecasts-closed";
  } else {
    return "ended";
  }
}

type SeasonDates = {
  forecasts_open_date: Date | null;
  forecasts_close_date: Date | null;
  end_date: Date | null;
};

/**
 * Whether a competition's deadlines live on each prop rather than on the
 * season. The same null test as `getCompetitionStatus`, asked directly.
 *
 * Today this is exactly the private competitions: check constraints give every
 * public one season dates and no private one any. It is written in terms of
 * dates rather than `is_private` so it stays right if that pairing changes.
 */
export function schedulesByProp(competition: SeasonDates): boolean {
  return (
    competition.forecasts_open_date === null ||
    competition.forecasts_close_date === null ||
    competition.end_date === null
  );
}

/** Who hears about a new prop. Each kind has a resolver in lib/notifications. */
export type NewPropAudience = "members";

/**
 * Who should be emailed when a prop is added to this competition, or null for
 * nobody.
 *
 * Only a competition that schedules by prop announces its props: each one opens
 * on its own, so its arrival is news. A season with one shared timeline opens
 * all its props together and has nothing to say about any single one.
 *
 * The new-prop form (whether to offer the "email members" box) and createProp
 * (whether to send) both ask this, so they cannot disagree.
 *
 * FUTURE PLAN: announcements should extend to every competition that schedules
 * by prop, public ones included. That is blocked on two things, not one:
 *   1. The `public_competitions_require_dates` check constraint, which today
 *      gives every public competition season dates, so none schedules by prop.
 *   2. An audience. A public competition has no members (a trigger rejects
 *      the rows), so there is no one to send to yet. Deciding who that is
 *      (everyone who has forecast in the competition? users who opted in?)
 *      is the real design question.
 * When both are settled, add a kind to `NewPropAudience` (e.g. "forecasters"),
 * return it from the public branch below, and give it a resolver in
 * `lib/notifications/prop-added.ts`. The form, the server action and the
 * event need no changes.
 */
export function newPropAudience(
  competition: SeasonDates & { is_private: boolean },
): NewPropAudience | null {
  if (!schedulesByProp(competition)) return null;
  // Public by-prop competitions: see FUTURE PLAN above.
  return competition.is_private ? "members" : null;
}

/**
 * `getCompetitionStatus` for a competition-shaped object rather than loose dates.
 */
export function getCompetitionStatusFromObject(
  competition: {
    forecasts_open_date: Date | null;
    forecasts_close_date: Date | null;
    end_date: Date | null;
  },
  currentDate: Date = new Date(),
): CompetitionStatus {
  return getCompetitionStatus(
    competition.forecasts_open_date,
    competition.forecasts_close_date,
    competition.end_date,
    currentDate,
  );
}
