import Link from "next/link";

import { CompetitionStamp } from "@/components/competition-stamp/competition-stamp";
import { LocalDate } from "@/components/local-date";
import type { AdminStats } from "@/lib/admin-stats";

import { ActiveUsersChart } from "./active-users-chart";
import { BarChart } from "./bar-chart";

/**
 * The admin Stats page, on the prop-list sheet (.hxp). Figures are mono and
 * tabular like every number in the app; sections open with the 2px ink rule
 * and separate their rows with hairlines. Red is spent once, on the bar for
 * the week still being counted: "this is still live".
 */
export const statsCss = `
.hxp .figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
}
.hxp .figure {
  padding: 1.25rem 1.25rem 1.375rem 0;
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.hxp .figure .lbl,
.hxp .bars .lbl,
.hxp .stats-table th {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: 400;
}
.hxp .figure .val {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 2.25rem;
  line-height: 1;
  font-weight: 500;
}
.hxp .figure .note { font-size: 0.8125rem; color: var(--ink-muted); }

.hxp .pair {
  display: flex;
  flex-wrap: wrap;
  gap: 0 3.5rem;
}
.hxp .pair > section { flex: 1 1 28rem; min-width: 0; }

/* Column count and gap are set inline by BarChart, from its number of bars. */
.hxp .bars { display: grid; }
.hxp .bars.plot {
  align-items: end;
  height: 12.5rem;
  padding-top: 1.5rem;
  border-bottom: 1px solid var(--ink);
}
.hxp .bars .stack {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
  gap: 0.375rem;
}
.hxp .bars .n {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.625rem;
  text-align: center;
  color: var(--ink-muted);
}
.hxp .bars .bar { background: var(--ink); min-height: 1px; }
.hxp .bars .bar.live { background: var(--red); }
.hxp .bars.axis { padding-top: 0.5rem; }
.hxp .bars.axis .lbl {
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
.hxp .chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 1.5rem;
}
.hxp .chart-head .aside {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .chart-head + .bars.plot { padding-top: 1.25rem; }
/* With only every nth bar labelled, a label may spill into the unlabelled
   columns either side of it rather than be cut to its own bar's width. */
.hxp .bars.axis.sparse .lbl { overflow: visible; }
.hxp .caption {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}

.hxp .scroll { overflow-x: auto; }
.hxp .stats-table {
  width: 100%;
  min-width: 44rem;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.hxp .stats-table th { text-align: left; padding: 0.75rem 0.75rem 0.625rem; }
.hxp .stats-table td {
  padding: 0.875rem 0.75rem;
  border-top: 1px solid var(--rule);
}
.hxp .stats-table th:first-child,
.hxp .stats-table td:first-child { padding-left: 0; }
.hxp .stats-table th:last-child,
.hxp .stats-table td:last-child { padding-right: 0; }
.hxp .stats-table .r {
  text-align: right;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
.hxp .stats-table a { color: inherit; text-decoration: none; font-weight: 500; }
.hxp .stats-table a:hover { color: var(--red-text); }

.hxp .line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 1rem;
  align-items: baseline;
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .line .nm { font-weight: 500; }
.hxp .line .r {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.hxp .line .sub { font-size: 0.8125rem; color: var(--ink-muted); }
.hxp .line .sub.r { font-size: 0.75rem; }
.hxp .onward {
  display: inline-block;
  margin-top: 1rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: inherit;
  text-underline-offset: 0.2em;
}
.hxp .onward:hover { color: var(--red-text); }
`;

const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const weekFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function count(value: number, one: string, many = `${one}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

export function StatsSheet({ stats }: { stats: AdminStats }) {
  const { users, forecasts, props, competitions, suggestions } = stats;
  const figures = [
    {
      label: "Active users",
      value: users.active,
      note: `${users.deactivated.toLocaleString("en-US")} deactivated`,
    },
    {
      label: "New this month",
      value: users.newThisMonth,
      note: `${users.newLastMonth.toLocaleString("en-US")} last month`,
    },
    {
      label: "Forecasts",
      value: forecasts.total,
      note: `${forecasts.last7Days.toLocaleString("en-US")} in the last 7 days`,
    },
    {
      label: "Props",
      value: props.inCompetitions,
      note: `plus ${count(props.personal, "personal prop")}`,
    },
    {
      label: "Competitions",
      value: competitions.total,
      note: `${competitions.takingForecasts.toLocaleString("en-US")} taking forecasts`,
    },
    {
      label: "Suggestions waiting",
      value: suggestions.pending,
      note: "for review",
    },
  ];

  const { activeUsers } = stats;
  const activeFigures = [
    {
      label: "Today",
      value: activeUsers.today.toLocaleString("en-US"),
      note: "so far, UTC",
    },
    {
      label: "Last 7 days",
      value: activeUsers.last7Days.toLocaleString("en-US"),
      note: "distinct people",
    },
    {
      label: "Last 30 days",
      value: activeUsers.last30Days.toLocaleString("en-US"),
      note: "distinct people",
    },
    {
      label: "Of all accounts",
      value:
        users.active > 0
          ? `${Math.round((activeUsers.last30Days / users.active) * 100)}%`
          : "—",
      note: "30-day actives ÷ active accounts",
    },
  ];

  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: statsCss }} />
      <div className="col">
        <header className="masthead">
          <h1>Stats</h1>
          <div className="meta">
            <span>
              As of <LocalDate date={stats.asOf} includeTime />
            </span>
          </div>
        </header>

        <h2 className="kicker">
          <span>At a glance</span>
          <span className="asides">
            <Link className="aside" href="/admin">
              ← Admin
            </Link>
          </span>
        </h2>
        <div className="figures">
          {figures.map((f) => (
            <div className="figure" key={f.label}>
              <span className="lbl">{f.label}</span>
              <span className="val">{f.value.toLocaleString("en-US")}</span>
              <span className="note">{f.note}</span>
            </div>
          ))}
        </div>

        <h2 className="kicker">
          <span>Active users</span>
          <span className="aside">UTC days</span>
        </h2>
        <div className="figures">
          {activeFigures.map((f) => (
            <div className="figure" key={f.label}>
              <span className="lbl">{f.label}</span>
              <span className="val">{f.value}</span>
              <span className="note">{f.note}</span>
            </div>
          ))}
        </div>
        <ActiveUsersChart series={stats.activeUsers} />

        <div className="pair">
          <section>
            <h2 className="kicker">
              <span>Sign-ups by month</span>
              <span className="aside">Last 12, UTC</span>
            </h2>
            <BarChart
              points={stats.signupsByMonth}
              label={(d) => monthFmt.format(d)}
            />
          </section>
          <section>
            <h2 className="kicker">
              <span>People forecasting, by week</span>
              <span className="aside">Last 12, UTC</span>
            </h2>
            <BarChart
              points={stats.forecastersByWeek}
              label={(d) => weekFmt.format(d)}
              liveLast
            />
            <p className="caption">
              People who made a forecast that week, or last changed one then.
              Weeks start on Monday; the red bar is this week, still counting.
            </p>
          </section>
        </div>

        <h2 className="kicker">
          <span>Competitions</span>
          <span className="aside">{count(competitions.total, "competition")}</span>
        </h2>
        {competitions.rows.length === 0 ? (
          <p className="caption">No competitions yet.</p>
        ) : (
          <div className="scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Competition</th>
                  <th>State</th>
                  <th className="r">Members</th>
                  <th className="r">Forecasters</th>
                  <th className="r">Props</th>
                  <th className="r">Forecasts</th>
                  <th className="r">Complete</th>
                </tr>
              </thead>
              <tbody>
                {competitions.rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/competitions/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>
                      <CompetitionStamp state={c.state} />
                    </td>
                    <td className="r">{c.members ?? "—"}</td>
                    <td className="r">{c.forecasters}</td>
                    <td className="r">{c.props}</td>
                    <td className="r">{c.forecasts}</td>
                    <td className="r">
                      {c.complete === null ? "—" : `${Math.round(c.complete * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="caption">
          Complete: forecasts made out of props × members (props × forecasters
          for a public competition, which has no member list).
        </p>

        <div className="pair">
          <section>
            <h2 className="kicker">
              <span>Email notifications</span>
              <span className="aside">Turned off</span>
            </h2>
            {stats.notifications.map((n) => (
              <div className="line" key={n.type}>
                <span className="nm">{n.label}</span>
                <span className="r">{n.off.toLocaleString("en-US")} off</span>
                <span className="sub">{n.description}</span>
                <span className="sub r">
                  of {users.active.toLocaleString("en-US")} active
                </span>
              </div>
            ))}
          </section>
          <section>
            <h2 className="kicker">
              <span>Suggested props</span>
            </h2>
            {[
              ["Waiting for review", suggestions.pending],
              ["Accepted", suggestions.accepted],
              ["Rejected", suggestions.rejected],
            ].map(([label, value]) => (
              <div className="line" key={label}>
                <span className="nm">{label}</span>
                <span className="r">{value.toLocaleString("en-US")}</span>
              </div>
            ))}
            <Link className="onward" href="/admin/suggested-props">
              Review suggestions →
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
