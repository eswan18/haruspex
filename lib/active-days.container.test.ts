import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely, Transaction } from "kysely";

import type { Database } from "@/types/db_types";
import {
  asUser,
  getRlsTestDb,
  getTestDb,
} from "../tests/helpers/testDatabase";
import { TestDataFactory } from "../tests/helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));

// withRLS, routed to the non-owner test role so the table's policies apply
// exactly as they do for the app.
const withRLS = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db-helpers", () => ({ withRLS }));

import { recordActiveDay, resetRecordedDays } from "./active-days";

/**
 * The active-day recorder against a real PostgreSQL. Days are in 2099 so no
 * other test's rows can be mistaken for these.
 */
describe("recordActiveDay against the database", () => {
  let db: Kysely<Database>;
  let rls: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    resetRecordedDays();
    withRLS.mockReset();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      rls = await getRlsTestDb();
      factory = new TestDataFactory(db);
      withRLS.mockImplementation(
        (userId: number, fn: (trx: Transaction<Database>) => Promise<unknown>) =>
          asUser(rls, userId, fn),
      );
    }
  });

  const daysOf = (userId: number) =>
    db
      .selectFrom("user_active_days")
      .select((eb) => eb.cast<string>("day", "text").as("day"))
      .where("user_id", "=", userId)
      .orderBy("day")
      .execute()
      .then((rows) => rows.map((r) => r.day));

  ifRunningContainerTestsIt(
    "writes one row per UTC day, and skips the database once recorded",
    async () => {
      const user = await factory.createUser();

      await recordActiveDay(user.id, new Date("2099-03-04T00:30:00Z"));
      await recordActiveDay(user.id, new Date("2099-03-04T23:59:00Z"));
      await recordActiveDay(user.id, new Date("2099-03-05T00:00:00Z"));

      expect(await daysOf(user.id)).toEqual(["2099-03-04", "2099-03-05"]);
      // The second call that day never reached the database.
      expect(withRLS).toHaveBeenCalledTimes(2);
    },
  );

  ifRunningContainerTestsIt(
    "is harmless when another process already recorded the day",
    async () => {
      const user = await factory.createUser();
      const at = new Date("2099-03-06T12:00:00Z");

      await recordActiveDay(user.id, at);
      resetRecordedDays(); // as a second pod would be
      await recordActiveDay(user.id, at);

      expect(await daysOf(user.id)).toEqual(["2099-03-06"]);
    },
  );

  ifRunningContainerTestsIt(
    "lets a user write and read only their own days",
    async () => {
      const user = await factory.createUser();
      const other = await factory.createUser();
      await recordActiveDay(other.id, new Date("2099-03-07T12:00:00Z"));

      await expect(
        asUser(rls, user.id, (trx) =>
          trx
            .insertInto("user_active_days")
            .values({ user_id: other.id, day: "2099-03-08" })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security/);

      await recordActiveDay(user.id, new Date("2099-03-07T12:00:00Z"));
      const visible = await asUser(rls, user.id, (trx) =>
        trx.selectFrom("user_active_days").select("user_id").execute(),
      );
      expect(visible).toEqual([{ user_id: user.id }]);
    },
  );

  ifRunningContainerTestsIt("lets an admin read every row", async () => {
    const admin = await factory.createAdminUser();
    const user = await factory.createUser();
    await recordActiveDay(user.id, new Date("2099-03-09T12:00:00Z"));

    const visible = await asUser(rls, admin.id, (trx) =>
      trx
        .selectFrom("user_active_days")
        .select("user_id")
        .where("user_id", "=", user.id)
        .execute(),
    );
    expect(visible).toEqual([{ user_id: user.id }]);
  });

  ifRunningContainerTestsIt(
    "never rejects, and tries again after a failure",
    async () => {
      const user = await factory.createUser();
      const at = new Date("2099-03-10T12:00:00Z");
      withRLS.mockRejectedValueOnce(new Error("database down"));

      await expect(recordActiveDay(user.id, at)).resolves.toBeUndefined();
      await recordActiveDay(user.id, at);

      expect(await daysOf(user.id)).toEqual(["2099-03-10"]);
    },
  );
});
