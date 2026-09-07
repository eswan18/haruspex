import Link from "next/link";

import { SeasonFilter } from "./season-filter";

import {
  CompetitionStamp,
  type SeasonState,
} from "@/components/competition-stamp/competition-stamp";
/**
 * The signed-in dashboard, in the landing page's print language. Presentation
 * only — see riso-dashboard.tsx for the data it is fed.
 *
 * Your standing is the argument, so it gets the big number; the leaders are its
 * caption. Everything else on the sheet is set quieter than that.
 *
 * NOTE: the print tokens are read from the global --riso-* set; the rest of this
 * (scoped to `hxd`) still duplicates a core that signed-out-landing.tsx also
 * carries. Those two should be factored into one module.
 */

/**
 * What the dashboard does with a competition's five-way status.
 *
 *   live    — forecasts still open, so you can change your answer
 *   scoring — forecasting has shut but props are still resolving, so your
 *             standing is still moving. Closed is not over.
 *   final   — past the end date; every prop is settled and the result is history
 *
 * Only `final` is archive. live and scoring both carry a live standing and are
 * featured identically.
 */
export type SeasonPhase = "live" | "scoring" | "final";

/** A dashboard phase is the lifecycle minus `upcoming`, which never features. */
const STAMP_OF: Record<SeasonPhase, SeasonState> = {
  live: "open",
  scoring: "scoring",
  final: "final",
};

export interface Standing {
  id: number;
  name: string;
  phase: SeasonPhase;
  isPrivate: boolean;
  leaders: { userId: number; userName: string; score: number }[];
  you: { rank: number; score: number } | null;
  fieldSize: number;
}

export interface ResolvedItem {
  forecastId: number;
  propId: number;
  propText: string;
  forecast: number;
  resolution: boolean;
}

const ORDINALS = ["1st", "2nd", "3rd"];
export const ordinal = (n: number) =>
  n <= 3
    ? ORDINALS[n - 1]
    : `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const css = `
.hxd {
  --paper: var(--riso-paper);
  --ink: var(--riso-ink);
  --red: var(--riso-red);
  --red-text: var(--riso-red-text);
  --rule: color-mix(in oklab, var(--ink) 22%, transparent);
  --ink-muted: color-mix(in oklab, var(--ink) 70%, transparent);
  --offset: 6px;

  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink);
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
  line-height: 1.6;
}
/* --riso-paper, not --paper: the sheet's tokens are scoped to .hxd and do
   not resolve out here on the body. */
body:has(.hxd) { background: var(--riso-paper); }

/* the stock's tooth, screened at 45 degrees */
.hxd::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(var(--ink) 0.7px, transparent 0.9px),
    radial-gradient(var(--ink) 0.7px, transparent 0.9px);
  background-size: 8.5px 8.5px;
  background-position: 0 0, 4.25px 4.25px;
  opacity: 0.05;
  pointer-events: none;
  z-index: 0;
}

.hxd .col {
  position: relative;
  z-index: 1;
  max-width: 58rem;
  margin: 0 auto;
  padding: 0 1.75rem 5rem;
}

/* One notch below a kicker on purpose: 0.75rem/0.16em red mono caps are
   reserved for section heads, so a status tag can never impersonate one. */
.hxd .mono {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hxd .muted { color: var(--ink-muted); }
.hxd .ink2 { color: var(--red-text); }


.hxd h2.kicker.first { margin-top: 2rem; }
/* The filter sits above both sections, since it governs both. Right-aligned so
   it lands where the eye leaves the navbar, and the first section head loses
   its own top margin because this row already supplies the air. */
.hxd .board-top {
  display: flex;
  justify-content: flex-end;
  padding-top: 2rem;
}
.hxd .board-top + h2.kicker.first { margin-top: 1rem; }

.hxd h2.kicker {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 400;
  color: var(--red-text);
  margin: 4rem 0 0;
  padding-bottom: 0.875rem;
  border-bottom: 2px solid var(--ink);
}

/* ---- a competition still taking forecasts ---- */
.hxd .season { padding: 1.5rem 0 0; }
.hxd .season + .season { border-top: 1px solid var(--rule); margin-top: 2rem; }
.hxd .season .head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.hxd .season .name {
  font-size: 1.44rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  margin: 0;
}
.hxd .season .name a { color: inherit; text-decoration: none; }
.hxd .season .name a:hover { color: var(--red-text); }

/* the rank, printed the way the landing page prints its argument */
.hxd .rank {
  font-weight: 800;
  font-size: clamp(3.5rem, 9vw, 5.5rem);
  line-height: 0.85;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  display: inline-block;
  position: relative;
  margin-left: -0.04em;
}
.hxd .rank .ghost {
  position: absolute;
  inset: 0;
  color: var(--red);
  transform: translate(var(--offset), var(--offset));
  mix-blend-mode: multiply;
  z-index: 0;
  -webkit-user-select: none;
  user-select: none;
}
.hxd .rank .top-ink {
  position: relative;
  z-index: 1;
  background-image: radial-gradient(transparent 0.5px, var(--ink) 0.75px);
  background-size: 5px 5px;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

/* ---- your standing, and the leaders that caption it ---- */
.hxd .rank-row { margin-top: 1.25rem; display: flex; align-items: baseline; gap: 1.25rem; flex-wrap: wrap; }
.hxd .of { font-family: var(--font-roboto-mono), ui-monospace, monospace; font-size: 0.8125rem; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.hxd .leaders {
  margin-top: 1.5rem;
  display: flex;
  gap: 0.5rem 2rem;
  flex-wrap: wrap;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.hxd .leaders .who { color: var(--ink); }
.hxd .leaders .n { color: var(--red-text); margin-right: 0.5rem; }
.hxd .leaders .sc { color: var(--ink-muted); margin-left: 0.5rem; }

/* the row a season collapses to when it has no live standing to feature. The first one after a block needs air,
   or it reads as the tail of that block rather than its own competition. */
.hxd .season + .compact { margin-top: 2rem; }
.hxd .compact {
  display: flex;
  align-items: baseline;
  gap: 0.875rem;
  padding: 0.875rem 0;
  border-top: 1px solid var(--rule);
  flex-wrap: wrap;
}
/* directly under a head the rule is already there, and the head owns the gap */
.hxd h2.kicker + .compact { border-top: 0; padding-top: 1.5rem; }
.hxd .compact .name { font-size: 1rem; font-weight: 600; }
.hxd .compact .name a { color: inherit; text-decoration: none; }
.hxd .compact .name a:hover { color: var(--red-text); }
.hxd .compact .lead {
  flex: 1;
  height: 0;
  border-bottom: 1px dotted var(--rule);
  transform: translateY(-0.3em);
  min-width: 1.5rem;
}
.hxd .compact .fig {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  flex: none;
}
.hxd .compact .fig b { font-weight: 700; }
.hxd .compact .fig span { color: var(--ink-muted); }
/* status is a per-competition tag, not a grouping, so a row carries the same
   marker in the same place the blocks carry theirs. */
.hxd .compact .tag {
  flex: none;
  display: flex;
  justify-content: flex-end;
}

/* ---- the two quiet columns at the foot ---- */
.hxd .foot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  gap: 2.5rem 3rem;
  margin-top: 4.5rem;
}
.hxd .foot h2.kicker {
  margin: 0 0 1.5rem;
  border-bottom-width: 1px;
  border-bottom-color: var(--rule);
}
.hxd .item {
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--rule);
  font-size: 0.9375rem;
}
.hxd .item:first-of-type { padding-top: 0; }
.hxd .item a { color: inherit; text-decoration: none; }
.hxd .item a:hover { color: var(--red-text); }
.hxd .item .meta {
  display: block;
  margin-top: 0.3125rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
/* Every outcome is set the same way. Reddening the ones the reader forecasted
   against was tried and dropped -- the prop lists reached the same conclusion
   about penalties (see Penalty in components/prop-list/sheet.tsx). Being on the
   far side of a coin flip is not a failure: a well-judged 45% is supposed to
   come up No most of the time, and colouring it as a miss argues the opposite.
   Ink, one shade up from the meta line, so the outcome reads as the fact. */
.hxd .item .outcome { color: var(--ink); }
.hxd .empty { color: var(--ink-muted); font-size: 0.9375rem; padding: 0.875rem 0; }

/* ---- narrow screens ---- */

/* Inline, the three leaders wrap mid-name and nothing lines up. Drop the label
   and set them on a shared grid instead, one per line, so ranks, names and
   scores align down the column. display:contents lets each leader's wrapper
   hand its three spans straight to that grid. */
@media (max-width: 40rem) {
  /* Every ranked season now carries a block, so the leaders would be one list
     per competition down a phone. The rank line above already says where you
     stand; the full field is a tap away on the competition page. */
  .hxd .leaders { display: none; }

  /* 9vw never reaches the clamp's 3.5rem floor on a phone, so the ordinal sits
     at full size on the narrowest screen and several blocks of it fill the
     view. 3rem still leads the block, and matches what the competition sheet
     prints at this width. */
  .hxd .rank { font-size: 3rem; }

  /* A long name pushed the status tag onto its own line, where wrapping left it
     floating under the middle of the row. Place it deliberately instead: name
     left, figure right, tag beneath the figure and aligned to it. The dotted
     leader has nothing left to lead across, so it goes. */
  .hxd .compact {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 0.75rem;
    row-gap: 0.125rem;
    align-items: baseline;
  }
  .hxd .compact .lead { display: none; }
  .hxd .compact .name { grid-area: 1 / 1; }
  .hxd .compact .fig { grid-area: 1 / 2; text-align: right; }
  .hxd .compact .tag { grid-area: 2 / 2; width: auto; text-align: right; }
}

`;

function Rank({ n }: { n: number }) {
  const text = ordinal(n);
  return (
    <span className="rank">
      <span className="ghost" aria-hidden="true">
        {text}
      </span>
      <span className="top-ink">{text}</span>
    </span>
  );
}

/** A season still in play that you are ranked in. Half() only sends it those,
 *  so `you` is non-null here and the rank always prints. */
function FeaturedSeason({
  standing,
  you,
}: {
  standing: Standing;
  you: NonNullable<Standing["you"]>;
}) {
  const { fieldSize } = standing;
  const href = `/competitions/${standing.id}`;

  return (
    <section className="season">
      <div className="head">
        <h3 className="name">
          <Link href={href}>{standing.name}</Link>
        </h3>
        <CompetitionStamp state={STAMP_OF[standing.phase]} />
      </div>

      <div className="rank-row">
        <Rank n={you.rank} />
        <span className="of">
          of {fieldSize} · {you.score.toFixed(3)}
        </span>
      </div>

      {standing.leaders.length > 0 && (
        <div className="leaders">
          <span className="mono muted">Leading</span>
          {standing.leaders.map((l, i) => (
            <span key={l.userId}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              <span className="who">{l.userName}</span>
              <span className="sc">{l.score.toFixed(3)}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A season compressed to one ruled row: one you hold no rank in, so there is no
 * number to feature.
 */
function CompactSeason({ standing }: { standing: Standing }) {
  const { you } = standing;
  return (
    <div className="compact">
      <span className="name">
        <Link href={`/competitions/${standing.id}`}>{standing.name}</Link>
      </span>
      <i className="lead" aria-hidden="true" />
      <span className="fig">
        {you ? (
          <>
            <b>{ordinal(you.rank)}</b> <span>· {you.score.toFixed(3)}</span>
          </>
        ) : (
          <span>not scored</span>
        )}
      </span>
      <span className="tag">
        <CompetitionStamp state={STAMP_OF[standing.phase]} />
      </span>
    </div>
  );
}

/**
 * One of the two competition sections.
 *
 * Having a rank is what earns the big number — a finished season's result is
 * just as much a result as a live one, so it gets the same treatment. Only a
 * season you hold no rank in compresses to a row, because it has no number to
 * print. Within each group, seasons still in play come before finished ones.
 *
 * Deliberately not keyed to open/closed: that split lands on the public/private
 * boundary whenever a member's competitions happen to sort that way, and then
 * the sections look like a ranking of each other.
 */
function Half({
  label,
  standings,
  first,
}: {
  label: string;
  standings: Standing[];
  first: boolean;
}) {
  type Ranked = Standing & { you: NonNullable<Standing["you"]> };
  const inPlayFirst = (a: Standing, b: Standing) =>
    Number(a.phase === "final") - Number(b.phase === "final");

  const featured = standings
    .filter((s): s is Ranked => s.you !== null)
    .sort(inPlayFirst);
  const unranked = standings.filter((s) => s.you === null).sort(inPlayFirst);

  return (
    <>
      <h2 className={first ? "kicker first" : "kicker"}>{label}</h2>
      {featured.map((s) => (
        <FeaturedSeason key={s.id} standing={s} you={s.you} />
      ))}
      {unranked.map((s) => (
        <CompactSeason key={s.id} standing={s} />
      ))}
    </>
  );
}

export function DashboardView({
  standings,
  resolved,
  showAll = false,
  hiddenCount = 0,
}: {
  standings: Standing[];
  resolved: ResolvedItem[];
  /** Whether finished seasons are listed; the bar's state. */
  showAll?: boolean;
  /** How many finished seasons the Active view is leaving out. */
  hiddenCount?: number;
}) {
  const publicComps = standings.filter((s) => !s.isPrivate);
  const privateComps = standings.filter((s) => s.isPrivate);

  return (
    <div className="hxd">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="col">
        {(standings.length > 0 || hiddenCount > 0) && (
          <div className="board-top">
            <SeasonFilter showAll={showAll} />
          </div>
        )}

        {standings.length === 0 && (
          <p className="empty">
            {hiddenCount > 0
              ? "Every season you are in has finished."
              : "You're not in a competition yet."}
          </p>
        )}

        {publicComps.length > 0 && (
          <Half label="Public competitions" standings={publicComps} first />
        )}

        {privateComps.length > 0 && (
          <Half
            label="Private competitions"
            standings={privateComps}
            first={publicComps.length === 0}
          />
        )}

        <div className="foot">
          <div>
            <h2 className="kicker">Recently resolved</h2>
            {resolved.length === 0 ? (
              <p className="empty">Nothing resolved yet.</p>
            ) : (
              resolved.map((f) => (
                <div className="item" key={f.forecastId}>
                  <Link href={`/props/${f.propId}`}>{f.propText}</Link>
                  <span className="meta">
                    You said {Math.round(f.forecast * 100)}% ·{" "}
                    <span className="outcome">
                      {f.resolution ? "Yes" : "No"}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>

          <div>
            <h2 className="kicker">News</h2>
            <div className="item">
              <Link href="/standalone/calibration">Personal calibrations</Link>
              <span className="meta">
                See how well your probabilities match outcomes
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
