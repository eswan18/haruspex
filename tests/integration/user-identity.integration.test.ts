import { describe, expect, beforeEach } from "vitest";
import { getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import { getTestTracker } from "../helpers/testIdTracker";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * The database's own guarantees about who a user is.
 *
 * These matter because the OAuth callback adopts whatever row matches the
 * incoming subject rather than verifying how it got there — so "at most one row
 * per subject" is a security property, not a tidiness one, and it should hold
 * even if every application-layer check above it is removed.
 */
describe("user identity constraints", () => {
  let db: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  ifRunningContainerTestsIt(
    "refuses a second user claiming the same IdP subject",
    async () => {
      const sub = `11111111-1111-4111-8111-${Date.now().toString().slice(-12)}`;
      await factory.createUser({ idp_user_id: sub } as any);

      // The factory randomises name and email, so the subject is the only
      // value the two rows share -- naming the index rules out the throw
      // coming from some other constraint.
      await expect(
        factory.createUser({ idp_user_id: sub } as any),
      ).rejects.toThrow(/idx_users_idp_user_id/);
    },
  );

  ifRunningContainerTestsIt(
    "still allows many users with no IdP subject at all",
    async () => {
      // Inserted directly rather than through the factory: its
      // `overrides.idp_user_id || crypto.randomUUID()` turns a null into a
      // fresh UUID, so going through it would compare two distinct subjects
      // and prove nothing about NULL handling.
      //
      // NULLs are distinct to a unique index, which is what we want — users
      // predating the IdP migration have no subject and must not collide.
      const insert = async () => {
        const suffix = Math.random().toString(36).slice(2);
        const row = await db
          .insertInto("users")
          .values({
            name: `nosub_${suffix}`,
            email: `nosub_${suffix}@example.com`,
            is_admin: false,
            idp_user_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        getTestTracker().trackId("users", row.id);
        return row.id;
      };

      const a = await insert();
      const b = await insert();
      expect(a).not.toBe(b);
    },
  );
});
