import Link from "next/link";
import { CompetitionStamp } from "@/components/competition-stamp/competition-stamp";
import type { CompetitionViewData } from "./types";
import {
  BigRank,
  Board,
  DueLabel,
  Routes,
  ScoreLine,
  daysUntil,
  rankStandings,
  sheetCss,
} from "./sheet";

// Module-level constant, no interpolation: this is a stylesheet, not content.
const variantCss = `
/* Three shared rows — head, figure, list — so the two columns are ruled across
   rather than pasted side by side. Without the subgrid the figures sat 26px
   apart at the baseline and the lists started 36px apart, and the eye had no
   line to travel on between them. */
.hxc .ledger {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  gap: 0 3rem;
}
.hxc .ledger > section {
  display: grid;
  grid-row: span 3;
  grid-template-rows: subgrid;
}
.hxc .ledger .figure {
  padding-top: 1.5rem;
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
}
@media (max-width: 52rem) {
  .hxc .ledger { grid-template-columns: 1fr; grid-template-rows: none; }
  .hxc .ledger > section {
    grid-row: auto;
    grid-template-rows: none;
    display: block;
  }
}

/* the outstanding count: a reading, in the routes' register. One plate per
   page, and it belongs to the ordinal. */
.hxc .tally .fig {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.hxc .tally .fig.clear { color: var(--ink-muted); }
.hxc .tally .cap { color: var(--ink-muted); font-size: 0.9375rem; }

/* two asides can share a kicker: grouped, so the flex row puts them together
   at the end rather than spreading them across the rule. Matches .hxp. */
.hxc h2.kicker .asides {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
}

/* what you owe, as a numbered docket */
.hxc ol.docket { list-style: none; margin: 0; padding: 1.75rem 0 0; }
.hxc ol.docket li {
  display: flex;
  align-items: baseline;
  gap: 0.875rem;
  padding: 0.875rem 0;
  border-top: 1px solid var(--rule);
}
.hxc ol.docket li:first-child { border-top: 0; padding-top: 0; }
.hxc ol.docket .n {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  flex: none;
  width: 1.75rem;
}
.hxc ol.docket .text { flex: 1; min-width: 0; font-size: 1rem; }
.hxc ol.docket .text a { color: inherit; text-decoration: none; }
.hxc ol.docket .text a:hover { color: var(--red-text); }
.hxc .stamp-board { padding-top: 1.75rem; }
`;

const OWED_SHOWN = 6;
const BOARD_SHOWN = 6;

/**
 * The competition overview — "the ledger".
 *
 * A competition is an open account, and both sides of it belong on one
 * spread. Where you stand and what you owe sit in two columns ruled across the
 * same three lines, so a member sees the result and the obligation without
 * scrolling between them.
 *
 * The standing leads — it is the wider column, it carries the page's one red
 * plate, and it comes first when the columns stack. Giving the chore count a
 * matching plate was tried and rejected: the plate is the device that says
 * "this is your result", and spending it on a to-do count says the wrong thing.
 */
export function CompetitionOverview({
  data,
  currentUserId,
  now,
  showMembers = false,
  newPropHref,
}: {
  data: CompetitionViewData;
  currentUserId: number;
  /** Fixed on the server, so the markup and the deadline arithmetic agree. */
  now: Date;
  /** Private competitions carry a membership list; public ones don't. */
  showMembers?: boolean;
  /**
   * Where this reader writes a prop, or undefined if they may not. Decided by
   * `canCreateProps` on the server — the same rule the route itself enforces.
   */
  newPropHref?: string;
}) {
  const { counts, owed, standings } = data;

  const ranked = rankStandings(standings);
  const me = ranked.find((s) => s.userId === currentUserId);
  const scored = counts.resolved > 0 && ranked.length > 0;
  const nextDue = owed.length > 0 ? daysUntil(owed[0].deadline, now) : null;
  const owedShown = owed.slice(0, OWED_SHOWN);
  const owedRest = owed.length - owedShown.length;

  return (
    <div className="hxc">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + variantCss }} />
      <div className="col">
        <header className="masthead">
          <CompetitionStamp state={data.state} />
          <h1>{data.name}</h1>
          <div className="meta mono">
            <span>{data.isPrivate ? "Private" : "Public"}</span>
            <span className="num wide-only">{data.fieldSize} forecasters</span>
            <span className="num wide-only">
              {counts.resolved} of {counts.total} resolved
            </span>
          </div>
          {/* This page replaced the tab bar, so anything the tabs reached and
              the sections below don't has to be linked from here. */}
          <nav className="links mono">
            {showMembers && (
              <Link href={`/competitions/${data.id}/members`}>Members</Link>
            )}
            <Link href={`/competitions/${data.id}/forecast-stats`}>
              Forecast stats
            </Link>
          </nav>
        </header>

        <div className="ledger">
          <section>
            <h2 className="kicker first">
              Standings
              {ranked.length > BOARD_SHOWN && (
                <Link
                  className="aside"
                  href={`/competitions/${data.id}/standings`}
                >
                  Full →
                </Link>
              )}
            </h2>

            <div className="figure">
              {scored && me ? (
                <>
                  <BigRank n={me.rank} />
                  <ScoreLine score={me.score} field={ranked.length} />
                </>
              ) : (
                <p className="empty">
                  Nothing has resolved yet. Scores appear with the first result.
                </p>
              )}
            </div>

            <div className="stamp-board">
              {scored && (
                <Board
                  standings={standings}
                  currentUserId={currentUserId}
                  limit={BOARD_SHOWN}
                  moreHref={`/competitions/${data.id}/standings`}
                />
              )}
            </div>
          </section>

          <section>
            <h2 className="kicker first">
              Outstanding
              <span className="asides">
                {/* Shown on the reader's power to write one, never on the
                    count: this used to hang off the open-props page, which is
                    itself only linked when something is open — so a
                    competition with nothing in it yet offered its own admin no
                    way to write the first prop. */}
                {newPropHref && (
                  <Link className="aside" href={newPropHref}>
                    Write a prop →
                  </Link>
                )}
                {counts.open > 0 && (
                  <Link
                    className="aside"
                    href={`/competitions/${data.id}/props/open`}
                  >
                    All {counts.open} open →
                  </Link>
                )}
              </span>
            </h2>

            <div className="figure tally">
              <span className={counts.toForecast === 0 ? "fig clear" : "fig"}>
                {counts.toForecast}
              </span>
              <span className="cap">
                {counts.toForecast === 0
                  ? counts.open === 0
                    ? "Nothing open to forecast."
                    : "You're caught up on every open prop."
                  : counts.toForecast === 1
                    ? "prop still needs your forecast"
                    : "props still need your forecast"}
                {counts.toForecast > 0 && nextDue !== null && (
                  <>
                    {" · "}
                    <span className={nextDue <= 7 ? "due soon" : "due"}>
                      next {nextDue <= 0 ? "due today" : `in ${nextDue}d`}
                    </span>
                  </>
                )}
              </span>
            </div>

            <div>
              {owedShown.length > 0 && (
                <ol className="docket">
                  {owedShown.map((p, i) => (
                    <li key={p.propId}>
                      <span className="n">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text">
                        <Link
                          href={`/competitions/${data.id}/props/${p.propId}`}
                        >
                          {p.propText}
                        </Link>
                      </span>
                      <DueLabel deadline={p.deadline} now={now} />
                    </li>
                  ))}
                </ol>
              )}
              {owedRest > 0 && (
                <Link
                  className="more"
                  href={`/competitions/${data.id}/props/open`}
                >
                  ⋯ {owedRest} more
                </Link>
              )}
            </div>
          </section>
        </div>

        <h2 className="kicker">All props</h2>
        <Routes competitionId={data.id} counts={counts} />
      </div>
    </div>
  );
}
