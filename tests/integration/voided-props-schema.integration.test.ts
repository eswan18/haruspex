import { describe, expect, beforeEach } from "vitest";
import { Kysely, sql } from "kysely";
import { Database } from "@/types/db_types";
import { getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * A void is a resolution with no outcome. Three rules keep it that way, each
 * enforced by the database: no answer value (a CHECK), the kind rule only for
 * resolutions that are not voided (the kind trigger), and no option outcomes
 * (a constraint trigger deferred to commit, so resolveProp may void a
 * resolved choice prop before it deletes the old outcomes).
 */
describe("voided resolutions schema", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  ifRunningContainerTestsIt(
    "rejects a voided resolution that carries a value",
    async () => {
      const prop = await factory.createProp();
      await expect(
        db
          .insertInto("resolutions")
          .values({ prop_id: prop.id, resolution: true, voided: true })
          .execute(),
      ).rejects.toThrow(/resolutions_voided_has_no_value/);
    },
  );

  ifRunningContainerTestsIt(
    "accepts a voided binary resolution with no value",
    async () => {
      const prop = await factory.createProp();
      const row = await factory.createResolution(prop.id, {
        resolution: null,
        voided: true,
      });
      expect(row.voided).toBe(true);
      expect(row.resolution).toBeNull();

      // The kind rule still holds for a resolution that is not a void.
      const other = await factory.createProp();
      await expect(
        db
          .insertInto("resolutions")
          .values({ prop_id: other.id, resolution: null })
          .execute(),
      ).rejects.toThrow(/binary props/);
    },
  );

  ifRunningContainerTestsIt(
    "rejects outcome rows under a voided header at commit",
    async () => {
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "A",
        "B",
      ]);
      await expect(
        db.transaction().execute(async (trx) => {
          const header = await trx
            .insertInto("resolutions")
            .values({ prop_id: prop.id, resolution: null, voided: true })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("resolution_options")
            .values({
              resolution_id: header.id,
              prop_id: prop.id,
              option_id: options[0].id,
              outcome: true,
            })
            .execute();
        }),
      ).rejects.toThrow(/voided resolution/);
      const left = await db
        .selectFrom("resolutions")
        .select("id")
        .where("prop_id", "=", prop.id)
        .execute();
      expect(left).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects voiding a resolution whose outcomes are left in place",
    async () => {
      const { prop, options } = await factory.createChoiceProp("any_of", [
        "A",
        "B",
      ]);
      const header = await factory.createChoiceResolution(
        prop.id,
        options.map((o) => ({ optionId: o.id, outcome: true })),
      );
      await expect(
        db
          .updateTable("resolutions")
          .set({ voided: true })
          .where("id", "=", header.id)
          .execute(),
      ).rejects.toThrow(/voided resolution/);
    },
  );

  ifRunningContainerTestsIt(
    "accepts voiding a resolved choice prop when its outcomes go in the same transaction",
    async () => {
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "A",
        "B",
      ]);
      const header = await factory.createChoiceResolution(
        prop.id,
        options.map((o, i) => ({ optionId: o.id, outcome: i === 0 })),
      );
      // resolveProp's order: header first, then the old outcomes.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("resolutions")
          .set({ voided: true })
          .where("id", "=", header.id)
          .execute();
        await trx
          .deleteFrom("resolution_options")
          .where("resolution_id", "=", header.id)
          .execute();
      });
      const stored = await db
        .selectFrom("resolutions")
        .select(["voided", "resolution"])
        .where("id", "=", header.id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ voided: true, resolution: null });
      const outcomes = await db
        .selectFrom("resolution_options")
        .select("option_id")
        .where("resolution_id", "=", header.id)
        .execute();
      expect(outcomes).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "exposes resolution_voided through v_props and v_forecasts",
    async () => {
      const user = await factory.createUser();
      const unresolved = await factory.createProp();
      const answered = await factory.createProp();
      const voided = await factory.createProp();
      for (const p of [unresolved, answered, voided]) {
        await factory.createForecast(user.id, p.id, { forecast: 0.5 });
      }
      await factory.createResolution(answered.id, { resolution: false });
      await factory.createResolution(voided.id, {
        resolution: null,
        voided: true,
      });
      const ids = [unresolved.id, answered.id, voided.id];

      const props = await db
        .selectFrom("v_props")
        .select(["prop_id", "resolution_voided"])
        .where("prop_id", "in", ids)
        .execute();
      const forecasts = await db
        .selectFrom("v_forecasts")
        .select(["prop_id", "resolution_voided"])
        .where("prop_id", "in", ids)
        .execute();
      for (const rows of [props, forecasts]) {
        const byProp = new Map(
          rows.map((r) => [r.prop_id, r.resolution_voided]),
        );
        expect(byProp.get(unresolved.id)).toBeNull();
        expect(byProp.get(answered.id)).toBe(false);
        expect(byProp.get(voided.id)).toBe(true);
      }
    },
  );

  ifRunningContainerTestsIt(
    "scores a voided prop as null for every kind",
    async () => {
      const user = await factory.createUser();
      const binary = await factory.createProp();
      await factory.createForecast(user.id, binary.id, { forecast: 0.9 });
      await factory.createResolution(binary.id, {
        resolution: null,
        voided: true,
      });
      const propIds = [binary.id];
      for (const kind of ["one_of", "any_of"] as const) {
        const { prop, options } = await factory.createChoiceProp(kind, [
          "A",
          "B",
        ]);
        await factory.createChoiceForecast(
          user.id,
          prop.id,
          options.map((o) => ({ optionId: o.id, probability: 0.5 })),
        );
        await factory.createResolution(prop.id, {
          resolution: null,
          voided: true,
        });
        propIds.push(prop.id);
      }
      const rows = await db
        .selectFrom("v_forecasts")
        .select(["prop_id", "score"])
        .where("user_id", "=", user.id)
        .where("prop_id", "in", propIds)
        .execute();
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.score).toBeNull();
    },
  );

  ifRunningContainerTestsIt(
    "pins the definer function's search_path with pg_temp last",
    async () => {
      // A SECURITY DEFINER function must not let a session's temporary
      // tables shadow the ones it reads; postgres searches pg_temp first
      // unless it is named, last, in the function's own search_path.
      const row = await sql<{ config: string[] | null }>`
        SELECT proconfig AS config FROM pg_proc
        WHERE proname = 'check_voided_resolution_has_no_outcomes'`.execute(db);
      expect(row.rows[0].config).toEqual(["search_path=public, pg_temp"]);
    },
  );
});
