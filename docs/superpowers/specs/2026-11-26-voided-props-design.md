# Voided Props — Design

> **Historical.** This document records a plan as it stood when it was written.
> It is kept for the reasoning, not as a description of the codebase — files it
> names may since have been renamed, moved or deleted. Do not read it as
> current guidance, and do not edit it to match today: that would falsify the
> record it exists to be.

**Date:** 2026-11-26
**Status:** approved in conversation (approach and constraints); calls marked
*(my call)* were made while writing and not discussed.

## 1. What we are building

Some props are contingent: they only make sense if a condition holds. The
motivating example:

> Anthropic's market cap is higher than OpenAI's at the end of 2027.
> *Compared at the close of the last trading day of 2027, counting all share
> classes. Voided if OpenAI is not publicly traded at that time.*

If OpenAI is still private at the end of 2027, the prop is neither true nor
false. It is **voided**: settled, with no outcome, and scored for nobody.

The same mechanism covers a prop that turns out to be unanswerable for any
other reason (badly worded, the source stopped publishing). The resolution
notes say why.

### Goals

- Anyone who may resolve a prop may void it (its owner, an admin of its
  competition, or a site admin), from the web and from the MCP `resolve_prop`
  tool.
- A voided prop drops out of every score: leaderboards, category scores, a
  forecaster's breakdown, calibration.
- Everywhere a prop's state is shown, a voided prop reads as voided, never as
  "No" and never as still awaiting a result.
- A void can be undone or corrected the same way a resolution can: overwrite
  it, or unresolve the prop.

### Non-goals

- **A structured "void condition" on the prop.** The condition lives in the
  prop's notes, as in the example. A column only pays off if the UI should flag
  contingent props before they settle; nobody asked for that.
- **Voiding one option of a choice prop.** A void is of the whole prop.
- **Refusing forecasts server-side on a voided prop.** The forecast actions
  check deadlines, not resolutions, so a prop resolved before its deadline is
  already forecastable server-side; voided props inherit that. The UI hides the
  controls (§5.1). Closing that gap for both is a separate change.
- **Notifications.** None are sent on resolution today.

### Anti-goals

- A voided prop changing anyone's score, or being counted as a "No" anywhere.
- A voided prop making a forecaster "incomplete" for skipping it.

## 2. Approaches

**A — a void is a kind of resolution (chosen).** One `resolutions` row per
prop already means "settled"; a boolean on it says the settlement was a void.
The row's `notes`, `user_id` and timestamps record why, who and when; the
existing overwrite and unresolve paths undo it; row-level security is
unchanged, since whoever may write the row may void. Scores come out null on
their own (no answer, no option rows), so every `AVG(score)` already skips
them. The cost: about eight places read `resolution_id IS NOT NULL` as
"resolved", and a voided prop now passes that test. That is mostly right (it
is no longer pending), but displays have to tell the two apart.

**B — a void lives on the prop** (`props.voided_at`, `props.void_reason`).
Keeps `resolutions` purely about outcomes, but gives a prop two "settled"
markers that a cross-table trigger must keep exclusive, every resolved-check
needs a second condition, and the score view needs an explicit null. Rejected
as more moving parts for the same result.

## 3. Data model

One migration, `migrations/<timestamp>_add-voided-resolutions.ts`, regenerating
`lib/migrations/manifest.ts` after.

### 3.1 The column

```sql
ALTER TABLE resolutions ADD COLUMN voided boolean NOT NULL DEFAULT false;
```

A boolean, not a status enum: there is no third state in sight. Existing rows
become `false`; no backfill.

### 3.2 The three rules, and what enforces each

| Rule | Enforced by |
|---|---|
| A voided resolution has no answer value | **CHECK** `resolutions_voided_has_no_value CHECK (NOT voided OR resolution IS NULL)`. Same-row, so declarative. |
| A resolution that is not voided has a value exactly when its prop is binary | The existing BEFORE trigger function `check_resolution_matches_prop_kind`, replaced to skip voided rows: `IF NOT NEW.voided AND ((prop_kind_of(NEW.prop_id) = 'binary') <> (NEW.resolution IS NOT NULL))`. It needs the prop's kind, so it cannot be a CHECK. |
| A voided resolution has no `resolution_options` rows | A **deferred constraint trigger** (`CREATE CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE … DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`) on both `resolutions` and `resolution_options`, sharing one function that raises if the resolution is voided and has any option rows. |

The third rule is deferred because `resolveProp` overwrites in the order:
update the header, delete the old option rows, insert new ones. Voiding a
resolved choice prop therefore sets `voided = true` while the old option rows
still exist; a row-by-row check would reject a transaction that ends valid.
Checking at commit makes the order irrelevant. This follows the precedent of
`prop_options_prop_text_unique`, deferred for the same reason. The function is
`SECURITY DEFINER` like `prop_kind_of`, so row-level security cannot hide the
rows it counts, with `search_path` pinned *(my call)*.

`down()` drops the triggers, function and constraint, restores the original
kind-check function verbatim, recreates the views as they were, and drops the
column.

### 3.3 Views

Recreated from their definitions in `1788220800000_add-choice-props.ts` (the
latest), each gaining one column:

- `v_props`: `resolutions.voided AS resolution_voided` (null when unresolved).
- `v_forecasts`: the same column, and `score` gets an explicit
  `CASE WHEN resolutions.voided THEN NULL ELSE … END` around the existing
  expression. It is already null for a voided prop, but only as a side effect
  of how null propagates through the formulas; the guard makes it deliberate.
- `v_prop_options`: unchanged. A voided choice prop has no option rows, so
  every `outcome` reads null.

### 3.4 Types

`types/db_types.ts`: `ResolutionsTable.voided: Generated<boolean>`;
`VPropsView` and `VForecastsView` gain `resolution_voided: boolean | null`.

## 4. Writing a void

### 4.1 Core

`resolveProp` in `lib/core/props.ts` takes `voided?: boolean`. Validation, for
every kind: `voided: true` forbids `resolution` and `outcomes`; otherwise the
existing per-kind rules apply. A void writes the header as
`{ resolution: null, voided: true, notes }` and deletes the prop's option rows.
A non-void write sets `voided: false` explicitly, so overwriting a void with an
answer un-voids it. The "already has a resolution" refusal and `overwrite`
work as today.

`unresolveProp` and `deleteResolution` are unchanged: deleting the row clears
the void with it.

### 4.2 Web

`resolveProp` in `lib/db_actions/props.ts` passes `voided` through.

The resolution dialog gains a **Void** choice: for a binary prop the radios
become True / False / Void / Unresolved; for a choice prop, Resolved / Void /
Unresolved. Seeded from `resolution_voided`. Submitting Void calls
`resolveProp({ voided: true, notes, overwrite: true })`. The notes hint reads
"Why it was voided. Markdown works." when Void is selected *(my call on
copy)*.

### 4.3 MCP

`resolve_prop` gains `voided: boolean` (optional). Its description says when
to use it: the prop's own terms void it (a condition it depended on did not
hold) or it cannot be answered, with notes saying why, and no `resolution` or
`outcomes`.

## 5. Reading a void

### 5.1 Status

`PropStatus` (`lib/prop-status.ts`) gains `"voided"`, which takes precedence
over everything else. `getPropStatusFromProp` reads `resolution_voided`.
Labels: "Voided" on the prop sheet kicker and the open-props list,
`getPropStatusLabel` → "Voided". Because the prop pages allow forecasting only
when the status is `"open"`, a voided prop's forecast controls disappear with
no further change. The open-props list's "settled" tab already takes every
status that is neither open nor unresolved.

### 5.2 Prop lists

Voided props sit in the **Resolved** bucket (`resolvedProps`, the competition
counts and the admin counts keep reading `resolution_id`): they are settled.
`PropView` gains `voided: boolean`; on a voided prop the axis layout draws no
truth mark (it has none already) and prints **Void** in the penalty cell where
it would otherwise print "—" *(my call)*. `penaltyOf` returns null for a
voided prop explicitly.

### 5.3 Competition overview

`build-view-data.ts`: a voided prop is not **open** and is never in the
"to forecast" list, even before its deadline, so nobody is nagged to forecast
a void. It still counts as resolved.

### 5.4 Scores

- Leaderboards, category scores, the per-forecaster breakdown: they read
  `v_forecasts.score IS NOT NULL`, so voided props drop out with no code
  change. Covered by tests.
- **Completeness** (`getCompetitionScores`): today it compares each user's
  count of forecast props against the count of all props. Both counts exclude
  voided props, so skipping a prop that was later voided does not make you
  incomplete, and forecasting one does not cover for a real gap.
- Calibration filters on `resolution !== null`, which a void never has.

### 5.5 Dashboard

`getRecentlyResolvedForecasts` excludes voided props. The "recently resolved"
card shows your forecast against the outcome; a void has no outcome, and the
card's binary-only filter would otherwise render a null resolution as "No"
*(my call: exclude rather than draw a void card)*.

### 5.6 MCP reads

`PropResult.status` gains `"voided"`, and `list_props`'s `status` filter
accepts it. `resolution` stays null for a voided prop.

## 6. Testing

- **Schema (container):** the CHECK rejects `voided = true` with a value; the
  kind trigger accepts a voided binary row with no value and still rejects a
  non-voided binary row without one; the deferred trigger rejects option rows
  under a voided header at commit, in either insertion order, and accepts the
  overwrite order (void a resolved choice prop, then delete its options, in one
  transaction).
- **Scoring (container):** a voided prop's `v_forecasts.score` is null for all
  three kinds; competition averages and completeness ignore it.
- **Core (container):** `resolveProp` voids, refuses `voided` with
  `resolution`/`outcomes`, overwrites void ↔ answer both ways, and enforces the
  same permissions as resolving; the RLS suite covers voiding as a user action.
- **MCP (container):** `resolve_prop` with `voided`; `list_props` status
  filter.
- **Unit:** `getPropStatus` precedence; `penaltyOf`; `buildViewData` open/owed
  counts; the resolution dialog story gains a voided state.

## 7. Left to the builder

Exact styling of the Void marker in the penalty cell, within the sheet's
existing vocabulary (mono, muted; red is spoken for). Migration timestamp.
