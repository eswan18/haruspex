"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PropEditDialog } from "@/components/dialogs/prop-edit-dialog";
import { ResolutionDialog } from "@/components/dialogs/resolution-dialog";
import { entryTotalPercent } from "@/components/forecast-card/choice-entry";
import { useChoiceForecastEntry } from "@/components/forecast-card/use-choice-forecast-entry";
import { LocalDate } from "@/components/local-date";
import { MarkdownRenderer } from "@/components/markdown";
import { axisCss } from "@/components/prop-list/layout-axis";
import { sheetCss } from "@/components/prop-list/sheet";
import { KIND_LABEL, pct } from "@/components/prop-list/types";
import { useServerAction } from "@/hooks/use-server-action";
import { createForecast, updateForecast } from "@/lib/db_actions";
import { isChoiceKind } from "@/lib/prop-kind";
import { getPropStatusFromProp, type PropStatus } from "@/lib/prop-status";
import type { PropWithUserForecast } from "@/types/db_types";

import { closedNote, summariseField, type FieldEntry } from "./build";
import { Gauge, PercentField, Scale, Ticks, at, entryCss } from "./entry";

const ownCss = `
/* The claim is the page's subject, so it sets like a headline rather than a
   name: smaller than a competition's masthead because it is a sentence, and
   held to a measure a sentence can be read across. */
.hxp .masthead h1.claimhead {
  font-size: clamp(1.5rem, 3.4vw, 2.125rem);
  letter-spacing: -0.02em;
  line-height: 1.18;
  max-width: 44rem;
}

/* The dateline: everything the claim is bound by, set as one mono line under
   the rule the way a masthead's dateline sits under its title. */
.hxp .dateline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1.75rem;
  padding-top: 1.25rem;
  color: var(--ink-muted);
}
.hxp .dateline .spacer { flex: 1 1 auto; }
.hxp .dateline .left { color: var(--red-text); }

/* Actions are text on a rule, like every other control on the sheet. Nothing
   here is a filled button; the sheet has no fills. */
.hxp .act {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
  border: 0;
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 40%, transparent);
  padding: 0 0 0.25rem;
  cursor: pointer;
  white-space: nowrap;
}
.hxp .act:hover:not(:disabled) { color: var(--red-text); border-bottom-color: var(--red-text); }
.hxp .act:disabled { color: var(--ink-faint); border-bottom-color: transparent; cursor: default; }
.hxp .act.primary { color: var(--ink); font-weight: 700; border-bottom-width: 2px; border-bottom-color: var(--ink); }
.hxp .act.primary:hover:not(:disabled) { color: var(--red-text); border-bottom-color: var(--red-text); }
.hxp .acts { display: flex; gap: 1.25rem; }

/* ---- your forecast ---- */
/* The entry sits on the sheet's own column grid, so the scale you set your
   number on is the same scale, at the same place on the page, as the one the
   field is plotted against below it. Your mark and everyone else's line up in
   one column; that is the whole argument for putting them on one page. */
.hxp .entry { align-items: center; padding: 1.5rem 0 0; }
.hxp .entry .fig {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 2.75rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--red-text);
  background: none;
  border: 0;
  padding: 0;
  text-align: left;
  font-weight: 400;
  width: 4.5ch;
}
.hxp .entry .fig.unset { color: var(--ink-faint); }
.hxp .entry button.fig { cursor: text; }
.hxp .entry input.fig { outline: none; border-bottom: 2px solid var(--red); }
.hxp .entry .figlbl {
  display: block;
  margin-top: 0.625rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}


.hxp .note { color: var(--ink-muted); font-size: 0.875rem; padding-top: 1.25rem; }
.hxp .note.miss { color: var(--red-text); }

/* ---- the field, and a choice prop's options ---- */
/* Nothing rides above these marks, so the rule sits on the centre line. */
.hxp .plot { height: 1.5rem; }
.hxp .plot .axisline { top: 50%; }
.hxp .plot .grid { top: 25%; bottom: 25%; }
/* The crowd's mean runs the full height of every row, so it prints as one
   continuous column down the field and you can read which side of it you are
   on without comparing two numbers. */
.hxp .plot .grid.avg { top: 0; bottom: 0; background: color-mix(in oklab, var(--ink) 30%, transparent); }
.hxp .plot .mark {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  background: var(--ink);
  transform: translate(-50%, -50%);
}
.hxp .plot .mark.mine { background: var(--red); }
/* the crowd's reading on one option, drawn hollow so it never reads as a
   forecast someone made */
.hxp .plot .mark.crowd { background: var(--paper); border: 2px solid var(--ink-muted); }
.hxp .plot .truth { top: 50%; }
/* Every miss is drawn in ink here, unlike the prop lists where every tail is
   the reader's own. On a page listing a whole field the second ink is worth
   more spent on one row than on twelve: yours is the line you came to find. */
.hxp .plot .tail { top: 50%; background: var(--ink); }
.hxp .plotrow.mine .plot .tail { background: var(--red); }

.hxp .plotrow .who { font-size: 0.9375rem; }
.hxp .plotrow.mine .who { font-weight: 700; }
.hxp .plotrow.mine .fig { color: var(--red-text); font-weight: 700; }
.hxp .plotrow .fig .pen {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  font-weight: 400;
}
.hxp .axis-head .sort {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
  border: 0;
  border-bottom: 1px solid transparent;
  padding: 0 0 0.125rem;
  cursor: pointer;
  white-space: nowrap;
}
.hxp .axis-head .sort:hover { color: var(--red-text); border-bottom-color: var(--red-text); }
.hxp .legend i.k-crowd {
  width: 9px;
  height: 9px;
  background: var(--paper);
  border: 2px solid var(--ink-muted);
}
.hxp .legend i.k-avg { width: 2px; height: 14px; background: color-mix(in oklab, var(--ink) 40%, transparent); }
.hxp .legend i.k-mine { width: 9px; height: 9px; background: var(--red); }

.hxp .totalrow {
  padding: 0.875rem 0 0;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .totalrow .fig { color: var(--ink); font-weight: 700; }
.hxp .totalrow.short .fig { color: var(--red-text); }

@media (max-width: 46rem) {
  .hxp .entry .fig { font-size: 2.25rem; }
  .hxp .gaugebox { grid-column: 1 / -1; }
  .hxp .masthead h1.claimhead { line-height: 1.22; }
}
`;

const STATUS_LABEL: Record<PropStatus, string> = {
  open: "Open",
  unresolved: "Awaiting result",
  "resolved-yes": "Resolved · Yes",
  "resolved-no": "Resolved · No",
  resolved: "Resolved",
  voided: "Voided",
};

/**
 * How much time is left, for the near deadlines where that is the useful
 * reading. A date three months out says everything a countdown would.
 */
function timeLeft(due: Date | null): string | null {
  if (!due) return null;
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0 || days > 30) return null;
  if (days === 0) return "due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export interface PropSheetProps {
  prop: PropWithUserForecast;
  /** Everyone's mark on the scale, highest first. Empty for a choice prop. */
  field: FieldEntry[];
  /** People who have forecasted this prop, counting choice forecasts too. */
  forecasterCount: number;
  currentUserId: number;
  /** True when the deadline has not passed and the reader may record one. */
  canForecast: boolean;
  canEdit: boolean;
  canResolve: boolean;
  /** Where the sheet's way out goes. */
  back?: { href: string; label: string };
}

/**
 * One proposition, whole.
 *
 * This replaces two half-pages: a competition route that let you set a
 * forecast but never showed you the crowd, and a standalone route that showed
 * the crowd but gave you no way to change your mind. Both now render this.
 *
 * The field is the page's instrument. Every forecaster is a mark on one shared
 * 0–100% scale — the same scale, in the same column, that you set your own
 * number on — and the crowd's mean prints as a rule running the whole height
 * of the list, so where you sit relative to everyone else is a thing you see
 * rather than a subtraction you do. Once the prop resolves, a tail runs from
 * each mark to where the truth landed and the column becomes a picture of who
 * was wrong and by how much.
 */
export function PropSheet({
  prop,
  field,
  forecasterCount,
  currentUserId,
  canForecast,
  canEdit,
  canResolve,
  back,
}: PropSheetProps) {
  const router = useRouter();
  const isChoice = isChoiceKind(prop.prop_kind);
  const status = getPropStatusFromProp(prop);
  const truth = prop.resolution === null ? null : prop.resolution ? 1 : 0;

  const [local, setLocal] = useState<number | null>(prop.user_forecast);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [desc, setDesc] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const typeBox = useRef<HTMLInputElement>(null);

  const create = useServerAction(createForecast, {
    successMessage: "Forecast recorded",
    onSuccess: () => router.refresh(),
  });
  const update = useServerAction(updateForecast, {
    successMessage: "Forecast updated",
    onSuccess: () => router.refresh(),
  });
  const saving = create.isLoading || update.isLoading;
  const changed = local !== prop.user_forecast;

  const choice = useChoiceForecastEntry(prop, {
    onSaved: () => router.refresh(),
  });
  const choiceTotal = entryTotalPercent(choice.values);

  const summary = summariseField(field);
  const ordered = desc ? field : [...field].reverse();

  const startTyping = () => {
    if (!canForecast) return;
    setTyped(local === null ? "" : String(Math.round(local * 100)));
    setTyping(true);
    setTimeout(() => typeBox.current?.select(), 0);
  };
  const commitTyped = () => {
    setTyping(false);
    const n = Number(typed.trim());
    if (typed.trim() === "" || isNaN(n) || n < 0 || n > 100) return;
    setLocal(Math.round(n) / 100);
  };

  const save = async () => {
    if (local === null) return;
    if (prop.user_forecast_id !== null) {
      await update.execute({
        id: prop.user_forecast_id,
        forecast: { forecast: local },
      });
    } else {
      await create.execute({
        forecast: {
          prop_id: prop.prop_id,
          user_id: currentUserId,
          forecast: local,
        },
      });
    }
  };

  const dirty = isChoice ? choice.hasChanges : changed;
  const busy = isChoice ? choice.isSaving : saving;
  const due = prop.prop_forecasts_due_date
    ? new Date(prop.prop_forecasts_due_date)
    : null;
  const left = status === "open" ? timeLeft(due) : null;

  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{
          __html: sheetCss + axisCss + entryCss + ownCss,
        }}
      />
      <div className="col">
        <header className="masthead">
          <h1 className="claimhead">
            <MarkdownRenderer className="md">{prop.prop_text}</MarkdownRenderer>
          </h1>
        </header>

        <h2 className="kicker">
          <span>
            {STATUS_LABEL[status]}
            {prop.category_name && (
              <span className="aside"> · {prop.category_name}</span>
            )}
            {isChoice && (
              <span className="aside"> · {KIND_LABEL[prop.prop_kind]}</span>
            )}
          </span>
          {back && (
            <Link className="aside" href={back.href}>
              ← {back.label}
            </Link>
          )}
        </h2>

        {prop.prop_notes && (
          <p className="lede">
            <MarkdownRenderer className="md">
              {prop.prop_notes}
            </MarkdownRenderer>
          </p>
        )}

        <div className="dateline mono num">
          <span>
            Forecasts due {due ? <LocalDate date={due} /> : "—"}
            {left && (
              <span className="left" suppressHydrationWarning>
                {" "}
                · {left}
              </span>
            )}
          </span>
          {prop.prop_resolution_due_date && (
            <span>
              Resolves{" "}
              <LocalDate date={new Date(prop.prop_resolution_due_date)} />
            </span>
          )}
          <span className="spacer" />
          {canEdit && (
            <button
              type="button"
              className="act"
              onClick={() => setEditOpen(true)}
            >
              Edit prop
            </button>
          )}
          {canResolve && (
            <button
              type="button"
              className="act"
              onClick={() => setResolveOpen(true)}
            >
              Resolve
            </button>
          )}
        </div>

        {prop.resolution_notes && (
          <>
            <h2 className="kicker">Resolution</h2>
            <p className="lede">
              <MarkdownRenderer className="md">
                {prop.resolution_notes}
              </MarkdownRenderer>
            </p>
          </>
        )}

        <h2 className="kicker">
          <span>Your forecast</span>
          {canForecast && dirty && (
            <span className="aside acts">
              <button
                type="button"
                className="act primary"
                disabled={
                  isChoice
                    ? !choice.canSave || choice.isSaving
                    : saving || local === null
                }
                onClick={isChoice ? choice.save : save}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="act"
                disabled={busy}
                onClick={
                  isChoice ? choice.cancel : () => setLocal(prop.user_forecast)
                }
              >
                Cancel
              </button>
            </span>
          )}
        </h2>

        {isChoice ? (
          <>
            <div className="legend">
              <span className="key">
                <i className="k-mine" /> Your forecast
              </span>
              <span className="key">
                <i className="k-crowd" /> Field average
              </span>
              <span className="key num">
                {forecasterCount}{" "}
                {forecasterCount === 1 ? "forecaster" : "forecasters"}
              </span>
            </div>
            <div className="cols axis-head">
              <span className="lbl">Option</span>
              <Scale />
              <span className="lbl r">You</span>
            </div>
            {prop.options.map((option) => {
              const yours = choice.values[option.option_id] ?? null;
              return (
                <div className="cols plotrow" key={option.option_id}>
                  <span className="who">
                    {option.text}
                    {option.outcome !== null && (
                      <span className={option.outcome ? "yes" : "no"}>
                        {" · "}
                        {option.outcome ? "Yes" : "No"}
                      </span>
                    )}
                  </span>
                  <span className="plot">
                    <Ticks />
                    {option.community_average !== null && (
                      <span
                        className="mark crowd"
                        style={{ left: at(option.community_average) }}
                      />
                    )}
                    {yours !== null && (
                      <span className="mark mine" style={{ left: at(yours) }} />
                    )}
                  </span>
                  <span className="fig">
                    <PercentField
                      value={yours}
                      disabled={!canForecast}
                      label={`Your forecast for ${option.text}, percent`}
                      onChange={(v: number) =>
                        choice.setValue(option.option_id, v)
                      }
                    />
                  </span>
                </div>
              );
            })}
            {prop.prop_kind === "one_of" && (
              <div
                className={
                  choiceTotal === 100 ? "cols totalrow" : "cols totalrow short"
                }
              >
                <span>Must total 100%</span>
                <span />
                <span className="fig num">{choiceTotal}%</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="cols entry">
              <div>
                {typing ? (
                  <input
                    ref={typeBox}
                    className="fig"
                    type="text"
                    inputMode="numeric"
                    value={typed}
                    aria-label="Your forecast, percent"
                    onChange={(e) => setTyped(e.target.value)}
                    onBlur={commitTyped}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitTyped();
                      if (e.key === "Escape") setTyping(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={local === null ? "fig unset" : "fig"}
                    onClick={startTyping}
                    disabled={!canForecast}
                    title={canForecast ? "Type a value" : undefined}
                  >
                    {local === null ? "—" : pct(local)}
                  </button>
                )}
                <span className="figlbl">
                  {local === null ? "Not set" : "Your forecast"}
                </span>
              </div>

              <div className="gaugebox">
                <Gauge
                  value={local}
                  onChange={setLocal}
                  disabled={!canForecast}
                  hint="Click the rule to set your forecast"
                />
                <Scale />
              </div>
              <span />
            </div>

            {!canForecast && (
              <p className={closedNote(prop).miss ? "note miss" : "note"}>
                {closedNote(prop).text}
              </p>
            )}

            <h2 className="kicker">
              <span>
                The field
                <span className="aside num">
                  {" "}
                  · {forecasterCount}{" "}
                  {forecasterCount === 1 ? "forecaster" : "forecasters"}
                  {summary.average !== null &&
                    ` · average ${pct(summary.average)}`}
                  {summary.low !== null &&
                    summary.high !== null &&
                    summary.high !== summary.low &&
                    ` · ${pct(summary.low)}–${pct(summary.high)}`}
                </span>
              </span>
            </h2>

            {field.length === 0 ? (
              <p className="lede">Nobody has forecasted this one yet.</p>
            ) : (
              <>
                <div className="legend">
                  <span className="key">
                    <i className="k-mine" /> You
                  </span>
                  <span className="key">
                    <i className="k-avg" /> Field average
                  </span>
                  {truth !== null && (
                    <span className="key">
                      <i className="k-truth" /> What happened
                    </span>
                  )}
                </div>

                <div className="cols axis-head">
                  <span className="lbl">Forecaster</span>
                  <Scale />
                  <span className="lbl r">
                    <button
                      type="button"
                      className="sort"
                      onClick={() => setDesc((d) => !d)}
                    >
                      Forecast {desc ? "↓" : "↑"}
                    </button>
                  </span>
                </div>

                {ordered.map((entry) => {
                  const lo =
                    truth === null ? 0 : Math.min(entry.forecast, truth);
                  const hi =
                    truth === null ? 0 : Math.max(entry.forecast, truth);
                  return (
                    <div
                      className={
                        entry.isYou ? "cols plotrow mine" : "cols plotrow"
                      }
                      key={entry.forecastId}
                    >
                      <span className="who">{entry.userName}</span>
                      <span className="plot">
                        <Ticks />
                        {summary.average !== null && (
                          <span
                            className="grid avg"
                            style={{ left: at(summary.average) }}
                          />
                        )}
                        {truth !== null && (
                          <span
                            className="tail"
                            style={{ left: at(lo), width: at(hi - lo) }}
                          />
                        )}
                        <span
                          className={entry.isYou ? "mark mine" : "mark"}
                          style={{ left: at(entry.forecast) }}
                        />
                        {truth !== null && (
                          <span className="truth" style={{ left: at(truth) }} />
                        )}
                      </span>
                      <span className="fig">
                        {pct(entry.forecast)}
                        {truth !== null && (
                          <span className="pen">
                            {((entry.forecast - truth) ** 2).toFixed(3)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Mounted only while open, so each dialog's `useState` initialisers
          re-seed from the prop rather than keeping their first values. */}
      {editOpen && (
        <PropEditDialog
          prop={prop}
          isOpen
          onClose={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}
      {resolveOpen && (
        <ResolutionDialog
          prop={prop}
          isOpen
          onClose={() => {
            setResolveOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
