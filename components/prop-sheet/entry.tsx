"use client";

import React, { useRef, useState } from "react";

/**
 * The controls a reader uses to set a probability, shared by the single-prop
 * sheet and the open-props list.
 *
 * They live together because the two surfaces have to agree: a rule you drag
 * on one page and a rule you drag on the other are the same instrument, and
 * the app has already been bitten once by two implementations of one idea
 * drifting apart.
 */

export const at = (v: number) => `${v * 100}%`;

/** Whole percents only: the scale is read in percent, so it is set in percent. */
export const snap = (v: number) => Math.round(v * 100) / 100;

const TICK_STOPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export const entryCss = `
/* The scale a number is set on. Same rule, same square mark, same ticks as
   every scale in the app — the control is the instrument, not a widget. */
.hxp .gauge {
  position: relative;
  height: 3rem;
  touch-action: none;
}
.hxp .gauge.live { cursor: pointer; }
.hxp .gauge:focus-visible { outline: 2px solid var(--red); outline-offset: 4px; }
.hxp .gauge .axisline {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: color-mix(in oklab, var(--ink) 28%, transparent);
}
.hxp .gauge .grid {
  position: absolute;
  top: 36%;
  bottom: 36%;
  width: 1px;
  background: color-mix(in oklab, var(--ink) 18%, transparent);
}
.hxp .gauge .grid.mid { top: 22%; bottom: 22%; background: color-mix(in oklab, var(--ink) 30%, transparent); }
.hxp .gauge .mark {
  position: absolute;
  top: 50%;
  width: 15px;
  height: 15px;
  background: var(--red);
  transform: translate(-50%, -50%);
}
/* where the field sits, so a reader can see the crowd while setting their own */
.hxp .gauge .crowd {
  position: absolute;
  top: 50%;
  width: 2px;
  height: 1rem;
  background: color-mix(in oklab, var(--ink) 45%, transparent);
  transform: translate(-50%, -50%);
}
/* clear of the ticks, not just of the rule: the ticks reach up to 36% and a
   hint centred over them prints straight through the scale */
.hxp .gauge .hint {
  position: absolute;
  inset: 0 0 68% 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  pointer-events: none;
}
.hxp .scale {
  position: relative;
  height: 1rem;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
}
.hxp .scale span { position: absolute; top: 0; }
.hxp .scale .mid { transform: translateX(-50%); }
.hxp .scale .hi { transform: translateX(-100%); }

/* A probability typed in place. The number and its sign sit in one box on one
   rule, so the field reads as a single value rather than an input with a stray
   percent beside it. */
.hxp .optbox {
  display: inline-flex;
  align-items: baseline;
  color: var(--red-text);
  font-weight: 700;
  border-bottom: 1px solid var(--red);
  padding-bottom: 0.125rem;
}
.hxp .optbox.locked { color: var(--ink-muted); font-weight: 400; border-bottom-color: transparent; }
.hxp .optbox input {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  width: 3ch;
  text-align: right;
  outline: none;
}
.hxp .optbox input::placeholder { color: var(--ink-faint); }
.hxp .optbox .sign { font-family: var(--font-roboto-mono), ui-monospace, monospace; font-size: 0.8125rem; }
/* iOS zooms the page when a field under 16px takes focus; on a touch screen
   the typed percentage is 16px. The width is in ch, so it grows with it. */
@media (pointer: coarse) {
  .hxp .optbox input, .hxp .optbox .sign { font-size: 1rem; }
}
`;

/** The rule and its ticks, drawn the same way wherever a scale appears. */
export function Ticks() {
  return (
    <>
      <span className="axisline" />
      {TICK_STOPS.map((t) => (
        <span
          key={t}
          className={t === 0.5 ? "grid mid" : "grid"}
          style={{ left: at(t) }}
        />
      ))}
    </>
  );
}

/** The 0 / 50 / 100 labels under a gauge. */
export function Scale() {
  return (
    <div className="scale">
      <span style={{ left: 0 }}>0%</span>
      <span className="mid" style={{ left: "50%" }}>
        50%
      </span>
      <span className="hi" style={{ left: "100%" }}>
        100%
      </span>
    </div>
  );
}

/**
 * A probability set by dragging along the rule.
 *
 * Pointer capture means a drag that wanders off the rule keeps tracking and
 * the release still lands here, and the arrow keys move it a percent at a time
 * (ten with shift) so it is usable without a pointer at all.
 */
export function Gauge({
  value,
  onChange,
  disabled = false,
  crowd = null,
  hint,
  label = "Your forecast",
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** The field's average, marked but not settable. */
  crowd?: number | null;
  /** Shown above the rule when nothing is set yet. */
  hint?: string;
  label?: string;
}) {
  const rule = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const valueAt = (clientX: number): number | null => {
    const el = rule.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0) return null;
    return snap(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };

  return (
    <div
      ref={rule}
      className={disabled ? "gauge" : "gauge live"}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      aria-valuetext={
        value === null ? "Not set" : `${Math.round(value * 100)}%`
      }
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        const v = valueAt(e.clientX);
        if (v !== null) onChange(v);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const v = valueAt(e.clientX);
        if (v !== null) onChange(v);
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={(e) => {
        if (!dragging) return;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.shiftKey ? 0.1 : 0.01;
        const from = value ?? 0.5;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(snap(Math.max(0, from - step)));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(snap(Math.min(1, from + step)));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(1);
        }
      }}
    >
      <Ticks />
      {crowd !== null && crowd !== undefined && (
        <span className="crowd" style={{ left: at(crowd) }} />
      )}
      {value !== null && <span className="mark" style={{ left: at(value) }} />}
      {value === null && !disabled && hint && (
        <span className="hint">{hint}</span>
      )}
    </div>
  );
}

/**
 * A probability typed in place. Commits on blur or Enter and reverts on
 * Escape, the same contract every other entry in the app has.
 */
export function PercentField({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown =
    draft ?? (value === null ? "" : String(Math.round(value * 100)));
  return (
    <label className={disabled ? "optbox locked" : "optbox"}>
      <input
        value={shown}
        disabled={disabled}
        inputMode="numeric"
        placeholder="––"
        aria-label={label}
        onFocus={() =>
          setDraft(value === null ? "" : String(Math.round(value * 100)))
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          setDraft(null);
          if (draft === null || draft.trim() === "" || isNaN(n)) return;
          onChange(Math.max(0, Math.min(100, Math.round(n))) / 100);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <span className="sign">%</span>
    </label>
  );
}
