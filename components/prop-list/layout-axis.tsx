import { BucketPicker, type Bucket } from "./bucket-picker";
import { Penalty, sheetCss } from "./sheet";
import Link from "next/link";
import { KIND_LABEL, linesOf, penaltyOf, pct, type PropView } from "./types";

/**
 * The axis grammar: the plot, its marks, and the columns around it. Exported
 * because the per-user score sheet plots exactly these marks, and a second
 * copy of them would be the fourth sheet in this app to redefine the same CSS.
 */
export const axisCss = `
/* One scale for the whole page, so a mark's position means the same thing in
   every row and the column of marks can be read down. */
.hxp .cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 23rem 7rem;
}
.hxp .cols.open {
  grid-template-columns: minmax(0, 1fr) 28rem;
  gap: 0 1.25rem;
  align-items: center;
}
.hxp .axis-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--paper);
  align-items: baseline;
  padding: 1.25rem 0 0.5rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .axis-head .lbl {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .axis-head .lbl.r { text-align: right; }
.hxp .axis-head .ticks {
  position: relative;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
}
.hxp .axis-head .ticks .mid,
.hxp .axis-head .ticks .hi { position: absolute; bottom: 0; }
.hxp .axis-head .ticks .mid { transform: translateX(-50%); }
.hxp .axis-head .ticks .hi { transform: translateX(-100%); }

.hxp .plotrow {
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .plotrow .claim {
  font-size: 0.9375rem;
  /* the plot starts here whatever the claim does, so a long one wraps rather
     than running up against the scale */
  padding-right: 2rem;
}
.hxp .plotrow.opt .claim {
  padding-left: 1.5rem;
  color: var(--ink-muted);
  font-size: 0.875rem;
}
.hxp .plotrow .fig {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
/* The figure belongs to the rule, not to the row. Two things pull it off:
   these rows do not centre their items, so a tall claim leaves the plot at the
   top while the figure drifts; and the rule sits at 68% of the plot rather
   than across its middle, because the value label rides above it. So the cell
   takes the plot's own box at the plot's own place, and drops its contents to
   that same 68% — 0.72rem of lead centres a flex child at 1.36rem of 2rem,
   which is where the rule is. Only rows that carry a plot: a choice prop's
   summary row has none, and aligns to its label. */
.hxp .plotrow:has(.plot) .cell-r {
  box-sizing: border-box;
  align-self: start;
  height: 2rem;
  padding-top: 0.72rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.hxp .plotrow .cell-r { text-align: right; }
.hxp .grouprow {
  display: flex;
  align-items: baseline;
  gap: 0.875rem;
  padding: 1.5rem 0 0.25rem;
  font-weight: 600;
  border-bottom: 0;
}
/* the kind label is two short words; the question wraps, the label does not */
.hxp .grouprow .mono { flex: none; white-space: nowrap; }

/* the plot: the scale itself, gridlines at the quarters, a mark for you, and
   a tail to the truth. Without the rule running the full width the awaiting
   page is a dot floating in paper and the eye has nothing to measure against. */
.hxp .plot { position: relative; height: 2rem; }
.hxp .plot .axisline {
  position: absolute;
  top: 68%;
  left: 0;
  right: 0;
  height: 1px;
  background: color-mix(in oklab, var(--ink) 16%, transparent);
  transform: translateY(-50%);
}
.hxp .plot .grid {
  position: absolute;
  top: 45%;
  bottom: 0;
  width: 1px;
  background: color-mix(in oklab, var(--ink) 10%, transparent);
}
.hxp .plot .grid.mid { background: color-mix(in oklab, var(--ink) 18%, transparent); }
/* The tail is the error, printed in the second ink whatever its size. The
   penalty column beside it carries the magnitude. */
.hxp .plot .tail {
  position: absolute;
  top: 68%;
  height: 3px;
  background: var(--red);
  transform: translateY(-50%);
}
.hxp .plot .you {
  position: absolute;
  top: 68%;
  width: 9px;
  height: 9px;
  background: var(--ink);
  transform: translate(-50%, -50%);
}
.hxp .plot .them {
  position: absolute;
  top: 68%;
  width: 2px;
  height: 0.75rem;
  background: var(--ink-faint);
  transform: translate(-50%, -50%);
}
/* where the truth landed: an open square at 0 or 1 */
.hxp .plot .truth {
  position: absolute;
  top: 68%;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ink);
  background: var(--paper);
  transform: translate(-50%, -50%);
}
/* The reading sits over the mark it describes, so the number and its position
   are one object. Anchored left or right at the ends of the scale, where a
   centred label would hang off the plot. */
.hxp .plot .val {
  position: absolute;
  top: -0.25rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
  white-space: nowrap;
  transform: translateX(-50%);
}
.hxp .plot .val.at-start { transform: none; }
.hxp .plot .val.at-end { transform: translateX(-100%); }
/* The key draws the marks at the size they appear on the rows, so it is the
   thing itself rather than a description of it. */
.hxp .legend {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  padding-top: 1.25rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .legend .key { display: inline-flex; align-items: center; gap: 0.5rem; }
.hxp .legend i { display: inline-block; flex: none; }
.hxp .legend i.k-you { width: 9px; height: 9px; background: var(--ink); }
.hxp .legend i.k-them { width: 2px; height: 12px; background: var(--ink-faint); }
.hxp .legend i.k-truth {
  width: 9px;
  height: 9px;
  border: 2px solid var(--ink);
  background: var(--paper);
}

.hxp .nofc {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-left: 0.75rem;
  white-space: nowrap;
}
/* On a phone the scale is the only thing that needs the full width, so it
   drops to a line of its own and whatever names the row stays on the line
   above it. The figure has to be placed explicitly: it comes after the plot in
   the markup, so auto-placement would otherwise push it onto a third line.
   The open variant has no figure column, and has to be named here: its
   desktop rule is the more specific one, so the plain .cols override never
   reached it and its 28rem scale squeezed the claim to a word per line. */
@media (max-width: 46rem) {
  .hxp .cols { grid-template-columns: minmax(0, 1fr) 3rem; gap: 0.25rem 0.75rem; }
  .hxp .cols.open { grid-template-columns: minmax(0, 1fr); gap: 0.25rem 0; }
  .hxp .axis-head .ticks, .hxp .plot { grid-column: 1 / -1; grid-row: 2; }
  .hxp .axis-head .lbl.r { display: none; }
  .hxp .plotrow .fig { grid-column: 2; grid-row: 1; }
}
`;

/** A claim, linked to its prop when the page knows where that lives. */
function ClaimLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (href === null) return <>{children}</>;
  return <Link href={href}>{children}</Link>;
}

/**
 * Layout 3 — "The common axis". Non-obvious.
 *
 * Every claim on the page is plotted against one shared 0–100% scale, so the
 * marks form a readable column: you can see where your convictions cluster
 * without reading a single prop. On resolved props a tail runs from your mark
 * to where the truth landed, so the page shows the shape of your errors.
 *
 * The tail is linear in the error while the cost is squared, so the tail alone
 * would understate a confident miss — every row therefore still prints its
 * penalty beside it.
 */
export function LayoutAxis({
  props,
  resolved,
  competitionName,
  backHref,
  buckets,
  competitionId,
}: {
  props: PropView[];
  resolved: boolean;
  /** The sheet is the whole page, so it prints its own masthead and its own
   *  way back rather than relying on chrome around it. */
  competitionName?: string;
  backHref?: string;
  /**
   * Turns the section head into the chooser between the two settled lists.
   * Omitted where there is no competition to cross within.
   */
  buckets?: { current: Bucket; counts: Record<Bucket, number> };
  /** Where a claim goes when clicked. Omit and the claims are plain text. */
  competitionId?: number;
}) {
  // A claim is the prop, so it opens the prop's own sheet — through this
  // competition, which is the one the reader came in by.
  const propHref = (propId: number) =>
    competitionId === undefined
      ? null
      : `/competitions/${competitionId}/props/${propId}`;
  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + axisCss }} />
      <div className="col">
        {competitionName && (
          <header className="masthead">
            <h1>
              {backHref ? (
                <Link href={backHref}>{competitionName}</Link>
              ) : (
                competitionName
              )}
            </h1>
          </header>
        )}

        <h2 className="kicker">
          <span>
            {buckets && competitionId !== undefined ? (
              <BucketPicker
                competitionId={competitionId}
                current={buckets.current}
                counts={buckets.counts}
              />
            ) : resolved ? (
              "Resolved"
            ) : (
              "Awaiting result"
            )}{" "}
            <span className="aside num">· {props.length} props</span>
          </span>
          {backHref && (
            <Link className="aside" href={backHref}>
              ← Overview
            </Link>
          )}
        </h2>

        <div className="legend">
          <span className="key">
            <i className="k-you" /> Your forecast
          </span>
          <span className="key">
            <i className="k-them" /> Field average
          </span>
          {resolved && (
            <span className="key">
              <i className="k-truth" /> What happened
            </span>
          )}
        </div>

        <div className={resolved ? "cols axis-head" : "cols open axis-head"}>
          <span className="lbl">Claim</span>
          <div className="ticks">
            <span>0%</span>
            <span className="mid" style={{ left: "50%" }}>
              50%
            </span>
            <span className="hi" style={{ left: "100%" }}>
              100%
            </span>
          </div>
          {resolved && <span className="lbl r">Penalty</span>}
        </div>

        {props.map((prop) => {
          const lines = linesOf(prop);
          const isChoice = prop.kind !== "binary";
          return (
            <div key={prop.propId}>
              {isChoice && (
                <div className="grouprow">
                  <span className="claim">
                    <ClaimLink href={propHref(prop.propId)}>
                      {prop.text}
                    </ClaimLink>
                  </span>
                  <span className="mono muted">{KIND_LABEL[prop.kind]}</span>
                </div>
              )}
              {lines.map((line) => {
                const you = line.yourForecast;
                const them = line.communityAverage;
                const truth =
                  line.outcome === null ? null : line.outcome ? 1 : 0;
                const showTail = resolved && you !== null && truth !== null;
                const lo = showTail ? Math.min(you!, truth!) : 0;
                const hi = showTail ? Math.max(you!, truth!) : 0;
                return (
                  <div
                    className={[
                      "cols",
                      resolved ? "" : "open",
                      "plotrow",
                      isChoice ? "opt" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={line.key}
                  >
                    <span className="claim">
                      {isChoice ? (
                        line.label
                      ) : (
                        <ClaimLink href={propHref(prop.propId)}>
                          {line.label}
                        </ClaimLink>
                      )}
                      {you === null && (
                        <span className="nofc">no forecast</span>
                      )}
                    </span>
                    <div className="plot">
                      <span className="axisline" />
                      <span className="grid" style={{ left: "0%" }} />
                      <span className="grid" style={{ left: "25%" }} />
                      <span className="grid mid" style={{ left: "50%" }} />
                      <span className="grid" style={{ left: "75%" }} />
                      <span className="grid" style={{ left: "100%" }} />
                      {showTail && (
                        <span
                          className="tail"
                          style={{
                            left: `${lo * 100}%`,
                            width: `${(hi - lo) * 100}%`,
                          }}
                        />
                      )}
                      {them !== null && (
                        <span
                          className="them"
                          style={{ left: `${them * 100}%` }}
                        />
                      )}
                      {truth !== null && (
                        <span
                          className="truth"
                          style={{ left: `${truth * 100}%` }}
                        />
                      )}
                      {you !== null && (
                        <>
                          <span
                            className="you"
                            style={{ left: `${you * 100}%` }}
                          />
                          <span
                            className={
                              you <= 0.06
                                ? "val at-start"
                                : you >= 0.94
                                  ? "val at-end"
                                  : "val"
                            }
                            style={{ left: `${you * 100}%` }}
                          >
                            {pct(you)}
                          </span>
                        </>
                      )}
                    </div>
                    {/* One prop, one penalty: a choice prop's cost is scored
                        over all its options together, so it prints once on the
                        summary row rather than per option. */}
                    {resolved && (
                      <span className="cell-r">
                        {isChoice ? null : <Penalty value={penaltyOf(prop)} />}
                      </span>
                    )}
                  </div>
                );
              })}
              {isChoice && resolved && (
                <div className="cols plotrow opt">
                  <span className="claim mono muted">Prop penalty</span>
                  <span />
                  <span className="cell-r">
                    <Penalty value={penaltyOf(prop)} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
