# Voided Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a prop be settled as *voided* (no outcome, scored for nobody), from the web and from MCP, and show it as voided everywhere.

**Architecture:** A void is a resolution: `resolutions.voided boolean`, guarded by a CHECK, the existing kind trigger, and a deferred constraint trigger against option rows. Views expose `resolution_voided`; `PropStatus` gains `"voided"`; readers that show outcomes or count completeness learn to skip it.

**Tech Stack:** Next.js App Router, Kysely + PostgreSQL (raw SQL migrations), Vitest (+ testcontainers), MCP SDK with zod.

**Spec:** `docs/superpowers/specs/2026-11-26-voided-props-design.md`

## Global Constraints

- Column name `voided`; view column `resolution_voided`; status value `"voided"`; display label "Voided"; penalty cell text "Void".
- Write parameter is `voided?: boolean` in core, web action and MCP `resolve_prop` alike.
- `voided: true` forbids `resolution` and `outcomes` for every kind.
- Migration file `migrations/1795721754183_add-voided-resolutions.ts`; run `npx tsx scripts/generate-migration-manifest.ts` after creating it.
- Views are recreated from their definitions in `migrations/1788220800000_add-choice-props.ts`, plus the new column only.
- Container tests run with `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run <path>` (Docker must be running). Plain `npx vitest run <path>` for unit tests.
- No raw Tailwind palette colours; red is reserved ("this is you / failed / live"), so the Void marker is muted mono.

## Review Focus

1. **Voiding a choice prop that was already resolved** (options rows exist) must succeed in one call and leave no option rows — Task 2 tests it through `resolveProp`, Task 1 at the SQL level.
2. **Un-voiding by overwrite** (void → yes/no answer, void → choice outcomes) must clear `voided` — Task 2.
3. **A voided binary prop must never read as "No"** anywhere a null resolution used to be impossible after resolution: dashboard recent results (Task 5), MCP `resolution` (Task 4), the prop sheet kicker (Task 3).
4. **A user who skipped a later-voided prop is still complete**, and one who forecast only the voided prop is still incomplete — Task 5.
5. **A voided prop before its deadline** is not forecastable in the UI and not in the "to forecast" list — Tasks 3 and 6.

---

### Task 1: Schema — column, guards, views, types

**Files:**
- Create: `migrations/1795721754183_add-voided-resolutions.ts`
- Modify: `lib/migrations/manifest.ts` (regenerated), `types/db_types.ts` (`ResolutionsTable`, `VPropsView`, `VForecastsView`)
- Test: `tests/integration/voided-props-schema.integration.test.ts` (new)

**Interfaces:**
- Produces: `resolutions.voided` (`Generated<boolean>` in `ResolutionsTable`); `resolution_voided: boolean | null` on `VPropsView` and `VForecastsView`.

- [ ] **Step 1: Write the failing tests** (pattern: `tests/integration/choice-props-schema.integration.test.ts`; factory `createResolution(propId, { resolution: null, voided: true })` works once the type has the column)
  - `rejects a voided resolution that carries a value`: insert `{ prop_id, resolution: true, voided: true }` on a binary prop → rejects `/resolutions_voided_has_no_value/`.
  - `accepts a voided binary resolution with no value`: insert `{ resolution: null, voided: true }` → ok; a non-voided binary with null still rejects `/binary props/`.
  - `rejects outcome rows under a voided header at commit`: on a `one_of` prop, inside `db.transaction()`: insert voided header, insert one `resolution_options` row → the transaction rejects `/voided resolution/`. Second case: insert a normal choice resolution with outcomes, then in a transaction `UPDATE resolutions SET voided = true` without deleting options → rejects.
  - `accepts voiding a resolved choice prop when its outcomes go in the same transaction`: `createChoiceResolution(...)`, then in one transaction update header `voided = true`, then delete its `resolution_options` → commits; header `voided` is true and no option rows remain.
  - `exposes resolution_voided through v_props and v_forecasts`: unresolved prop → `null`; normal resolution → `false`; voided → `true`.
  - `scores a voided prop as null for every kind`: binary, one_of and any_of props, each with a forecast and a voided resolution → `v_forecasts.score` is `null`.

- [ ] **Step 2: Run to verify they fail**
  Run: `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run tests/integration/voided-props-schema.integration.test.ts`
  Expected: FAIL (column `voided` does not exist).

- [ ] **Step 3: Write the migration**
  `up()`:
  1. `ALTER TABLE resolutions ADD COLUMN voided boolean NOT NULL DEFAULT false` and `ADD CONSTRAINT resolutions_voided_has_no_value CHECK (NOT voided OR resolution IS NULL)`.
  2. `CREATE OR REPLACE FUNCTION check_resolution_matches_prop_kind()` — same body as 1788220800000 but the condition is `IF NOT NEW.voided AND ((prop_kind_of(NEW.prop_id) = 'binary') <> (NEW.resolution IS NOT NULL))`.
  3. `CREATE FUNCTION check_voided_resolution_has_no_outcomes() RETURNS trigger … LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` — the resolution id is `NEW.id` when `TG_TABLE_NAME = 'resolutions'`, else `NEW.resolution_id`; raise `'a voided resolution has no option outcomes (resolution %)'` if that resolution is voided and has any `resolution_options` row; `RETURN NULL`.
  4. Two `CREATE CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE ON <table> DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_voided_resolution_has_no_outcomes()`: `enforce_voided_no_outcomes` on `resolutions`, `enforce_no_outcomes_when_voided` on `resolution_options`.
  5. Drop `v_forecasts`, `v_props`; recreate both from 1788220800000 with `resolutions.voided AS resolution_voided` added after `resolution_user_id`; in `v_forecasts` wrap the score as `CASE WHEN resolutions.voided THEN NULL ELSE CASE props.kind … END END AS score`. `v_prop_options` is untouched.
  `down()`: drop both triggers and the function; restore `check_resolution_matches_prop_kind` verbatim from 1788220800000; drop and recreate the two views verbatim from 1788220800000; drop the CHECK and the column. Header comment explains the deferral (resolveProp's update-then-delete order; precedent `prop_options_prop_text_unique`).

- [ ] **Step 4: Regenerate the manifest and update types**
  Run: `npx tsx scripts/generate-migration-manifest.ts`. In `types/db_types.ts`: `ResolutionsTable.voided: Generated<boolean>` with a doc comment ("A void: settled with no outcome. Never set together with `resolution` or option rows."); `resolution_voided: boolean | null` after `resolution_notes`/`resolution_user_id` in `VPropsView` and `VForecastsView`.

- [ ] **Step 5: Run to verify they pass**, plus `tests/integration/choice-props-schema.integration.test.ts`, `tests/integration/choice-props-scoring.integration.test.ts`, `lib/migrations/manifest.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit** — `git add migrations lib/migrations/manifest.ts types/db_types.ts tests/integration/voided-props-schema.integration.test.ts && git commit -m "Add voided resolutions to the schema"`

---

### Task 2: Writing a void — core and web action

**Files:**
- Modify: `lib/core/props.ts` (`resolveProp`), `lib/db_actions/props.ts` (`resolveProp` args)
- Test: `lib/db_actions/props.container.test.ts` (`resolveProp against the database`), `tests/integration/user-actions-rls.integration.test.ts`

**Interfaces:**
- Consumes: `resolutions.voided` (Task 1).
- Produces: `resolveProp(currentUser, { propId, resolution?, outcomes?, voided?: boolean, notes?, overwrite? })` in core; the web action takes the same args minus `currentUser`.

- [ ] **Step 1: Write the failing tests** in `resolveProp against the database` (extend `storedHeader` to select `voided`):
  - `voids a binary prop`: `resolveProp({ propId, voided: true, notes: "OpenAI stayed private" })` → success; header `{ resolution: null, voided: true, notes: "OpenAI stayed private", user_id: admin.id }`.
  - `voids a resolved one_of prop and clears its outcomes`: resolve with outcomes, then `resolveProp({ propId, voided: true, overwrite: true })` → success; header id unchanged, `voided: true`; `storedOutcomes` is `[]`.
  - `un-voids by overwriting with an answer`: binary: void, then `{ resolution: false, overwrite: true }` → `{ resolution: false, voided: false }`. any_of: void, then outcomes with `overwrite: true` → `voided: false`, outcome rows present.
  - `refuses voided together with resolution or outcomes`: `{ voided: true, resolution: true }` on binary and `{ voided: true, outcomes: [...] }` on one_of → `success: false`, `VALIDATION_ERROR`, no header row written.
  - `refuses to void an already-resolved prop without overwrite`: error contains `already has a resolution`.
  - In the RLS suite's yes/no lifecycle test (line ~344), add `expectOk(await resolveProp({ propId, voided: true, overwrite: true }))` after the second resolve; in "who may resolve a prop", a forecaster's `resolveProp({ propId, voided: true })` is refused like a resolution.

- [ ] **Step 2: Run to verify they fail**
  Run: `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run lib/db_actions/props.container.test.ts tests/integration/user-actions-rls.integration.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** In core `resolveProp`: before the per-kind checks, if `voided` and (`resolution !== undefined` or `outcomes !== undefined`) return `error("A void carries no resolution or outcomes", VALIDATION_ERROR)`; skip the per-kind checks and option validation when `voided`. Header write (insert and update) sets `resolution: voided ? null : headerValue` and `voided: !!voided`. After the header write: when `voided`, delete the resolution's option rows (for any kind; a no-op for binary); otherwise the existing choice delete-and-insert. Log `voided` with the other fields. Update the doc comment. Web action: add `voided?: boolean` to its arg type with a one-line doc.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Let resolveProp void a prop"`

---

### Task 3: Status — `"voided"` and its labels

**Files:**
- Modify: `lib/prop-status.ts`, `components/prop-sheet/prop-sheet.tsx` (`STATUS_LABEL`), `components/open-props/open-props.tsx` (its status label map), any other `Record<PropStatus, …>` `tsc` reports
- Test: `lib/prop-status.test.ts`

**Interfaces:**
- Consumes: `resolution_voided` on `VProp` (Task 1).
- Produces: `PropStatus` includes `"voided"`; `PropStatusOptions.isVoided?: boolean`; `getPropStatusFromProp(prop)` accepts `resolution_voided?: boolean | null`.

- [ ] **Step 1: Write the failing tests** in `lib/prop-status.test.ts`:
  - `getPropStatus(futureDate, null, { isVoided: true, isResolved: true })` → `"voided"` (beats open).
  - `getPropStatus(pastDate, null, { isVoided: true, isResolved: true })` → `"voided"`.
  - `getPropStatusFromProp({ ...base, resolution: null, resolution_id: 7, resolution_voided: true })` → `"voided"`.
  - `getPropStatusLabel("voided")` → `"Voided"`.

- [ ] **Step 2: Run to verify they fail.** `npx vitest run lib/prop-status.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `isVoided` is checked first in `getPropStatus`; `getPropStatusFromProp` passes `isVoided: prop.resolution_voided === true`. Add `voided: "Voided"` to every status label map (`npx tsc --noEmit` lists them).

- [ ] **Step 4: Verify.** `npx vitest run lib/prop-status.test.ts` PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git commit -m "Add a voided prop status"`

---

### Task 4: MCP — read and write a void

**Files:**
- Modify: `lib/mcp/tools.ts` (`PropResult.status`, `propStatus`, `listPropsTool` arg type, `resolvePropTool`), `lib/mcp/server.ts` (`propStatus` zod enum, `list_props` description, `resolve_prop` input schema and description)
- Test: `tests/integration/mcp-tools.integration.test.ts` (`resolvePropTool`, `listPropsTool`)

**Interfaces:**
- Consumes: core `resolveProp` `voided` (Task 2); `"voided"` status (Task 3).
- Produces: `PropResult.status: "open" | "closed" | "resolved" | "voided"`; `resolvePropTool(caller, { prop_id, resolution?, outcomes?, voided?, notes?, overwrite? })`.

- [ ] **Step 1: Write the failing tests:**
  - `lets the owner void a personal prop`: `resolvePropTool(as(owner), { prop_id, voided: true, notes: "condition failed" })` → `ok`, `data` matches `{ status: "voided", resolution: null }`.
  - `lists voided props under status voided`: one voided and one resolved personal prop; `listPropsTool(as(owner), { personal: true, status: "voided" })` returns only the voided id; `status: "resolved"` returns only the resolved one.

- [ ] **Step 2: Run to verify they fail.** `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run tests/integration/mcp-tools.integration.test.ts`.

- [ ] **Step 3: Implement.** `propStatus` maps `"voided"` → `"voided"`. zod: `propStatus = z.enum(["open", "closed", "resolved", "voided"])`; `resolve_prop` input gains `voided: z.boolean().optional()`. Descriptions (exact copy):
  - `list_props`: "…Filter by status (open for forecasts, closed awaiting resolution, resolved, or voided). …"
  - `resolve_prop`: "Record how a prop turned out: resolution (true/false) for a binary prop, or outcomes (one per option) for a choice prop. Pass voided: true instead, with neither, when the prop's own terms void it (a condition it depended on did not hold) or it cannot be answered; say why in notes. A voided prop is scored for nobody. A prop that is already resolved or voided is left alone unless overwrite is true."
  `resolvePropTool` passes `voided` through and its summary reads `Voided prop N` when voided.

- [ ] **Step 4: Verify** that file plus `lib/mcp/server.test.ts` and `tests/integration/mcp-server.integration.test.ts` PASS.

- [ ] **Step 5: Commit** — `git commit -m "MCP: void props and filter by voided"`

---

### Task 5: Scores and dashboard skip voids

**Files:**
- Modify: `lib/db_actions/competition-scores.ts` (`getCompetitionScores` completeness), `lib/db_actions/forecasts.ts` (`getRecentlyResolvedForecasts`)
- Test: `lib/db_actions/competition-scores.container.test.ts` (new; mock pattern from `lib/db_actions/props.container.test.ts`), `lib/db_actions/forecasts.test.ts` if it covers the recent query, else the same new container file

**Interfaces:**
- Consumes: `resolution_voided` on `v_props`/`v_forecasts`, `resolutions.voided` (Task 1).

- [ ] **Step 1: Write the failing tests** (competition with props P1, P2 and P3; P3 voided):
  - `a forecaster who skipped only the voided prop is complete`: forecasts on P1, P2 (both resolved) → user not in `incompleteUserIds`.
  - `forecasting the voided prop does not cover a real gap`: forecasts on P1, P3 → user in `incompleteUserIds`.
  - `the voided prop does not move the average`: overall score equals the mean over P1 and P2 only.
  - `getRecentlyResolvedForecasts leaves out voided props`: user forecast a resolved prop and a voided one (voided updated later) → only the resolved prop returned.

- [ ] **Step 2: Run to verify they fail.** `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run lib/db_actions/competition-scores.container.test.ts`.

- [ ] **Step 3: Implement.** Total-props count: `selectFrom("props").leftJoin("resolutions", …)` (or `v_props`) and exclude rows where voided is true; per-user count: add `where resolution_voided is not true` on `v_forecasts`. Recent query: add `.where("resolution_voided", "=", false)` (resolution_id is already not null there). Comment each with the reason.

- [ ] **Step 4: Verify** PASS, plus `npx vitest run lib/db_actions/competition-scores.test.ts lib/db_actions/forecasts.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "Leave voided props out of completeness and recent results"`

---

### Task 6: Showing and choosing a void in the UI

**Files:**
- Modify: `components/prop-list/types.ts` (`PropView.voided`, `penaltyOf`), `components/prop-list/build-prop-views.ts`, `components/prop-list/layout-axis.tsx` (penalty cell), `components/prop-list/sheet.tsx` (a `.pen.void` style if needed), `components/user-scores/build-sections.ts` (`voided: false`), every other `PropView` literal `tsc` reports (fixtures), `components/competition-view/build-view-data.ts`, `components/dialogs/resolution-dialog.tsx`, `components/dialogs/resolution-dialog.stories.tsx`
- Test: `components/prop-list/*.test.ts` if present else `components/prop-list/types.test.ts` (new), `components/competition-view/build-view-data.test.ts`

**Interfaces:**
- Consumes: `resolution_voided` on `PropWithUserForecast` (Task 1); web `resolveProp({ voided })` (Task 2).
- Produces: `PropView.voided: boolean`.

- [ ] **Step 1: Write the failing tests:**
  - `penaltyOf` returns `null` for `{ ...resolvedBinary, voided: true, outcome: null, yourForecast: 0.7 }`.
  - `buildPropViews` sets `voided: true` from `resolution_voided: true`, `false` from `null`.
  - `buildViewData`: a voided prop whose close date is in the future is not counted `open` and is not in the viewer's owed list, and is counted `resolved`.

- [ ] **Step 2: Run to verify they fail.** `npx vitest run components/prop-list components/competition-view/build-view-data.test.ts`.

- [ ] **Step 3: Implement.**
  - `PropView.voided` (doc: "Settled with no outcome; scored for nobody."); `penaltyOf` returns null when `voided`; `buildPropViews` maps `p.resolution_voided === true`.
  - `layout-axis.tsx`: where a resolved row prints `<Penalty …>` (binary row and the choice "Prop penalty" row), print `<span className="pen none">Void</span>` when `prop.voided`.
  - `build-view-data.ts`: `isOpen` is false for `p.resolution_voided === true`.
  - Resolution dialog: binary radios `[["true","True"],["false","False"],["void","Void"],["unresolved","Unresolved"]]`; choice mode radios Resolved / Void / Unresolved (`ChoiceMode` gains `"void"`). Seed: `prop.resolution_voided` → `"void"` before the existing seeds. Submit: when void is selected, `resolvePropAction.execute({ propId, voided: true, notes: notes.trim() || undefined, overwrite: true })`. The outcomes field shows only for choice mode `"resolved"`. Notes hint when void is selected: "Why it was voided. Markdown works."; button label "Void" when void is selected.
  - Story: add a `Voided` story (binary, `resolution_id: 1`, `resolution: null`, `resolution_voided: true`, notes set), and add `resolution_voided: null` to the base fixture.

- [ ] **Step 4: Verify.** Tests PASS; `npx tsc --noEmit`; `npm run lint`; `npm run build-storybook` succeeds.

- [ ] **Step 5: Commit** — `git commit -m "Show voided props, and let the resolution dialog void one"`

---

### Task 7: Whole-branch verification

- [ ] Run `npm run lint`, `npx tsc --noEmit`, `TEST_USE_CONTAINERS=true npx tsx node_modules/.bin/vitest run` (baseline: 80 files / 824 tests passing), `npm run build` (with `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy NODE_ENV=production` as CI does). All must pass.
- [ ] Update `CLAUDE.md` "Prop kinds"/"Tables" lines to mention `resolutions.voided` (one sentence: a void is a resolution with no outcome, scored for nobody), and commit.
