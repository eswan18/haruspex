import { getCompetitions, getCompetitionScores } from "@/lib/db_actions";
import { getRecentlyResolvedForecasts } from "@/lib/db_actions";
import { getCompetitionStatusFromObject } from "@/lib/competition-status";
import { isBinaryForecast } from "@/lib/binary-forecast";
import type { VUser } from "@/types/db_types";
import {
  DashboardView,
  type ResolvedItem,
  type Standing,
} from "./dashboard-view";
import { buildStanding } from "./build-standing";
import { visibleSeasons } from "./visible-seasons";

/**
 * Data for the signed-in dashboard. Presentation lives in dashboard-view.tsx,
 * which takes plain data so it can be rendered from fixtures.
 */
async function loadStandings(userId: number, now: Date): Promise<Standing[]> {
  const competitionsResult = await getCompetitions();
  if (!competitionsResult.success) return [];

  const visible = competitionsResult.data.filter(
    (c) => getCompetitionStatusFromObject(c, now) !== "upcoming",
  );

  const standings = await Promise.all(
    visible.map(async (competition): Promise<Standing | null> => {
      const scoresResult = await getCompetitionScores({
        competitionId: competition.id,
      });
      if (!scoresResult.success) return null;

      return buildStanding({
        competition,
        scores: scoresResult.data,
        currentUserId: userId,
        now,
      });
    }),
  );

  return standings.filter((s): s is Standing => s !== null);
}

export async function RisoDashboard({
  user,
  showAll = false,
}: {
  user: VUser;
  /** From `?show=all`: list finished seasons as well as the ones in play. */
  showAll?: boolean;
}) {
  // One clock for the whole render, so two seasons can't disagree about now.
  const now = new Date();
  const [standings, resolvedResult] = await Promise.all([
    loadStandings(user.id, now),
    getRecentlyResolvedForecasts({ userId: user.id, limit: 4 }),
  ]);

  // Choice props render as binary only for now, matching the old dashboard.
  const resolved: ResolvedItem[] = resolvedResult.success
    ? resolvedResult.data.filter(isBinaryForecast).map((f) => ({
        forecastId: f.forecast_id,
        propId: f.prop_id,
        propText: f.prop_text,
        forecast: f.forecast!,
        resolution: f.resolution!,
      }))
    : [];

  const shown = visibleSeasons(standings, showAll);

  return (
    <DashboardView
      standings={shown}
      resolved={resolved}
      showAll={showAll}
      hiddenCount={standings.length - shown.length}
    />
  );
}
