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

import { resolveAnnouncementAudience } from "./announcement";

/**
 * The announcement audience against a real PostgreSQL, read the way the app
 * reads it: as the sending admin, through the non-owner role that RLS applies
 * to. Other tests' users share the database, so these check who is in and who
 * is out rather than the whole list.
 */
describe("resolveAnnouncementAudience against the database", () => {
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

  ifRunningContainerTestsIt(
    "is every active user who has not opted out, the sender included",
    async () => {
      const admin = await factory.createAdminUser();
      const active = await factory.createUser();
      const optedIn = await factory.createUser();
      const optedOut = await factory.createUser();
      const deactivated = await factory.createUser();
      // createUser drops a deactivated_at override, so set it afterwards.
      await db
        .updateTable("users")
        .set({ deactivated_at: new Date() })
        .where("id", "=", deactivated.id)
        .execute();
      await db
        .insertInto("notification_preferences")
        .values([
          {
            user_id: optedOut.id,
            notification_type: "admin.announcement",
            enabled: false,
          },
          {
            user_id: optedIn.id,
            notification_type: "admin.announcement",
            enabled: true,
          },
          // Turning a different notification off must not count here.
          {
            user_id: active.id,
            notification_type: "competition.prop_added",
            enabled: false,
          },
        ])
        .execute();

      const recipients = await asUser(rls, admin.id, (trx) =>
        resolveAnnouncementAudience(trx),
      );
      const ids = recipients.map((r) => r.id);

      expect(ids).toEqual(expect.arrayContaining([admin.id, active.id, optedIn.id]));
      expect(ids).not.toContain(optedOut.id);
      expect(ids).not.toContain(deactivated.id);
      expect(recipients.find((r) => r.id === active.id)).toEqual({
        id: active.id,
        email: active.email,
        name: active.name,
      });
    },
  );
});
