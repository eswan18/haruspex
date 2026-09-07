import {
  getCompetitionStatusFromObject,
  type CompetitionStatus,
} from "@/lib/competition-status";
import { rankForecasters } from "@/lib/leaderboard";
import type { CompetitionScore } from "@/lib/db_actions";
import type { Competition } from "@/types/db_types";
import type { SeasonPhase, Standing } from "./dashboard-view";

/**
 * Five statuses collapse to the three the dashboard distinguishes. Note that
 * `forecasts-closed` is NOT archive: forecasting has shut but props are still
 * resolving, so the standing is still moving and the season stays featured.
 * `private` competitions carry no competition-level dates and run off per-prop
 * ones, so they count as live.
 */
const PHASE_OF: Record<CompetitionStatus, SeasonPhase> = {
  "forecasts-open": "live",
  private: "live",
  "forecasts-closed": "scoring",
  ended: "final",
  // never reaches here -- upcoming competitions are filtered out upstream
  upcoming: "final",
};

/**
 * One season's line on the dashboard. Pure, so the ranking is testable without
 * transitively importing `lib/database.ts`.
 *
 * Partial forecasters are never ranked — same rule the competition page runs
 * on (`rankStandings` in components/competition-view/sheet.tsx). A Brier score
 * averaged over some of the props isn't comparable to one averaged over all of
 * them, so letting a partial set into the leaders, or count ahead of you in the
 * order, reports a placing that means nothing. That cuts both ways: a viewer
 * whose own set is partial gets no rank here either, and their season
 * compresses to a row.
 */
export function buildStanding({
  competition,
  scores,
  currentUserId,
  now,
}: {
  competition: Competition;
  scores: CompetitionScore;
  currentUserId: number;
  /** Fixed by the caller, so every season on one dashboard reads the same clock. */
  now: Date;
}): Standing {
  const ranked = rankForecasters({
    overallScores: scores.overallScores,
    incompleteUserIds: scores.incompleteUserIds,
    currentUserId,
    showIncomplete: false,
  });
  const mine = ranked.find((s) => s.isCurrentUser);

  return {
    id: competition.id,
    name: competition.name,
    phase: PHASE_OF[getCompetitionStatusFromObject(competition, now)],
    isPrivate: competition.is_private,
    leaders: ranked.slice(0, 3),
    you: mine ? { rank: mine.rank, score: mine.score } : null,
    fieldSize: ranked.length,
  };
}
