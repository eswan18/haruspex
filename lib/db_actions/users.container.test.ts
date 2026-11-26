import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import { getTestDb } from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/pubsub/client", () => ({
  publishEvent: vi.fn().mockResolvedValue("msg-mock"),
}));

import { getUserFromCookies } from "@/lib/get-user";
import { revalidatePath } from "next/cache";

/**
 * The user directory actions, against a real PostgreSQL.
 *
 * The code under test reaches the database through `lib/database`, which in
 * container tests connects as the container's superuser (TEST_DATABASE_URL).
 * That role owns the tables and bypasses row-level security, so every
 * allow/deny result below comes from the application code's own checks, not
 * from RLS policies. (`users` has no RLS in any case.)
 *
 * The test database is shared with other files, so assertions about the full
 * directory look only at the rows this file created.
 */
describe("user actions against the database", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;
  let actions: typeof import("./users");

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
      actions = await import("./users");
    }
  });

  async function userRow(id: number) {
    return db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  describe("getUsers", () => {
    ifRunningContainerTestsIt(
      "returns every user, with email and idp_user_id, to a site admin",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const other = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.getUsers();

        expect(result.success).toBe(true);
        if (!result.success) return;
        const ours = result.data.filter((u) =>
          [admin.id, other.id].includes(u.id as number),
        );
        expect(ours).toHaveLength(2);
        expect(ours.find((u) => u.id === other.id)).toMatchObject({
          id: other.id,
          name: other.name,
          email: other.email,
          idp_user_id: other.idp_user_id,
          is_admin: false,
          deactivated_at: null,
        });
      },
    );

    ifRunningContainerTestsIt(
      "orders the result by the sort it is given",
      async () => {
        const tag = Math.random().toString(36).substring(2, 8);
        const admin = await factory.createUser({ is_admin: true });
        const b = await factory.createUser({ name: `sort_b_${tag}` });
        const c = await factory.createUser({ name: `sort_c_${tag}` });
        const a = await factory.createUser({ name: `sort_a_${tag}` });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const mine = [a.id, b.id, c.id];

        const ascending = await actions.getUsers({
          sort: { expr: "name", modifiers: "asc" },
        });
        const descending = await actions.getUsers({
          sort: { expr: "name", modifiers: "desc" },
        });

        expect(ascending.success && descending.success).toBe(true);
        if (!ascending.success || !descending.success) return;
        expect(
          ascending.data
            .filter((u) => mine.includes(u.id as number))
            .map((u) => u.id),
        ).toEqual([a.id, b.id, c.id]);
        expect(
          descending.data
            .filter((u) => mine.includes(u.id as number))
            .map((u) => u.id),
        ).toEqual([c.id, b.id, a.id]);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-in non-admin and returns no rows",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.getUsers();

        expect(result).toEqual({
          success: false,
          error: "Only admins can view users",
          code: "UNAUTHORIZED",
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller the same way",
      async () => {
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.getUsers();

        expect(result).toEqual({
          success: false,
          error: "Only admins can view users",
          code: "UNAUTHORIZED",
        });
      },
    );
  });

  describe("getUserById", () => {
    ifRunningContainerTestsIt("returns the user to a site admin", async () => {
      const admin = await factory.createUser({ is_admin: true });
      const target = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

      const result = await actions.getUserById(target.id);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toMatchObject({
        id: target.id,
        name: target.name,
        email: target.email,
        idp_user_id: target.idp_user_id,
        is_admin: false,
        deactivated_at: null,
      });
    });

    ifRunningContainerTestsIt(
      "succeeds with undefined data for an id that does not exist",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.getUserById(2147483000);

        expect(result).toEqual({ success: true, data: undefined });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-in non-admin, even when asking about themselves",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.getUserById(user.id);

        expect(result).toEqual({
          success: false,
          error: "Only admins can view user details",
          code: "UNAUTHORIZED",
        });
      },
    );

    ifRunningContainerTestsIt("refuses a signed-out caller", async () => {
      const target = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

      const result = await actions.getUserById(target.id);

      expect(result).toEqual({
        success: false,
        error: "Only admins can view user details",
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("setUserActive", () => {
    ifRunningContainerTestsIt(
      "lets an admin deactivate a user and then reactivate them",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const target = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const deactivated = await actions.setUserActive({
          userId: target.id,
          active: false,
        });

        expect(deactivated.success).toBe(true);
        if (!deactivated.success) return;
        expect(deactivated.data).toMatchObject({ id: target.id });
        expect(deactivated.data.deactivated_at).toBeInstanceOf(Date);
        expect((await userRow(target.id)).deactivated_at).toBeInstanceOf(Date);
        expect(revalidatePath).toHaveBeenCalledWith("/admin/users");

        const reactivated = await actions.setUserActive({
          userId: target.id,
          active: true,
        });

        expect(reactivated.success).toBe(true);
        if (!reactivated.success) return;
        expect(reactivated.data.deactivated_at).toBeNull();
        expect((await userRow(target.id)).deactivated_at).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "lets an admin deactivate themselves",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.setUserActive({
          userId: admin.id,
          active: false,
        });

        expect(result.success).toBe(true);
        expect((await userRow(admin.id)).deactivated_at).toBeInstanceOf(Date);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin and leaves the row unchanged",
      async () => {
        const user = await factory.createUser();
        const target = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.setUserActive({
          userId: target.id,
          active: false,
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can modify user status",
          code: "UNAUTHORIZED",
        });
        expect((await userRow(target.id)).deactivated_at).toBeNull();
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin who targets themselves, and leaves the row unchanged",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.setUserActive({
          userId: user.id,
          active: false,
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can modify user status",
          code: "UNAUTHORIZED",
        });
        expect((await userRow(user.id)).deactivated_at).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller and leaves the row unchanged",
      async () => {
        const target = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.setUserActive({
          userId: target.id,
          active: false,
        });

        expect(result).toEqual({
          success: false,
          error: "You must be logged in to modify user status",
          code: "UNAUTHORIZED",
        });
        expect((await userRow(target.id)).deactivated_at).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: an admin targeting a user id that does not exist gets success with undefined data",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.setUserActive({
          userId: 2147483000,
          active: false,
        });

        // The type promises a VUser; the update matched no row and the
        // follow-up read found nothing, but the action still reports success.
        expect(result).toEqual({ success: true, data: undefined });
      },
    );
  });

  describe("updateUser", () => {
    ifRunningContainerTestsIt(
      "lets a user change their own name and email",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);
        const newEmail = `renamed_${Math.random().toString(36).substring(7)}@example.com`;

        const result = await actions.updateUser({
          id: user.id,
          user: { name: "Renamed Person", email: newEmail },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await userRow(user.id)).toMatchObject({
          name: "Renamed Person",
          email: newEmail,
          is_admin: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "lets a user change only their name, leaving the email as it was",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({
          id: user.id,
          user: { name: "Only Name" },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await userRow(user.id)).toMatchObject({
          name: "Only Name",
          email: user.email,
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a user who targets another user and leaves that row unchanged",
      async () => {
        const user = await factory.createUser();
        const victim = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({
          id: victim.id,
          user: { name: "Hijacked" },
        });

        expect(result).toEqual({
          success: false,
          error: "You can only update your own profile",
          code: "UNAUTHORIZED",
        });
        expect(await userRow(victim.id)).toMatchObject({
          name: victim.name,
          email: victim.email,
        });
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a site admin cannot update another user's profile either",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const target = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateUser({
          id: target.id,
          user: { name: "Admin Edit" },
        });

        expect(result).toEqual({
          success: false,
          error: "You can only update your own profile",
          code: "UNAUTHORIZED",
        });
        expect((await userRow(target.id)).name).toBe(target.name);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller and leaves the row unchanged",
      async () => {
        const target = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.updateUser({
          id: target.id,
          user: { name: "Nobody" },
        });

        expect(result).toEqual({
          success: false,
          error: "You can only update your own profile",
          code: "UNAUTHORIZED",
        });
        expect((await userRow(target.id)).name).toBe(target.name);
      },
    );

    ifRunningContainerTestsIt(
      "refuses an attempt to make themselves an admin, naming the field, and writes nothing",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({
          id: user.id,
          user: { is_admin: true },
        });

        expect(result).toEqual({
          success: false,
          error: "You cannot update the following fields: is_admin",
          code: "VALIDATION_ERROR",
        });
        expect((await userRow(user.id)).is_admin).toBe(false);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a mixed update as a whole: allowed fields are not applied when another is forbidden",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({
          id: user.id,
          user: { name: "Half Applied", idp_user_id: "stolen", is_admin: true },
        });

        expect(result).toEqual({
          success: false,
          error:
            "You cannot update the following fields: idp_user_id, is_admin",
          code: "VALIDATION_ERROR",
        });
        expect(await userRow(user.id)).toMatchObject({
          name: user.name,
          idp_user_id: user.idp_user_id,
          is_admin: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses an email already held by another user, and writes nothing",
      async () => {
        const user = await factory.createUser();
        const other = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({
          id: user.id,
          user: { email: other.email },
        });

        expect(result).toEqual({
          success: false,
          error: "A user with this email already exists",
          code: "VALIDATION_ERROR",
        });
        expect((await userRow(user.id)).email).toBe(user.email);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: an empty update is not a no-op; it returns a database error",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateUser({ id: user.id, user: {} });

        expect(result).toEqual({
          success: false,
          error: "Failed to update user",
          code: "DATABASE_ERROR",
        });
        expect(await userRow(user.id)).toMatchObject({
          name: user.name,
          email: user.email,
        });
      },
    );
  });
});
