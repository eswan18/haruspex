import Link from "next/link";

import { InaccessiblePage } from "@/components/inaccessible-page";
import { sheetCss } from "@/components/prop-list/sheet";
import {
  getCompetitions,
  getForecasts,
  getUnforecastedProps,
  getUsers,
} from "@/lib/db_actions";
import { logger } from "@/lib/logger";
import { handleServerActionResult } from "@/lib/server-action-helpers";
import { VUser } from "@/types/db_types";

import { COMPETITION_PARAM, CompetitionPicker } from "./competition-picker";
import { ErrorToast } from "./error-toast";
import { ForecastProgressMeter, meterCss } from "./forecast-progress-meter";
import { userProgress } from "./progress";

const ownCss = `
/* The page's one figure, set the way every sheet sets the argument it opens
   with. No ghost offset behind it: the red second ink is spoken for on this
   page, where it means a row that could not be loaded, and a decorative red
   under the headline would spend that meaning on nothing. */
.hxp .tally {
  padding-top: 1.5rem;
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  flex-wrap: wrap;
}
.hxp .tally .big {
  font-weight: 800;
  font-size: clamp(3rem, 7.5vw, 4.75rem);
  line-height: 0.85;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
}
.hxp .tally .of {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
.hxp .tally .of .val { color: var(--ink); }
.hxp .failed { color: var(--red-text); padding-top: 1.25rem; }

/* The season picker: one control on a row of its own, left where the sheet's
   other choosers sit. The filter controls are styled in globals as .riso-pick. */
.hxp .pickrow {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding-top: 1.5rem;
}

/* One grid for the whole board, so the marks line up down the page and not
   merely across each row. */
.hxp .cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem 4rem 4rem;
  gap: 0 1.25rem;
  align-items: center;
}
.hxp .head {
  padding: 1.5rem 0 0.5rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .head .lbl {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .head .lbl.r { text-align: right; }
.hxp .head .ticks {
  position: relative;
  height: 1rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.hxp .head .ticks span { position: absolute; bottom: 0; white-space: nowrap; }
.hxp .head .ticks .mid { transform: translateX(-50%); color: var(--ink-muted); }
.hxp .head .ticks .hi { transform: translateX(-100%); color: var(--ink-muted); }

.hxp .row {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .row .name { font-size: 0.9375rem; }
.hxp .row .n {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
/* The exception is marked and the rule stays silent: a row whose counts are
   missing is greyed and flagged, everything else is simply set. */
.hxp .row.nodata .name,
.hxp .row.nodata .n { color: var(--ink-muted); }
.hxp .row .flag {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--red-text);
  margin-left: 0.75rem;
}

/* On a phone the axis takes a line of its own and the name keeps its counts
   on the line above, exactly as the standings do. The counts are placed
   explicitly because they follow the axis in the markup and auto-placement
   would otherwise push them onto a third line. */
@media (max-width: 46rem) {
  .hxp .cols {
    grid-template-columns: minmax(0, 1fr) 3rem 3rem;
    gap: 0.25rem 0.75rem;
  }
  .hxp .meter { grid-column: 1 / -1; grid-row: 2; }
  .hxp .head .ticks { grid-column: 1 / -1; grid-row: 2; }
  .hxp .head .lbl.r { grid-row: 1; }
  .hxp .row .n { grid-row: 1; }
  .hxp .row { padding: 1rem 0 0.375rem; }
}
`;

/**
 * How far every forecaster has got, for one season at a time.
 *
 * The season is chosen on the page rather than named in the path. It used to be
 * a route parameter, which meant the three links to this page each carried a
 * hardcoded competition id and the page could only ever report on that one
 * season until somebody edited the links.
 */
export default async function ForecastProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const competitionsResult = await getCompetitions();
  if (!competitionsResult.success) {
    return (
      <InaccessiblePage
        title="Competitions unavailable"
        message={competitionsResult.error}
      />
    );
  }
  const competitions = competitionsResult.data;
  if (competitions.length === 0) {
    return (
      <InaccessiblePage
        title="No competitions"
        message="There is nothing to report progress on yet."
      />
    );
  }

  // `getCompetitions` orders by name descending, so the first row is the
  // latest season — the one an admin chasing forecasts almost always wants.
  // An unknown or missing id falls back to it rather than erroring.
  const asked = Number(
    Array.isArray(params[COMPETITION_PARAM])
      ? params[COMPETITION_PARAM][0]
      : params[COMPETITION_PARAM],
  );
  const competition =
    competitions.find((c) => c.id === asked) ?? competitions[0];
  const competitionId = competition.id;

  const usersResult = await getUsers();
  const users = handleServerActionResult(usersResult);

  const unforecastedPropsResults = await Promise.all(
    users.map(async (user) => {
      const result = await getUnforecastedProps({
        userId: user.id,
        competitionId,
      });
      return {
        userId: user.id,
        result,
      };
    }),
  );
  const forecastedPropsResults = await Promise.all(
    users.map(async (user) => {
      const result = await getForecasts({ userId: user.id, competitionId });
      return {
        userId: user.id,
        result,
      };
    }),
  );

  // Check for errors and log them
  const unforecastedErrors = unforecastedPropsResults.filter(
    (r) => !r.result.success,
  );
  const forecastedErrors = forecastedPropsResults.filter(
    (r) => !r.result.success,
  );
  const hasErrors =
    unforecastedErrors.length > 0 || forecastedErrors.length > 0;

  if (hasErrors) {
    unforecastedErrors.forEach(({ userId, result }) => {
      if (!result.success) {
        logger.warn("Failed to load unforecasted props", {
          userId,
          competitionId,
          error: result.error,
        });
      }
    });
    forecastedErrors.forEach(({ userId, result }) => {
      if (!result.success) {
        logger.warn("Failed to load forecasts", {
          userId,
          competitionId,
          error: result.error,
        });
      }
    });
  }

  const metrics: UserProgressMetrics[] = users.map((user) => {
    const unforecasted = unforecastedPropsResults.find(
      (u) => u.userId === user.id,
    );
    const forecasted = forecastedPropsResults.find((u) => u.userId === user.id);
    return {
      user,
      // Both halves have to have landed for the row's counts to mean anything.
      loaded: !!unforecasted?.result.success && !!forecasted?.result.success,
      ...userProgress({
        forecasts: forecasted?.result.success ? forecasted.result.data : [],
        unforecasted: unforecasted?.result.success
          ? unforecasted.result.data.length
          : 0,
      }),
    };
  });

  // Calculate summary statistics
  const totalUsers = metrics.length;
  const totalForecasted = metrics.reduce((sum, m) => sum + m.forecasted, 0);
  const totalUnforecasted = metrics.reduce((sum, m) => sum + m.unforecasted, 0);
  const totalProps = totalForecasted + totalUnforecasted;
  const overallProgress = totalProps > 0 ? totalForecasted / totalProps : 0;
  const usersFinished = metrics.filter((m) => m.percentComplete === 1).length;
  const notLoaded = metrics.filter((m) => !m.loaded).length;
  // Every forecaster faces the same props, so the count only needs printing
  // once — in the head, not on every row.
  const propCount = metrics.reduce(
    (n, m) => Math.max(n, m.forecasted + m.unforecasted),
    0,
  );

  // Furthest behind first: this page is opened to find out who needs chasing,
  // and getUsers() returns no order of its own to preserve. Rows whose counts
  // are missing sort last — they are not known to be behind, only unknown.
  const rows = [...metrics].sort((a, b) => {
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
    if (a.percentComplete !== b.percentComplete)
      return a.percentComplete - b.percentComplete;
    return a.user.name.localeCompare(b.user.name);
  });

  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{ __html: sheetCss + meterCss + ownCss }}
      />
      <div className="col">
        <ErrorToast hasErrors={hasErrors} />

        <header className="masthead">
          <h1>Forecast progress</h1>
        </header>

        <h2 className="kicker">
          <span>
            <Link href={`/competitions/${competitionId}`}>
              {competition.name}
            </Link>
            <span className="aside num">
              {" "}
              · {totalUsers} forecaster{totalUsers === 1 ? "" : "s"} ·{" "}
              {propCount} prop{propCount === 1 ? "" : "s"}
            </span>
          </span>
          <Link className="aside" href="/admin">
            ← Admin
          </Link>
        </h2>

        <div className="pickrow">
          <CompetitionPicker
            competitions={competitions.map((c) => ({
              id: c.id,
              name: c.name,
            }))}
            selectedId={competitionId}
          />
        </div>

        {totalUsers === 0 ? (
          <p className="lede">There are no forecasters to report on.</p>
        ) : (
          <>
            <div className="tally">
              <span className="big">{(overallProgress * 100).toFixed(0)}%</span>
              <span className="of">
                <span className="val">{totalForecasted}</span> of {totalProps}{" "}
                forecasts made · <span className="val">{usersFinished}</span> of{" "}
                {totalUsers} finished
              </span>
            </div>

            {hasErrors && (
              <p className="failed">
                {notLoaded} forecaster{notLoaded === 1 ? "" : "s"} could not be
                loaded — marked no data below. Check the server logs.
              </p>
            )}

            <div className="cols head">
              <span className="lbl">Forecaster</span>
              <div className="ticks">
                <span>0%</span>
                <span className="mid" style={{ left: "50%" }}>
                  50%
                </span>
                <span className="hi" style={{ left: "100%" }}>
                  100%
                </span>
              </div>
              <span className="lbl r">Made</span>
              <span className="lbl r">Left</span>
            </div>

            {rows.map((m) => (
              <UserMetricsRow key={m.user.id} metrics={m} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface UserProgressMetrics {
  user: VUser;
  /** False when either half of this user's counts failed to load. */
  loaded: boolean;
  unforecasted: number;
  forecasted: number;
  percentComplete: number;
}

function UserMetricsRow({ metrics }: { metrics: UserProgressMetrics }) {
  const { user, loaded, forecasted, unforecasted, percentComplete } = metrics;

  return (
    <div className={loaded ? "cols row" : "cols row nodata"}>
      <span className="name">
        {user.name}
        {!loaded && <span className="flag">no data</span>}
      </span>
      <ForecastProgressMeter value={loaded ? percentComplete : null} />
      <span className="n">
        {loaded ? forecasted : <span className="none">—</span>}
      </span>
      <span className="n">
        {loaded && unforecasted > 0 ? (
          unforecasted
        ) : (
          <span className="none">—</span>
        )}
      </span>
    </div>
  );
}
