import { describe, expect, beforeEach } from "vitest";
import { sql, type Kysely } from "kysely";
import type { Database } from "@/types/db_types";
import { asUser, getRlsTestDb, getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import { backfillGluedNotes } from "../../migrations/1788480000000_add-notes-to-suggested-props";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * Schema and access tests for the notes column added by
 * migrations/1788480000000_add-notes-to-suggested-props.ts.
 *
 * Notes used to ride inside the prop text as a "\n\nNotes: " suffix, glued on
 * by the suggestion form and split apart again by the admin page. They now have
 * a column, and the view carries the submission date the table has always
 * recorded but never exposed.
 *
 * Seeding goes through `db` — the container superuser, which owns every table
 * and bypasses RLS. Access assertions go through `rls`, the non-owner
 * `app_user` role that the policies actually apply to.
 */
describe("suggested props schema", () => {
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

  async function suggest(
    userId: number,
    prop: string,
    notes: string | null = null,
  ): Promise<number> {
    const row = await db
      .insertInto("suggested_props")
      .values({ suggester_user_id: userId, prop, notes })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  describe("the notes column", () => {
    ifRunningContainerTestsIt("keeps notes apart from the claim", async () => {
      const user = await factory.createUser();
      const id = await suggest(
        user.id,
        "Bitcoin closes the year above $150,000.",
        "Settled on the Coinbase close at 00:00 UTC.",
      );

      const row = await db
        .selectFrom("suggested_props")
        .select(["prop", "notes"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.prop).toBe("Bitcoin closes the year above $150,000.");
      expect(row.notes).toBe("Settled on the Coinbase close at 00:00 UTC.");
    });

    ifRunningContainerTestsIt(
      "accepts a suggestion with no notes",
      async () => {
        const user = await factory.createUser();
        const id = await suggest(user.id, "A claim with nothing to add.");

        const row = await db
          .selectFrom("suggested_props")
          .select("notes")
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        expect(row.notes).toBeNull();
      },
    );
  });

  describe("the backfill", () => {
    /**
     * Runs the migration's own statement against rows staged to look the way
     * pre-migration rows did: the notes glued onto the claim, the column null.
     * The statement is imported rather than retyped, so this exercises the real
     * SQL. What it cannot prove is that up() calls it in the right order --
     * that is visible in the three lines of up() itself.
     */
    ifRunningContainerTestsIt("splits notes out of a glued claim", async () => {
      const user = await factory.createUser();
      const id = await suggest(
        user.id,
        "Bitcoin closes the year above $150,000.\n\nNotes: Coinbase close, 00:00 UTC.",
      );

      await backfillGluedNotes(db);

      const row = await db
        .selectFrom("suggested_props")
        .select(["prop", "notes"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.prop).toBe("Bitcoin closes the year above $150,000.");
      expect(row.notes).toBe("Coinbase close, 00:00 UTC.");
    });

    ifRunningContainerTestsIt(
      "leaves a claim with no marker alone",
      async () => {
        const user = await factory.createUser();
        const id = await suggest(user.id, "A claim that never had notes.");

        await backfillGluedNotes(db);

        const row = await db
          .selectFrom("suggested_props")
          .select(["prop", "notes"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        expect(row.prop).toBe("A claim that never had notes.");
        expect(row.notes).toBeNull();
      },
    );

    ifRunningContainerTestsIt("keeps multi-line notes whole", async () => {
      const user = await factory.createUser();
      const id = await suggest(
        user.id,
        "A claim.\n\nNotes: First line.\n\nSecond line.",
      );

      await backfillGluedNotes(db);

      const row = await db
        .selectFrom("suggested_props")
        .select(["prop", "notes"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.prop).toBe("A claim.");
      expect(row.notes).toBe("First line.\n\nSecond line.");
    });

    ifRunningContainerTestsIt("runs clean a second time", async () => {
      const user = await factory.createUser();
      const id = await suggest(user.id, "A claim.\n\nNotes: Settled somehow.");

      await backfillGluedNotes(db);
      await backfillGluedNotes(db);

      const row = await db
        .selectFrom("suggested_props")
        .select(["prop", "notes"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.prop).toBe("A claim.");
      expect(row.notes).toBe("Settled somehow.");
    });
  });

  describe("the view", () => {
    ifRunningContainerTestsIt("carries the notes", async () => {
      const user = await factory.createUser();
      const id = await suggest(user.id, "A claim.", "How to settle it.");

      const row = await db
        .selectFrom("v_suggested_props")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(row.notes).toBe("How to settle it.");
      expect(row.prop_text).toBe("A claim.");
    });

    ifRunningContainerTestsIt(
      "carries the submission date the table has always recorded",
      async () => {
        const user = await factory.createUser();
        const before = new Date();
        const id = await suggest(user.id, "A claim.");

        const row = await db
          .selectFrom("v_suggested_props")
          .select("created_at")
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        expect(row.created_at).toBeInstanceOf(Date);
        expect(row.created_at.getTime()).toBeGreaterThanOrEqual(
          before.getTime() - 1000,
        );
      },
    );
  });

  describe("who can read a suggestion", () => {
    /**
     * The view lost `security_invoker` when the IdP migration recreated it, so
     * the admin-only policy on the table stopped cascading through it. These
     * assert what migration 1768466662120 already believed was true.
     */
    ifRunningContainerTestsIt(
      "hides suggestions from a non-admin",
      async () => {
        const author = await factory.createUser();
        const stranger = await factory.createUser();
        await suggest(author.id, "A claim only an admin should read.");

        const rows = await asUser(rls, stranger.id, (trx) =>
          trx.selectFrom("v_suggested_props").selectAll().execute(),
        );

        expect(rows).toEqual([]);
      },
    );

    ifRunningContainerTestsIt(
      "hides a suggestion even from the person who made it",
      async () => {
        const author = await factory.createUser();
        const id = await suggest(author.id, "My own claim.");

        const rows = await asUser(rls, author.id, (trx) =>
          trx
            .selectFrom("v_suggested_props")
            .selectAll()
            .where("id", "=", id)
            .execute(),
        );

        expect(rows).toEqual([]);
      },
    );

    ifRunningContainerTestsIt("shows suggestions to an admin", async () => {
      const author = await factory.createUser();
      const admin = await factory.createAdminUser();
      const id = await suggest(author.id, "A claim.", "With notes.");

      const rows = await asUser(rls, admin.id, (trx) =>
        trx
          .selectFrom("v_suggested_props")
          .selectAll()
          .where("id", "=", id)
          .execute(),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].notes).toBe("With notes.");
    });
  });

  describe("the view's security options", () => {
    ifRunningContainerTestsIt(
      "sets security_invoker so table policies cascade",
      async () => {
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
      },
    );
  });
});
