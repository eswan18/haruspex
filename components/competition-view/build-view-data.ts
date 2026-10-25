import { seasonStateOf } from "@/components/competition-stamp/competition-stamp";
import {
  getCompetitionStatus,
  type CompetitionStatus,
} from "@/lib/competition-status";
import type { CompetitionScore } from "@/lib/db_actions";
import type { Competition, PropWithUserForecast } from "@/types/db_types";
import type { CompetitionViewData, SeasonPhase, Standing } from "./types";

/**
 * Five statuses collapse to the three phases the page distinguishes. Same
 * mapping the dashboard uses: `forecasts-closed` is NOT archive — forecasting
 * has shut but props are still resolving, so scores still move.
 */
const PHASE_OF: Record<CompetitionStatus, SeasonPhase> = {
  "forecasts-open": "live",
  private: "live",
  "forecasts-closed": "scoring",
  ended: "final",
  // Only admins can open an upcoming competition; nothing about it is live
  // yet, so it leads with its (empty) prop list rather than a scoreboard.
  upcoming: "live",
};

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

/**
 * Flatten the route's server-action results into the one shape every layout
 * takes. Pure, so the mapping is testable and the layouts stay presentational.
 */
export function buildViewData({
  competition,
  props,
  scores,
  fieldSize,
  currentUserId,
  now,
}: {
  competition: Competition;
  props: PropWithUserForecast[];
  scores: CompetitionScore;
  /** Members for a private competition; scored forecasters for a public one. */
  fieldSize: number;
  currentUserId: number;
  now: Date;
}): CompetitionViewData {
  const isPrivate = competition.is_private;

  const isOpen = (p: PropWithUserForecast) => {
    const d = closeDateOf(p, isPrivate);
    return d === null || new Date(d) > now;
  };
  const isResolved = (p: PropWithUserForecast) => p.resolution_id !== null;

  const openProps = props.filter(isOpen);
  const resolved = props.filter(isResolved);
  const unresolved = props.filter((p) => !isOpen(p) && !isResolved(p));

  // Soonest deadline first; a prop with no deadline sorts last since there is
  // no urgency to convey.
  const owed = openProps
    .filter((p) => p.user_forecast_id === null)
    .map((p) => ({
      propId: p.prop_id,
      propText: p.prop_text,
      deadline: closeDateOf(p, isPrivate),
      hasUserForecast: false,
    }))
    .sort((a, b) => {
      if (a.deadline === null) return b.deadline === null ? 0 : 1;
      if (b.deadline === null) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  const incomplete = new Set(scores.incompleteUserIds);
  const standings: Standing[] = [...scores.overallScores]
    // Brier: lower is better, so the leaders are the smallest scores.
    .sort((a, b) => a.score - b.score)
    .map((s) => ({
      userId: s.userId,
      userName: s.userName,
      score: s.score,
      incomplete: incomplete.has(s.userId),
    }));

  // Rank is among complete forecasters only — a partial-set Brier score isn't
  // comparable, so mixing them would report a rank that means nothing.
  const comparable = standings.filter((s) => !s.incomplete);
  const myIndex = comparable.findIndex((s) => s.userId === currentUserId);
  const me = standings.find((s) => s.userId === currentUserId);

  const status = getCompetitionStatus(
    competition.forecasts_open_date,
    competition.forecasts_close_date,
    competition.end_date,
    now,
  );

  return {
    id: competition.id,
    name: competition.name,
    isPrivate,
    phase: PHASE_OF[status],
    state: seasonStateOf(status),
    fieldSize,
    counts: {
      toForecast: owed.length,
      open: openProps.length,
      unresolved: unresolved.length,
      resolved: resolved.length,
      total: props.length,
    },
    you:
      myIndex === -1
        ? null
        : {
            rank: myIndex + 1,
            score: comparable[myIndex].score,
            incomplete: me?.incomplete ?? false,
          },
    owed,
    standings,
  };
}
