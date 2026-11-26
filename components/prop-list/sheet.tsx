/**
 * The print grammar the four prop-list layouts share, scoped to `.hxp`.
 * Same rules as the dashboard and the competition sheet: 2px ink opens a
 * section, 1px hairline separates two items, a head binds down (4rem above,
 * 1.5rem below), and red mono caps at 0.75rem/0.16em mean "section head" and
 * nothing else.
 */
export const sheetCss = `
.hxp {
  --paper: var(--riso-paper);
  --ink: var(--riso-ink);
  --red: var(--riso-red);
  --red-text: var(--riso-red-text);
  --rule: color-mix(in oklab, var(--ink) 22%, transparent);
  --ink-muted: color-mix(in oklab, var(--ink) 70%, transparent);
  --ink-faint: color-mix(in oklab, var(--ink) 38%, transparent);

  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink);
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
  line-height: 1.6;
}
/* --riso-paper, not --paper: the sheet's tokens are scoped to .hxp and do
   not resolve out here on the body. */
body:has(.hxp) { background: var(--riso-paper); }

.hxp::before {
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

.hxp .col {
  position: relative;
  z-index: 1;
  max-width: 58rem;
  margin: 0 auto;
  padding: 0 1.75rem 5rem;
}

.hxp .mono {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hxp .num { font-variant-numeric: tabular-nums; }
.hxp .muted { color: var(--ink-muted); }
.hxp .ink2 { color: var(--red-text); }

.hxp h2.kicker {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 400;
  color: var(--red-text);
  margin: 2rem 0 0;
  padding-bottom: 0.875rem;
  border-bottom: 2px solid var(--ink);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
/* The section head doubles as the chooser between the two settled lists, so it
   has to say it is pressable while still being the head. A rule under it and a
   caret after it, both in the head's own second ink; the rule thickens when the
   menu is open, the way the section rule below it means "this is the live
   one". */
.hxp h2.kicker .bucket {
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0 0 0.125rem;
  cursor: pointer;
  display: inline-flex;
  align-items: baseline;
  gap: 0.4em;
  border-bottom: 1px solid color-mix(in oklab, var(--red-text) 40%, transparent);
}
.hxp h2.kicker .bucket:hover,
.hxp h2.kicker .bucket[data-state="open"] {
  border-bottom-color: var(--red-text);
  border-bottom-width: 2px;
  padding-bottom: calc(0.125rem - 1px);
}
.hxp h2.kicker .bucket:focus-visible {
  outline: 2px solid var(--red-text);
  outline-offset: 3px;
}
.hxp h2.kicker .bucket .car { font-size: 0.8em; }

.hxp h2.kicker .asides {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
}
.hxp h2.kicker .aside {
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  color: var(--ink-muted);
}
.hxp h2.kicker a.aside { text-decoration: none; white-space: nowrap; }
.hxp h2.kicker a.aside:hover { color: var(--red-text); }

/* The masthead, set the way the competition overview sets its own, so the two
   sheets read as pages of one document rather than two designs. */
.hxp .masthead { padding: 2.5rem 0 0; }
.hxp .masthead h1 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0;
}
.hxp .masthead h1 a { color: inherit; text-decoration: none; }
.hxp .masthead h1 a:hover { color: var(--red-text); }
.hxp .masthead .meta {
  margin-top: 0.75rem;
  display: flex;
  gap: 0.5rem 1.5rem;
  flex-wrap: wrap;
  color: var(--ink-muted);
}

.hxp .lede {
  padding-top: 1.5rem;
  color: var(--ink-muted);
  max-width: 34rem;
}

/* the claim itself, wherever a layout sets it as reading matter */
.hxp .claim { font-size: 1rem; }
.hxp .claim a { color: inherit; text-decoration: none; }
.hxp .claim a:hover { color: var(--red-text); }
.hxp .cat {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* the two outcomes, set the same way everywhere */
.hxp .yes, .hxp .no {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hxp .yes { color: var(--ink); font-weight: 700; }
.hxp .no { color: var(--ink-muted); }

/* the penalty: the number the whole app is trying to minimise */
.hxp .pen {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
}
.hxp .none { color: var(--ink-faint); }
`;

/**
 * Every penalty is set the same way. A threshold that reddened the expensive
 * ones was tried and dropped: it made the reader hunt for a line rather than
 * read the column, and the tail beside each figure already shows the size of
 * the miss.
 */
export function Penalty({
  value,
  voided = false,
}: {
  value: number | null;
  /** A void costs nothing and says so, rather than reading as unscored. */
  voided?: boolean;
}) {
  if (voided) return <span className="pen none">Void</span>;
  if (value === null) return <span className="pen none">—</span>;
  return <span className="pen">{value.toFixed(3)}</span>;
}
