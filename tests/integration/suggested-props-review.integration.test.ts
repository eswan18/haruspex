import { describe, expect, beforeEach } from "vitest";
import { sql, type Kysely } from "kysely";
import type { Database } from "@/types/db_types";
import { asUser, getRlsTestDb, getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * The review status added by
 * migrations/1788566400000_add-review-status-to-suggested-props.ts.
 *
 * A suggestion is pending until an admin decides on it, and pending is the
 * absence of a decision rather than a third value: status, decided_at and
 * decided_by are all null together. Two CHECK constraints hold that line --
 * one on the permitted statuses, one tying status to decided_at.
 */
describe("suggested props review status", () => {
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

  async function suggest(userId: number, prop = "A claim."): Promise<number> {
    const row = await db
      .insertInto("suggested_props")
      .values({ suggester_user_id: userId, prop, notes: null })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function decide(
    id: number,
    status: string | null,
    deciderId: number | null,
  ): Promise<void> {
    await db
      .updateTable("suggested_props")
      .set({
        status: status as never,
        decided_by: deciderId,
        decided_at: status === null ? null : new Date(),
      })
      .where("id", "=", id)
      .execute();
  }

  describe("a new suggestion", () => {
    ifRunningContainerTestsIt("starts undecided", async () => {
      const user = await factory.createUser();
      const id = await suggest(user.id);

      const row = await db
        .selectFrom("suggested_props")
        .select(["status", "decided_by", "decided_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.status).toBeNull();
      expect(row.decided_by).toBeNull();
      expect(row.decided_at).toBeNull();
    });
  });

  describe("the permitted statuses", () => {
    ifRunningContainerTestsIt("accepts 'accepted'", async () => {
      const user = await factory.createUser();
      const admin = await factory.createAdminUser();
      const id = await suggest(user.id);

      await decide(id, "accepted", admin.id);

      const row = await db
        .selectFrom("suggested_props")
        .select("status")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("accepted");
    });

    ifRunningContainerTestsIt("accepts 'rejected'", async () => {
      const user = await factory.createUser();
      const admin = await factory.createAdminUser();
      const id = await suggest(user.id);

      await decide(id, "rejected", admin.id);

      const row = await db
        .selectFrom("suggested_props")
        .select("status")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("rejected");
    });

    ifRunningContainerTestsIt("refuses anything else", async () => {
      const user = await factory.createUser();
      const admin = await factory.createAdminUser();
      const id = await suggest(user.id);

      await expect(decide(id, "maybe", admin.id)).rejects.toThrow();
    });
  });

  describe("the status/decided_at invariant", () => {
    ifRunningContainerTestsIt(
      "refuses a decision with no timestamp",
      async () => {
        const user = await factory.createUser();
        const id = await suggest(user.id);

        await expect(
          db
            .updateTable("suggested_props")
            .set({ status: "accepted" as never, decided_at: null })
            .where("id", "=", id)
            .execute(),
        ).rejects.toThrow();
      },
    );

    ifRunningContainerTestsIt(
      "refuses a timestamp with no decision",
      async () => {
        const user = await factory.createUser();
        const id = await suggest(user.id);

        await expect(
          db
            .updateTable("suggested_props")
            .set({ status: null, decided_at: new Date() })
            .where("id", "=", id)
            .execute(),
        ).rejects.toThrow();
      },
    );

    ifRunningContainerTestsIt("allows a decision by nobody", async () => {
      // #201's rule: the actor comes from the session, which can be absent.
      const user = await factory.createUser();
      const id = await suggest(user.id);

      await decide(id, "accepted", null);

      const row = await db
        .selectFrom("suggested_props")
        .select(["status", "decided_by"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe("accepted");
      expect(row.decided_by).toBeNull();
    });

    ifRunningContainerTestsIt("clears cleanly back to pending", async () => {
      const user = await factory.createUser();
      const admin = await factory.createAdminUser();
      const id = await suggest(user.id);

      await decide(id, "rejected", admin.id);
      await decide(id, null, null);

      const row = await db
        .selectFrom("suggested_props")
        .select(["status", "decided_by", "decided_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBeNull();
      expect(row.decided_by).toBeNull();
      expect(row.decided_at).toBeNull();
    });
  });

  describe("the view", () => {
    ifRunningContainerTestsIt("names who decided", async () => {
      const user = await factory.createUser();
      const admin = await factory.createAdminUser({ name: "Reviewer Rae" });
      const id = await suggest(user.id);
      await decide(id, "accepted", admin.id);

      const row = await db
        .selectFrom("v_suggested_props")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.status).toBe("accepted");
      expect(row.decided_by_name).toBe("Reviewer Rae");
      expect(row.decided_at).toBeInstanceOf(Date);
    });

    ifRunningContainerTestsIt(
      "leaves a pending row's decider null",
      async () => {
        const user = await factory.createUser();
        const id = await suggest(user.id);

        const row = await db
          .selectFrom("v_suggested_props")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        expect(row.status).toBeNull();
        expect(row.decided_by_name).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "still keeps a pending row out of a non-admin's reach",
      async () => {
        // The left join for the decider must not cost the view its
        // security_invoker cascade -- see 1788480000000.
        const user = await factory.createUser();
        const stranger = await factory.createUser();
        await suggest(user.id);

        const rows = await asUser(rls, stranger.id, (trx) =>
          trx.selectFrom("v_suggested_props").selectAll().execute(),
        );

        expect(rows).toEqual([]);
      },
    );

    ifRunningContainerTestsIt("keeps security_invoker set", async () => {
      const row = await sql<{ reloptions: string[] | null }>`
        SELECT reloptions FROM pg_class WHERE relname = 'v_suggested_props'
      `
        .execute(db)
        .then((r) => r.rows[0]);

      expect(row.reloptions ?? []).toEqual(
        expect.arrayContaining([
          "security_invoker=true",
          "security_barrier=true",
        ]),
      );
    });
  });
});
