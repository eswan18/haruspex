import { describe, expect, beforeEach } from "vitest";
import { sql, type Kysely } from "kysely";
import type { Database } from "@/types/db_types";
import { asUser, getRlsTestDb, getTestDb } from "../helpers/testDatabase";
import { TestDataFactory, type TestCompetition } from "../helpers/testFactories";
import { getTestTracker } from "../helpers/testIdTracker";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * Behavioural tests for the six RLS policies added by
 * migrations/1788220800000_add-choice-props.ts (design spec §2.3), and for the
 * fail-closed private-competition visibility that
 * migrations/1788307200000_fail-closed-private-competition-rls.ts gives them
 * and their parent policies.
 *
 * Seeding goes through `db` — the container superuser, which owns every table
 * and so bypasses RLS entirely. Every assertion goes through `rls`, the
 * non-owner `app_user` role created in tests/globalSetup.ts, which is subject
 * to the policies. Without the second role these tests would all pass no matter
 * what the policies said, which is exactly the gap this file closes.
 */
describe("choice props row-level security", () => {
  let db: Kysely<Database>;
  let rls: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      rls = await getRlsTestDb();
      factory = new TestDataFactory(db);
    }
  });

  /** Private competitions must carry no competition-level dates. */
  async function createPrivateCompetition(): Promise<TestCompetition> {
    return factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
    });
  }

  /**
   * There is no membership factory, and the enforce_private_competition_members
   * trigger rejects members on public competitions, so this only works for
   * competitions from createPrivateCompetition().
   */
  async function addMember(
    competitionId: number,
    userId: number,
    role: "admin" | "forecaster",
  ): Promise<void> {
    const row = await db
      .insertInto("competition_members")
      .values({ competition_id: competitionId, user_id: userId, role })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("competition_members", row.id);
  }

  /**
   * How much of one choice prop a caller can see: the prop row, its `v_props`
   * row, its options, and the per-option children of one forecast and one
   * resolution on it. The two visibility tests below assert the same shape
   * from opposite sides — nothing for a private competition's outsiders,
   * everything for a public competition's.
   */
  function countsFor(
    userId: number | null,
    ids: { propId: number; forecastId: number; resolutionId: number },
  ) {
    return asUser(rls, userId, async (trx) => ({
      props: (
        await trx
          .selectFrom("props")
          .selectAll()
          .where("id", "=", ids.propId)
          .execute()
      ).length,
      vProps: (
        await trx
          .selectFrom("v_props")
          .selectAll()
          .where("prop_id", "=", ids.propId)
          .execute()
      ).length,
      propOptions: (
        await trx
          .selectFrom("prop_options")
          .selectAll()
          .where("prop_id", "=", ids.propId)
          .execute()
      ).length,
      forecastOptions: (
        await trx
          .selectFrom("forecast_options")
          .selectAll()
          .where("forecast_id", "=", ids.forecastId)
          .execute()
      ).length,
      resolutionOptions: (
        await trx
          .selectFrom("resolution_options")
          .selectAll()
          .where("resolution_id", "=", ids.resolutionId)
          .execute()
      ).length,
    }));
  }

  ifRunningContainerTestsIt(
    "acts as a non-owner role, so the policies are actually enforced",
    async () => {
      const identity = await sql<{
        role_name: string;
        bypasses_rls: boolean;
        owns_tables: number;
        inherits_owner: boolean;
      }>`
        SELECT current_user::text AS role_name,
               (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
               (SELECT count(*)::int FROM pg_class c
                  JOIN pg_roles r ON r.oid = c.relowner
                 WHERE r.rolname = current_user AND c.relkind = 'r') AS owns_tables,
               pg_has_role(current_user, 'test_user', 'USAGE') AS inherits_owner
      `.execute(rls);
      expect(identity.rows[0]).toEqual({
        role_name: "app_user",
        bypasses_rls: false,
        owns_tables: 0,
        inherits_owner: false,
      });

      const secured = await sql<{ relname: string; relrowsecurity: boolean }>`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('prop_options', 'forecast_options', 'resolution_options')
        ORDER BY relname
      `.execute(rls);
      expect(secured.rows).toEqual([
        { relname: "forecast_options", relrowsecurity: true },
        { relname: "prop_options", relrowsecurity: true },
        { relname: "resolution_options", relrowsecurity: true },
      ]);
    },
  );

  // ---- view_prop_options / manage_prop_options ---------------------------

  ifRunningContainerTestsIt(
    "shows a private competition's prop_options to its members and to system admins",
    async () => {
      const compAdmin = await factory.createUser();
      const member = await factory.createUser();
      const sysAdmin = await factory.createAdminUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, compAdmin.id, "admin");
      await addMember(competition.id, member.id, "forecaster");
      const { prop } = await factory.createChoiceProp("one_of", ["A", "B"], {
        competition_id: competition.id,
        category_id: null,
      });

      const optionsSeenBy = (userId: number | null) =>
        asUser(rls, userId, (trx) =>
          trx
            .selectFrom("prop_options")
            .select(["text", "position"])
            .where("prop_id", "=", prop.id)
            .orderBy("position")
            .execute(),
        );

      expect(await optionsSeenBy(member.id)).toEqual([
        { text: "A", position: 0 },
        { text: "B", position: 1 },
      ]);
      expect(await optionsSeenBy(compAdmin.id)).toHaveLength(2);
      expect(await optionsSeenBy(sysAdmin.id)).toHaveLength(2);
    },
  );

  ifRunningContainerTestsIt(
    "lets only a competition admin write prop_options",
    async () => {
      const compAdmin = await factory.createUser();
      const member = await factory.createUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, compAdmin.id, "admin");
      await addMember(competition.id, member.id, "forecaster");
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B"],
        { competition_id: competition.id, category_id: null },
      );

      // A forecaster can read the options but not add to them...
      await expect(
        asUser(rls, member.id, (trx) =>
          trx
            .insertInto("prop_options")
            .values({ prop_id: prop.id, text: "C", position: 2 })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);

      // ...nor rename one: the USING clause matches no rows, so the UPDATE is
      // a silent no-op rather than an error.
      const renamedByMember = await asUser(rls, member.id, (trx) =>
        trx
          .updateTable("prop_options")
          .set({ text: "hijacked" })
          .where("id", "=", options[0].id)
          .executeTakeFirst(),
      );
      expect(Number(renamedByMember.numUpdatedRows)).toBe(0);

      // The competition admin can do both. (prop_options rows are not tracked
      // for cleanup: they cascade from the tracked prop.)
      await asUser(rls, compAdmin.id, (trx) =>
        trx
          .insertInto("prop_options")
          .values({ prop_id: prop.id, text: "C", position: 2 })
          .execute(),
      );
      const renamedByAdmin = await asUser(rls, compAdmin.id, (trx) =>
        trx
          .updateTable("prop_options")
          .set({ text: "A (revised)" })
          .where("id", "=", options[0].id)
          .executeTakeFirst(),
      );
      expect(Number(renamedByAdmin.numUpdatedRows)).toBe(1);

      const stored = await db
        .selectFrom("prop_options")
        .select(["text", "position"])
        .where("prop_id", "=", prop.id)
        .orderBy("position")
        .execute();
      expect(stored).toEqual([
        { text: "A (revised)", position: 0 },
        { text: "B", position: 1 },
        { text: "C", position: 2 },
      ]);
    },
  );

  // ---- view_forecast_options / manage_forecast_options -------------------

  ifRunningContainerTestsIt(
    "refuses forecast_options writes onto another user's forecast",
    async () => {
      const owner = await factory.createUser();
      const other = await factory.createUser();
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "A",
        "B",
      ]);
      const forecast = await factory.createChoiceForecast(owner.id, prop.id, [
        { optionId: options[0].id, probability: 0.3 },
        { optionId: options[1].id, probability: 0.7 },
      ]);

      // The prop is public, so `other` may read the forecast's options...
      const visible = await asUser(rls, other.id, (trx) =>
        trx
          .selectFrom("forecast_options")
          .selectAll()
          .where("forecast_id", "=", forecast.id)
          .execute(),
      );
      expect(visible).toHaveLength(2);

      // ...but may not add a row to it.
      await expect(
        asUser(rls, other.id, (trx) =>
          trx
            .insertInto("forecast_options")
            .values({
              forecast_id: forecast.id,
              prop_id: prop.id,
              option_id: options[0].id,
              probability: 1,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);

      // Nor update or delete one: no row satisfies the USING clause.
      const updated = await asUser(rls, other.id, (trx) =>
        trx
          .updateTable("forecast_options")
          .set({ probability: 1 })
          .where("forecast_id", "=", forecast.id)
          .executeTakeFirst(),
      );
      expect(Number(updated.numUpdatedRows)).toBe(0);

      const deleted = await asUser(rls, other.id, (trx) =>
        trx
          .deleteFrom("forecast_options")
          .where("forecast_id", "=", forecast.id)
          .executeTakeFirst(),
      );
      expect(Number(deleted.numDeletedRows)).toBe(0);

      // The owner's probabilities are untouched.
      const stored = await db
        .selectFrom("forecast_options")
        .select(["option_id", "probability"])
        .where("forecast_id", "=", forecast.id)
        .orderBy("option_id")
        .execute();
      expect(stored).toEqual([
        { option_id: options[0].id, probability: 0.3 },
        { option_id: options[1].id, probability: 0.7 },
      ]);

      // Positive control: the same statements succeed on the actor's own
      // forecast, so the failures above are the policy and not a missing GRANT.
      const ownForecastId = await asUser(rls, other.id, async (trx) => {
        const header = await trx
          .insertInto("forecasts")
          .values({ user_id: other.id, prop_id: prop.id, forecast: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("forecast_options")
          .values([
            {
              forecast_id: header.id,
              prop_id: prop.id,
              option_id: options[0].id,
              probability: 0.5,
            },
            {
              forecast_id: header.id,
              prop_id: prop.id,
              option_id: options[1].id,
              probability: 0.5,
            },
          ])
          .execute();
        return header.id;
      });
      // Written as app_user, so the global cleanup needs to know about it.
      // forecast_options cascades from the header.
      getTestTracker().trackId("forecasts", ownForecastId);
      const ownRows = await db
        .selectFrom("forecast_options")
        .selectAll()
        .where("forecast_id", "=", ownForecastId)
        .execute();
      expect(ownRows).toHaveLength(2);
    },
  );

  ifRunningContainerTestsIt(
    "lets private-competition members read each other's forecast_options without writing them",
    async () => {
      const compAdmin = await factory.createUser();
      const forecaster = await factory.createUser();
      const otherMember = await factory.createUser();
      const sysAdmin = await factory.createAdminUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, compAdmin.id, "admin");
      await addMember(competition.id, forecaster.id, "forecaster");
      await addMember(competition.id, otherMember.id, "forecaster");
      const { prop, options } = await factory.createChoiceProp(
        "any_of",
        ["A", "B"],
        { competition_id: competition.id, category_id: null },
      );
      const forecast = await factory.createChoiceForecast(
        forecaster.id,
        prop.id,
        [
          { optionId: options[0].id, probability: 0.25 },
          { optionId: options[1].id, probability: 0.75 },
        ],
      );

      const seenBy = (userId: number | null) =>
        asUser(rls, userId, (trx) =>
          trx
            .selectFrom("forecast_options")
            .select(["option_id", "probability"])
            .where("forecast_id", "=", forecast.id)
            .orderBy("option_id")
            .execute(),
        );

      expect(await seenBy(otherMember.id)).toEqual([
        { option_id: options[0].id, probability: 0.25 },
        { option_id: options[1].id, probability: 0.75 },
      ]);
      expect(await seenBy(compAdmin.id)).toHaveLength(2);
      expect(await seenBy(forecaster.id)).toHaveLength(2);
      expect(await seenBy(sysAdmin.id)).toHaveLength(2);

      // Reading another member's forecast is not permission to edit it — not
      // even for the competition admin, whose reach stops at the prop.
      for (const actor of [otherMember, compAdmin]) {
        const updated = await asUser(rls, actor.id, (trx) =>
          trx
            .updateTable("forecast_options")
            .set({ probability: 0 })
            .where("forecast_id", "=", forecast.id)
            .executeTakeFirst(),
        );
        expect(Number(updated.numUpdatedRows)).toBe(0);
      }
      const stored = await db
        .selectFrom("forecast_options")
        .select("probability")
        .where("forecast_id", "=", forecast.id)
        .orderBy("option_id")
        .execute();
      expect(stored.map((row) => row.probability)).toEqual([0.25, 0.75]);
    },
  );

  // ---- view_resolution_options / manage_resolution_options ---------------

  ifRunningContainerTestsIt(
    "lets only a competition admin resolve a private competition's choice prop",
    async () => {
      const compAdmin = await factory.createUser();
      const member = await factory.createUser();
      const sysAdmin = await factory.createAdminUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, compAdmin.id, "admin");
      await addMember(competition.id, member.id, "forecaster");
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B", "C"],
        { competition_id: competition.id, category_id: null },
      );

      // A forecaster cannot even open the resolution header (manage_resolutions).
      await expect(
        asUser(rls, member.id, (trx) =>
          trx
            .insertInto("resolutions")
            .values({
              prop_id: prop.id,
              resolution: null,
              notes: null,
              user_id: null,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      // ...nor by stamping it with their own id, which is what resolveProp
      // writes: "it's mine because I wrote it" must not be a way in.
      await expect(
        asUser(rls, member.id, (trx) =>
          trx
            .insertInto("resolutions")
            .values({
              prop_id: prop.id,
              resolution: null,
              notes: null,
              user_id: member.id,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      const afterFailedAttempt = await db
        .selectFrom("resolutions")
        .selectAll()
        .where("prop_id", "=", prop.id)
        .execute();
      expect(afterFailedAttempt).toHaveLength(0);

      // The competition admin can write the header and its per-option rows.
      const resolutionId = await asUser(rls, compAdmin.id, async (trx) => {
        const header = await trx
          .insertInto("resolutions")
          .values({
            prop_id: prop.id,
            resolution: null,
            notes: null,
            user_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("resolution_options")
          .values([
            {
              resolution_id: header.id,
              prop_id: prop.id,
              option_id: options[0].id,
              outcome: true,
            },
            {
              resolution_id: header.id,
              prop_id: prop.id,
              option_id: options[1].id,
              outcome: false,
            },
          ])
          .execute();
        return header.id;
      });
      // Written as app_user, so the global cleanup needs to know about it.
      // resolution_options cascades from the header.
      getTestTracker().trackId("resolutions", resolutionId);

      const readBack = await asUser(rls, compAdmin.id, (trx) =>
        trx
          .selectFrom("resolution_options")
          .select(["option_id", "outcome"])
          .where("resolution_id", "=", resolutionId)
          .orderBy("option_id")
          .execute(),
      );
      expect(readBack).toEqual([
        { option_id: options[0].id, outcome: true },
        { option_id: options[1].id, outcome: false },
      ]);

      // Members and system admins read the outcome...
      for (const reader of [member, sysAdmin]) {
        expect(
          await asUser(rls, reader.id, (trx) =>
            trx
              .selectFrom("resolution_options")
              .selectAll()
              .where("resolution_id", "=", resolutionId)
              .execute(),
          ),
        ).toHaveLength(2);
      }

      // ...but cannot append an outcome to the admin's resolution...
      await expect(
        asUser(rls, member.id, (trx) =>
          trx
            .insertInto("resolution_options")
            .values({
              resolution_id: resolutionId,
              prop_id: prop.id,
              option_id: options[2].id,
              outcome: true,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);

      // ...nor flip an existing one.
      const flipped = await asUser(rls, member.id, (trx) =>
        trx
          .updateTable("resolution_options")
          .set({ outcome: false })
          .where("resolution_id", "=", resolutionId)
          .executeTakeFirst(),
      );
      expect(Number(flipped.numUpdatedRows)).toBe(0);

      const stored = await db
        .selectFrom("resolution_options")
        .select(["option_id", "outcome"])
        .where("resolution_id", "=", resolutionId)
        .orderBy("option_id")
        .execute();
      expect(stored).toEqual([
        { option_id: options[0].id, outcome: true },
        { option_id: options[1].id, outcome: false },
      ]);
    },
  );

  // ---- fail-closed private-competition visibility ------------------------

  /**
   * Regression guard for
   * migrations/1788307200000_fail-closed-private-competition-rls.ts.
   *
   * These policies used to ask "is this competition private?" with
   * `NOT EXISTS (SELECT 1 FROM competitions c WHERE … AND c.is_private = TRUE)`.
   * A policy's sub-selects are themselves RLS-filtered as the querying role, and
   * `view_competitions` hides private competitions from non-members — so the
   * sub-select found nothing, `NOT EXISTS` was TRUE, and every private
   * competition's prop (and therefore its options, forecasts and resolutions)
   * fell through the "public prop" branch. The positive
   * `EXISTS (… c.is_private = FALSE)` form fails closed instead: a row naming a
   * competition the caller cannot see no longer passes.
   */
  ifRunningContainerTestsIt(
    "hides a private competition's rows from non-members and anonymous callers",
    async () => {
      const compAdmin = await factory.createUser();
      const forecaster = await factory.createUser();
      const stranger = await factory.createUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, compAdmin.id, "admin");
      await addMember(competition.id, forecaster.id, "forecaster");
      // Three options, only two of them forecast and resolved, so the denied
      // writes below land on a free (resolution_id, option_id) slot and fail on
      // the policy rather than on the primary key.
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B", "C"],
        { competition_id: competition.id, category_id: null },
      );
      const forecast = await factory.createChoiceForecast(
        forecaster.id,
        prop.id,
        [
          { optionId: options[0].id, probability: 0.4 },
          { optionId: options[1].id, probability: 0.6 },
        ],
      );
      const resolution = await factory.createChoiceResolution(prop.id, [
        { optionId: options[0].id, outcome: true },
        { optionId: options[1].id, outcome: false },
      ]);

      // The mechanism: the competition row is hidden from a non-member, and the
      // prop is now hidden with it instead of falling through the public branch.
      const mechanism = await asUser(rls, stranger.id, async (trx) => {
        const row = await sql<{
          competitions_visible: number;
          props_visible: number;
        }>`
          SELECT (SELECT count(*)::int FROM competitions c WHERE c.id = ${competition.id}) AS competitions_visible,
                 (SELECT count(*)::int FROM props p WHERE p.id = ${prop.id}) AS props_visible
        `.execute(trx);
        return row.rows[0];
      });
      expect(mechanism).toEqual({ competitions_visible: 0, props_visible: 0 });

      const ids = {
        propId: prop.id,
        forecastId: forecast.id,
        resolutionId: resolution.id,
      };

      const nothing = {
        props: 0,
        vProps: 0,
        propOptions: 0,
        forecastOptions: 0,
        resolutionOptions: 0,
      };
      expect(await countsFor(stranger.id, ids)).toEqual(nothing);
      expect(await countsFor(null, ids)).toEqual(nothing);

      // Members are unaffected — they reach these rows through
      // is_competition_member(), which is SECURITY DEFINER and never filtered.
      expect(await countsFor(forecaster.id, ids)).toEqual({
        props: 1,
        vProps: 1,
        propOptions: 3,
        forecastOptions: 2,
        resolutionOptions: 2,
      });

      // The write side is closed too, for the children...
      await expect(
        asUser(rls, stranger.id, (trx) =>
          trx
            .insertInto("prop_options")
            .values({ prop_id: prop.id, text: "D", position: 3 })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      await expect(
        asUser(rls, stranger.id, (trx) =>
          trx
            .insertInto("forecast_options")
            .values({
              forecast_id: forecast.id,
              prop_id: prop.id,
              option_id: options[2].id,
              probability: 1,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      await expect(
        asUser(rls, stranger.id, (trx) =>
          trx
            .insertInto("resolution_options")
            .values({
              resolution_id: resolution.id,
              prop_id: prop.id,
              option_id: options[2].id,
              outcome: false,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);

      // ...including UPDATE and DELETE, which match no rows rather than erroring.
      const updatedOutcomes = await asUser(rls, stranger.id, (trx) =>
        trx
          .updateTable("resolution_options")
          .set({ outcome: false })
          .where("resolution_id", "=", resolution.id)
          .executeTakeFirst(),
      );
      expect(Number(updatedOutcomes.numUpdatedRows)).toBe(0);
      const deletedOutcomes = await asUser(rls, stranger.id, (trx) =>
        trx
          .deleteFrom("resolution_options")
          .where("resolution_id", "=", resolution.id)
          .executeTakeFirst(),
      );
      expect(Number(deletedOutcomes.numDeletedRows)).toBe(0);
      const storedOutcomes = await db
        .selectFrom("resolution_options")
        .select(["option_id", "outcome"])
        .where("resolution_id", "=", resolution.id)
        .orderBy("option_id")
        .execute();
      expect(storedOutcomes).toEqual([
        { option_id: options[0].id, outcome: true },
        { option_id: options[1].id, outcome: false },
      ]);

      // ...and for the parents: a non-member can neither add a prop to the
      // competition (create_props) nor forecast on its props (create_forecasts,
      // which the fail-open form used to allow outright).
      await expect(
        asUser(rls, stranger.id, (trx) =>
          trx
            .insertInto("props")
            .values({
              text: "smuggled prop",
              competition_id: competition.id,
              user_id: null,
              category_id: null,
              notes: null,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      await expect(
        asUser(rls, stranger.id, (trx) =>
          trx
            .insertInto("forecasts")
            .values({
              user_id: stranger.id,
              prop_id: prop.id,
              forecast: null,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);
      expect(
        await db
          .selectFrom("props")
          .selectAll()
          .where("competition_id", "=", competition.id)
          .execute(),
      ).toHaveLength(1);

      // A member still can: create_forecasts admits them through the
      // membership branch.
      const memberForecastId = await asUser(rls, compAdmin.id, async (trx) => {
        const header = await trx
          .insertInto("forecasts")
          .values({ user_id: compAdmin.id, prop_id: prop.id, forecast: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        return header.id;
      });
      getTestTracker().trackId("forecasts", memberForecastId);
      expect(
        await db
          .selectFrom("forecasts")
          .selectAll()
          .where("id", "=", memberForecastId)
          .execute(),
      ).toHaveLength(1);
    },
  );

  /**
   * The other side of the same rewrite. Fail-closed is only correct if the
   * positive `EXISTS (… c.is_private = FALSE)` branch still admits genuinely
   * public props: `view_competitions` shows a public competition to everyone,
   * anonymous callers included, so the sub-select finds its row and the prop,
   * its options and its children stay readable. Without this test the eight
   * policies could be closed to *everyone* and the suite above would still
   * pass.
   */
  ifRunningContainerTestsIt(
    "still shows a public competition's rows to strangers and anonymous callers",
    async () => {
      const forecaster = await factory.createUser();
      const stranger = await factory.createUser();
      // Public competitions carry their own dates (the
      // public_competitions_require_dates constraint); the factory defaults
      // already satisfy it. They have no members — the
      // enforce_private_competition_members trigger rejects those.
      const competition = await factory.createCompetition();
      expect(competition.is_private).toBe(false);
      // category_id defaults to 1: public competition props carry a category
      // at the app level, though only competition_id matters to the policies.
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B", "C"],
        { competition_id: competition.id },
      );
      const forecast = await factory.createChoiceForecast(
        forecaster.id,
        prop.id,
        [
          { optionId: options[0].id, probability: 0.4 },
          { optionId: options[1].id, probability: 0.6 },
        ],
      );
      const resolution = await factory.createChoiceResolution(prop.id, [
        { optionId: options[0].id, outcome: true },
        { optionId: options[1].id, outcome: false },
      ]);
      const ids = {
        propId: prop.id,
        forecastId: forecast.id,
        resolutionId: resolution.id,
      };

      // The mechanism, mirrored: the competition row is visible to a
      // non-member, so the public branch of each policy matches.
      const mechanism = await asUser(rls, stranger.id, async (trx) => {
        const row = await sql<{
          competitions_visible: number;
          props_visible: number;
        }>`
          SELECT (SELECT count(*)::int FROM competitions c WHERE c.id = ${competition.id}) AS competitions_visible,
                 (SELECT count(*)::int FROM props p WHERE p.id = ${prop.id}) AS props_visible
        `.execute(trx);
        return row.rows[0];
      });
      expect(mechanism).toEqual({ competitions_visible: 1, props_visible: 1 });

      const everything = {
        props: 1,
        vProps: 1,
        propOptions: 3,
        forecastOptions: 2,
        resolutionOptions: 2,
      };
      expect(await countsFor(stranger.id, ids)).toEqual(everything);
      expect(await countsFor(null, ids)).toEqual(everything);

      // And the write side stays open where it should: create_forecasts' public
      // branch still admits a stranger's own forecast header on a public
      // competition's prop. (Choice props carry a null header forecast; the
      // per-option rows hang off it.)
      const strangerForecastId = await asUser(rls, stranger.id, async (trx) => {
        const header = await trx
          .insertInto("forecasts")
          .values({ user_id: stranger.id, prop_id: prop.id, forecast: null })
          .returning("id")
          .executeTakeFirstOrThrow();
        return header.id;
      });
      // Written as app_user, so the global cleanup needs to know about it.
      getTestTracker().trackId("forecasts", strangerForecastId);
      expect(
        await db
          .selectFrom("forecasts")
          .selectAll()
          .where("id", "=", strangerForecastId)
          .execute(),
      ).toHaveLength(1);
    },
  );
  // ---- manage_resolutions: a row stamped with the writer's own id ---------

  ifRunningContainerTestsIt(
    "gives a forecaster no hold over a resolution stamped with their own id",
    async () => {
      // The shape the old manage_resolutions admitted: a forecaster's own id
      // on the header of a prop they do not own. Seeded as the owner, as if
      // written before the fix, to prove such a row confers nothing now.
      const member = await factory.createUser();
      const competition = await createPrivateCompetition();
      await addMember(competition.id, member.id, "forecaster");
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B"],
        { competition_id: competition.id, category_id: null },
      );
      const header = await db
        .insertInto("resolutions")
        .values({
          prop_id: prop.id,
          resolution: null,
          notes: "original",
          user_id: member.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      getTestTracker().trackId("resolutions", header.id);

      const updated = await asUser(rls, member.id, (trx) =>
        trx
          .updateTable("resolutions")
          .set({ notes: "tampered" })
          .where("id", "=", header.id)
          .executeTakeFirst(),
      );
      expect(updated.numUpdatedRows).toBe(BigInt(0));

      const deleted = await asUser(rls, member.id, (trx) =>
        trx
          .deleteFrom("resolutions")
          .where("id", "=", header.id)
          .executeTakeFirst(),
      );
      expect(deleted.numDeletedRows).toBe(BigInt(0));

      await expect(
        asUser(rls, member.id, (trx) =>
          trx
            .insertInto("resolution_options")
            .values({
              resolution_id: header.id,
              prop_id: prop.id,
              option_id: options[0].id,
              outcome: true,
            })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security policy/);

      const after = await db
        .selectFrom("resolutions")
        .select("notes")
        .where("id", "=", header.id)
        .executeTakeFirstOrThrow();
      expect(after.notes).toBe("original");
    },
  );
});
