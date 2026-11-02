/**
 * The directory the users page is set as.
 *
 * It lives beside neither the page nor the entry because both need it: the page
 * injects it, and an entry is only set correctly inside it (the two gutters its
 * photo and its menu sit in), so a story for an entry has to be able to inject
 * it too.
 *
 * Two columns rather than one, because the page is a list of names and an
 * address each, and a name is nothing like 58rem wide. Set in one column, every
 * entry left a hand's width of blank paper between the address and the menu
 * that acts on it, and twenty-six accounts ran off the bottom of the screen.
 *
 * Module-level constant, no interpolation: this is a stylesheet, not content.
 */
export const ledgerCss = `
/* The masthead carries the count and the way back, so the only section heads
   on the page are the ones that name a group of accounts. */
.hxp .masthead .meta .back {
  margin-left: auto;
  text-decoration: none;
  white-space: nowrap;
}
.hxp .masthead .meta .back:hover { color: var(--red-text); }

/* The one control the page has, set the way every other control on the sheets
   is set: on a rule, not in a box. It is measured to the left column rather
   than to some width of its own, so its rule stops where that column's
   hairlines stop instead of a little short of them. */
.hxp .find {
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
  padding-top: 1.5rem;
}
.hxp .find input {
  flex: 0 1 calc(50% - 1.5rem);
  min-width: 0;
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  color: var(--ink);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--rule);
  padding: 0 0 0.375rem;
  outline: none;
}
.hxp .find input:focus { border-bottom-color: var(--ink); }
.hxp .find input::placeholder { color: var(--ink-faint); }
/* Beside the box it counts, not thrown to the far edge of the page. */
.hxp .find .tally {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
  white-space: nowrap;
}

/* Two columns of entries, filled the way an index is filled: down the first
   column and then down the second, so a reader looking for a name runs one
   finger down one column instead of zig-zagging across the page. The row count
   comes from the page, which is the only thing that knows how many names the
   group has.

   Column flow is also what earns the ruling: the hairlines break at the gutter
   because the columns really are two lists, and the 2px head runs across both
   because the group is one. */
.hxp .dir {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(var(--rows, 1), auto);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 3rem;
  align-items: stretch;
}

/* One account. The photo sits in a gutter on the left and the menu in a gutter
   on the right, both held open by the entry itself, so a name with a picture
   and a name without start on the same edge and every menu on the page falls
   down one line. */
.hxp .acct {
  position: relative;
  min-width: 0;
  padding: 0.8125rem 1.75rem 0.8125rem 3.25rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .acct .who { display: block; min-width: 0; }
.hxp .acct .face {
  position: absolute;
  left: 0;
  /* Measured against the type rather than against the boxes it sits in, because
     the boxes are mostly leading. The name's cap starts 19.85px down the entry
     and the address's descenders end at 53.54px, so the two lines of text are a
     33.7px block centred on 36.7px. A 2.5rem circle centred there clears the cap
     by about 3px at the top and the descenders by about 3px at the bottom. */
  top: 1.0625rem;
  display: block;
  /* the size the image is actually fetched at, so a face is never resampled */
  width: 2.5rem;
  height: 2.5rem;
  overflow: hidden;
  /* The one round thing on a sheet where nothing is rounded, which the navbar
     settled first: a photograph arrives with its own hard rectangular edge, and
     that edge belongs to whoever took the picture rather than to this page. Cut
     it to a circle and what is left is the face. */
  border-radius: 50%;
}
/* The photo prints as a photograph — in its own colour, on the stock. It is the
   one full-colour thing on a two-ink sheet, which is why it is small and why
   nothing else in the entry competes with it. */
.hxp .acct .face img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hxp .acct .nm {
  display: block;
  font-size: 0.9375rem;
  line-height: 1.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hxp .acct .nm a { color: inherit; text-decoration: none; }
/* The name reddens when the name is under the pointer, and not when some other
   part of the entry is: the address beside it is not a link, and an entry that
   looks clickable along its whole length but answers on one word of it is the
   kind of lie a reader only finds by clicking. */
.hxp .acct .nm a:hover {
  color: var(--red-text);
  border-bottom: 1px solid var(--red-text);
}
.hxp .acct .nm a:focus-visible {
  outline: 2px solid var(--red-text);
  outline-offset: 2px;
}
/* What the entry does say on hover is which entry it is: its own rule comes up
   to full ink, which is how the eye gets from a short name to the menu that
   acts on it without anything pretending to be a link. */
.hxp .acct:hover { border-bottom-color: var(--ink); }

.hxp .acct .em {
  display: block;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The one mark the directory still prints. A closed account files under
   Deactivated whatever else it was, so this is the only place the fact that it
   was an admin would otherwise be lost — which matters, because activating it
   hands that back. */
.hxp .acct .mark {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
  margin-left: 0.75rem;
}

/* A closed account is struck from the directory rather than shouted at: the
   whole entry goes pale, and the group it is filed under says why. */
.hxp .acct.off .nm,
.hxp .acct.off .em,
.hxp .acct.off .mark { color: var(--ink-faint); }
/* A photograph cannot be made pale by going faint the way the name above it
   can, so a closed account takes it off the plate the only way a print can be:
   out of ink, and down to a ghost. */
.hxp .acct.off .face {
  filter: grayscale(1);
  opacity: 0.45;
}
/* The reader's own entry is marked once, in the ink that means the reader
   everywhere else on the sheets. It is placed after the pale rule above so it
   still reads as you even on an account somebody has closed. */
.hxp .acct.mine .nm { font-weight: 700; color: var(--red-text); }
/* Red and bold say "you" to anyone who can see the page. Said again in words
   for anyone who cannot, since colour and weight are the whole of that mark.
   Its own rule rather than Tailwind's sr-only, so it holds up in a story too. */
.hxp .vh {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.hxp .acct .rowact {
  position: absolute;
  right: 0;
  /* centred on the name's line, not on the entry: the entry is two lines and
     the menu acts on the name */
  top: 0.6875rem;
}
/* The trigger is the size of a thing you can hit, not the size of the glyph it
   shows — the same square the competitions row settled on. */
.hxp .acct .menu {
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
/* The complaint about these was that they were hard to get to. On the entry
   the pointer is on, they are not also hard to see. */
.hxp .acct:hover .menu:not(:disabled) { color: var(--ink); }
.hxp .acct .menu:hover:not(:disabled) { color: var(--red-text); }
.hxp .acct .menu:disabled { cursor: default; opacity: 0.5; }
/* the trigger keeps focus when its menu closes; the UA ring is blue */
.hxp .acct .menu:focus-visible {
  outline: 2px solid var(--red-text);
  outline-offset: 1px;
}

@media (max-width: 46rem) {
  /* One column on a phone: two columns of a name and an address each would
     leave neither enough room to be read. */
  .hxp .dir {
    grid-auto-flow: row;
    grid-template-rows: none;
    grid-template-columns: minmax(0, 1fr);
  }
  .hxp .find { flex-wrap: wrap; }
  .hxp .find input { flex: 1 1 100%; }
}
`;
