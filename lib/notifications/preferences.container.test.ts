import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import {
  asUser,
  getRlsTestDb,
  getTestDb,
} from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));

import {
  getEffectivePreferences,
  notificationEnabled,
  setPreference,
} from "./preferences";

const TYPE = "competition.prop_added";

/**
 * The preference table against a real PostgreSQL: what the where-clause does
 * for a reader who has never chosen, what it does for one who has, and that
 * RLS lets an author see another reader's choice while stopping anyone
 * writing someone else's.
 */
describe("notification preferences against the database", () => {
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

  // Not tracked for cleanup: these rows cascade with their user, and the
  // cleanup helper deletes by an `id` column this table has not got.
  async function choose(userId: number, enabled: boolean) {
    await db
      .insertInto("notification_preferences")
      .values({ user_id: userId, notification_type: TYPE, enabled })
      .execute();
  }

  /** The ids the where-clause keeps, out of everyone passed in. */
  async function wanting(
    userIds: number[],
    fallback?: boolean,
  ): Promise<number[]> {
    const rows = await db
      .selectFrom("users")
      .select("users.id")
      .where("users.id", "in", userIds)
      .where(
        fallback === undefined
          ? notificationEnabled(TYPE)
          : notificationEnabled(TYPE, fallback),
      )
      .orderBy("users.id")
      .execute();
    return rows.map((row) => row.id);
  }

  ifRunningContainerTestsIt(
    "keeps a reader who has never chosen, on a default of on",
    async () => {
      const user = await factory.createUser();

      expect(await wanting([user.id])).toEqual([user.id]);
    },
  );

  ifRunningContainerTestsIt(
    "drops a reader who has never chosen, on a default of off",
    async () => {
      const user = await factory.createUser();

      // No type defaults to off today; pinning it here proves the clause
      // reads the default rather than assuming everyone is in.
      expect(await wanting([user.id], false)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt("drops a reader who opted out", async () => {
    const out = await factory.createUser();
    const untouched = await factory.createUser();
    await choose(out.id, false);

    expect(await wanting([out.id, untouched.id])).toEqual([untouched.id]);
  });

  ifRunningContainerTestsIt(
    "keeps a reader who chose on, even against a default of off",
    async () => {
      const user = await factory.createUser();
      await choose(user.id, true);

      // The point of storing every choice: a later default change leaves
      // this reader where they put themselves.
      expect(await wanting([user.id], false)).toEqual([user.id]);
    },
  );

  ifRunningContainerTestsIt(
    "reports defaults for a reader with no rows, and choices for one with them",
    async () => {
      const user = await factory.createUser();

      expect(await getEffectivePreferences(db, user.id)).toEqual({
        "competition.member_added": true,
        "competition.prop_added": true,
      });

      await choose(user.id, false);

      expect(await getEffectivePreferences(db, user.id)).toEqual({
        "competition.member_added": true,
        "competition.prop_added": false,
      });
    },
  );

  ifRunningContainerTestsIt("records a choice, then changes it", async () => {
    const user = await factory.createUser();

    await asUser(rls, user.id, (trx) =>
      setPreference(trx, user.id, TYPE, false),
    );
    expect(await wanting([user.id])).toEqual([]);

    await asUser(rls, user.id, (trx) =>
      setPreference(trx, user.id, TYPE, true),
    );
    expect(await wanting([user.id])).toEqual([user.id]);
  });

  ifRunningContainerTestsIt(
    "lets one reader see another's choice, so an author's send respects it",
    async () => {
      const author = await factory.createUser();
      const optedOut = await factory.createUser();
      await choose(optedOut.id, false);

      const visible = await asUser(rls, author.id, (trx) =>
        trx
          .selectFrom("notification_preferences")
          .select("enabled")
          .where("user_id", "=", optedOut.id)
          .execute(),
      );

      expect(visible).toEqual([{ enabled: false }]);
    },
  );

  ifRunningContainerTestsIt(
    "refuses to let one reader write another's preference",
    async () => {
      const meddler = await factory.createUser();
      const victim = await factory.createUser();

      await expect(
        asUser(rls, meddler.id, (trx) =>
          setPreference(trx, victim.id, TYPE, false),
        ),
      ).rejects.toThrow(/row-level security/i);
    },
  );

  ifRunningContainerTestsIt(
    "refuses to let one reader delete another's preference",
    async () => {
      const meddler = await factory.createUser();
      const victim = await factory.createUser();
      await choose(victim.id, false);

      // Separate read and write policies, rather than forecasts' single
      // FOR ALL USING (1 = 1): there, DELETE takes the permissive USING.
      const result = await asUser(rls, meddler.id, (trx) =>
        trx
          .deleteFrom("notification_preferences")
          .where("user_id", "=", victim.id)
          .executeTakeFirst(),
      );

      expect(Number(result.numDeletedRows)).toBe(0);
      expect(await wanting([victim.id])).toEqual([]);
    },
  );
});
