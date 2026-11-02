/**
 * The grid the admin competition table is drawn on.
 *
 * It lives beside neither the page nor the row because both need it: the page
 * injects it, and a row is only laid out correctly inside it (the row hands its
 * cells straight to this grid with `display: contents`), so a story for the row
 * has to be able to inject it too.
 */
export const rowCss = `
.hxp .comps {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8.5rem 8.5rem 4.5rem 6rem 2.5rem;
  /* No column gap, and cells that stretch: each cell draws its own share of the
     row's hairline, so a gap would break that rule into six pieces. The air
     between columns is padding inside them instead. */
  gap: 0;
  align-items: stretch;
}
.hxp .comps > * { display: contents; }

.hxp .comphead > span {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 1.25rem 0 0.5rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .comphead > span + span,
.hxp .comp .cell { padding-left: 1.5rem; }
.hxp .comphead > span.n,
.hxp .comp .cell.n { text-align: right; }

.hxp .comp > * {
  padding: 0.75rem 0;
  /* one line box for every cell, so the name, the dates and the counts beside
     it sit on one baseline despite the difference in size */
  line-height: 1.5rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .comp .name {
  font-size: 0.9375rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.hxp .comp .name a { color: inherit; text-decoration: none; }
.hxp .comp:hover .name a {
  color: var(--red-text);
  border-bottom: 1px solid var(--red-text);
}
.hxp .comp .cell {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}
/* The counts are figures to be read against each other, not labels. */
.hxp .comp .cell.n { font-size: 0.8125rem; letter-spacing: 0; color: var(--ink); }
.hxp .comp .cell .none { color: var(--ink-faint); }

/* The trigger sits in a cell rather than being one. As a grid item it stretched
   to the full row — 40x49 for a 16x18 glyph — and the focus ring, drawn outside
   that box, landed on the number in the column to its left. The cell keeps
   drawing the row's hairline; the button is now the size of what it shows. */
.hxp .comp .menucell {
  display: flex;
  align-items: center;
  justify-content: center;
}
.hxp .comp .act {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 1rem;
  line-height: 1;
  width: 1.75rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-faint);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.hxp .comp .act:hover,
.hxp .comp .act[data-state="open"] { color: var(--red-text); }
/* the UA ring is blue, which is the one colour this design does not have */
.hxp .comp .act:focus-visible {
  outline: 2px solid var(--red-text);
  outline-offset: 1px;
}

/* The page's one action, set in the section head beside the way back. */
.hxp h2.kicker .tools {
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
}
.hxp h2.kicker .make {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--ink);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
}
.hxp h2.kicker .make:hover { color: var(--red-text); }
.hxp h2.kicker .make:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }

@media (max-width: 46rem) {
  .hxp .comps { grid-template-columns: minmax(0, 1fr) 3.5rem 5rem 2.5rem; }
  /* the competition names the row; its dates and counts sit on the line below */
  .hxp .comp .name {
    grid-column: 1 / -1;
    border-bottom: 0;
    padding-bottom: 0.125rem;
  }
  .hxp .comp .due { padding-left: 0; }
  .hxp .comp .ends { display: none; }
  .hxp .comphead > span:first-child { grid-column: 1 / -1; }
  .hxp .comphead > span:not(:first-child) { display: none; }
  /* the way back and the new-competition button stack, or the button is
     pushed past the trim and clipped */
  .hxp h2.kicker .tools { flex-wrap: wrap; justify-content: flex-end; gap: 0.25rem 1.5rem; }
}
`;
