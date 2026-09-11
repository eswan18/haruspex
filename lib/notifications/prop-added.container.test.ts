import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import {
  asUser,
  getRlsTestDb,
  getTestDb,
} from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import { getTestTracker } from "../../tests/helpers/testIdTracker";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));
// The resolver takes its executor as an argument; only announcePropAdded
// reaches for withRLS, and mocking it keeps lib/database out of the import.
vi.mock("@/lib/db-helpers", () => ({ withRLS: vi.fn() }));

import { resolveNewPropAudience } from "./prop-added";

/**
 * The "members" audience against a real PostgreSQL, read the way the app
 * reads it: as the prop's author, through the non-owner role that RLS
 * applies to. Seeding goes through the superuser.
 */
describe("resolveNewPropAudience against the database", () => {
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

  async function createPrivateCompetition() {
    return factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
    });
  }

  async function addMember(
    competitionId: number,
    userId: number,
    role: "admin" | "forecaster",
  ) {
    const row = await db
      .insertInto("competition_members")
      .values({ competition_id: competitionId, user_id: userId, role })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("competition_members", row.id);
  }

  ifRunningContainerTestsIt(
    "is every active member of the competition except the author",
    async () => {
      const competition = await createPrivateCompetition();
      const elsewhere = await createPrivateCompetition();

      const author = await factory.createUser();
      const coAdmin = await factory.createUser();
      const forecaster = await factory.createUser();
      const deactivated = await factory.createUser();
      // createUser drops a deactivated_at override, so set it afterwards.
      await db
        .updateTable("users")
        .set({ deactivated_at: new Date() })
        .where("id", "=", deactivated.id)
        .execute();
      const outsider = await factory.createUser();

      await addMember(competition.id, author.id, "admin");
      await addMember(competition.id, coAdmin.id, "admin");
      await addMember(competition.id, forecaster.id, "forecaster");
      await addMember(competition.id, deactivated.id, "forecaster");
      await addMember(elsewhere.id, outsider.id, "forecaster");

      const recipients = await asUser(rls, author.id, (trx) =>
        resolveNewPropAudience(trx, "members", {
          competitionId: competition.id,
          authorId: author.id,
        }),
      );

      expect(recipients).toEqual(
        [coAdmin, forecaster].map((u) => ({ email: u.email, name: u.name })),
      );
    },
  );

  ifRunningContainerTestsIt(
    "is empty when the author is the only member",
    async () => {
      const competition = await createPrivateCompetition();
      const author = await factory.createUser();
      await addMember(competition.id, author.id, "admin");

      const recipients = await asUser(rls, author.id, (trx) =>
        resolveNewPropAudience(trx, "members", {
          competitionId: competition.id,
          authorId: author.id,
        }),
      );

      expect(recipients).toEqual([]);
    },
  );
});
