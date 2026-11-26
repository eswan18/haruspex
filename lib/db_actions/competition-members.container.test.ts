import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import { getTestDb } from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import { getTestTracker } from "../../tests/helpers/testIdTracker";
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
import { publishEvent } from "@/lib/pubsub/client";

/**
 * Adding a member, against a real PostgreSQL: the membership always lands,
 * and the mail about it follows the new member's own preference.
 */
describe("addCompetitionMemberById against the database", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;
  let addCompetitionMemberById: typeof import("./competition-members").addCompetitionMemberById;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
      ({ addCompetitionMemberById } = await import("./competition-members"));
    }
  });

  async function privateCompetitionRunBy(adminId: number) {
    const competition = await factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
    });
    const row = await db
      .insertInto("competition_members")
      .values({
        competition_id: competition.id,
        user_id: adminId,
        role: "admin",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("competition_members", row.id);
    return competition;
  }

  async function addedMembership(competitionId: number, userId: number) {
    const row = await db
      .selectFrom("competition_members")
      .select("id")
      .where("competition_id", "=", competitionId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (row) getTestTracker().trackId("competition_members", row.id);
    return row;
  }

  ifRunningContainerTestsIt(
    "emails a new member who has never chosen",
    async () => {
      const admin = await factory.createUser();
      const newcomer = await factory.createUser();
      const competition = await privateCompetitionRunBy(admin.id);
      vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
      vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
      vi.stubEnv("JWT_SECRET", "test-secret");

      const result = await addCompetitionMemberById({
        competitionId: competition.id,
        userId: newcomer.id,
        role: "forecaster",
      });

      expect(result.success).toBe(true);
      expect(await addedMembership(competition.id, newcomer.id)).toBeDefined();
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "competition.member_added",
          notify: [
            {
              email: newcomer.email,
              name: newcomer.name,
              // Their own token: one reader, one notification.
              unsubscribe_url: expect.stringContaining(
                `t=${newcomer.id}%3Acompetition.member_added%3A`,
              ),
              unsubscribe_post_url: expect.stringContaining(
                "/api/unsubscribe?t=",
              ),
            },
          ],
          // The footer's way back to the setting that silences this.
          manage_link: "https://haruspex.test/account",
        }),
      );
    },
  );

  ifRunningContainerTestsIt(
    "still adds a member who turned this mail off, and sends nothing",
    async () => {
      const admin = await factory.createUser();
      const newcomer = await factory.createUser();
      const competition = await privateCompetitionRunBy(admin.id);
      await db
        .insertInto("notification_preferences")
        .values({
          user_id: newcomer.id,
          notification_type: "competition.member_added",
          enabled: false,
        })
        .execute();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

      const result = await addCompetitionMemberById({
        competitionId: competition.id,
        userId: newcomer.id,
        role: "forecaster",
      });

      // The membership is the point; the email is a courtesy they declined.
      expect(result.success).toBe(true);
      expect(await addedMembership(competition.id, newcomer.id)).toBeDefined();
      expect(publishEvent).not.toHaveBeenCalled();
    },
  );
});

/**
 * The reading and managing actions, against a real PostgreSQL.
 *
 * The code under test reaches the database through `lib/database`, which in
 * container tests connects as the container's superuser (TEST_DATABASE_URL).
 * That role owns the tables and bypasses row-level security, so every
 * allow/deny result below comes from the application code's own checks, not
 * from RLS policies.
 */
describe("competition member roster actions against the database", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;
  let actions: typeof import("./competition-members");

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
      actions = await import("./competition-members");
    }
  });

  async function privateCompetition() {
    return factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
    });
  }

  async function join(
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

  async function roleOf(competitionId: number, userId: number) {
    const row = await db
      .selectFrom("competition_members")
      .select("role")
      .where("competition_id", "=", competitionId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row?.role;
  }

  function signInAs(user: { id: number } | null) {
    vi.mocked(getUserFromCookies).mockResolvedValue(user as never);
  }

  describe("getCompetitionMembers", () => {
    ifRunningContainerTestsIt(
      "gives a competition admin the roster, admins first, with emails",
      async () => {
        const admin = await factory.createUser({ name: "Zed Admin" });
        const alice = await factory.createUser({ name: "Alice" });
        const bob = await factory.createUser({ name: "Bob" });
        const competition = await privateCompetition();
        await join(competition.id, bob.id, "forecaster");
        await join(competition.id, admin.id, "admin");
        await join(competition.id, alice.id, "forecaster");
        signInAs(admin);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.map((m) => [m.user_name, m.role])).toEqual([
          ["Zed Admin", "admin"],
          ["Alice", "forecaster"],
          ["Bob", "forecaster"],
        ]);
        expect(result.data.map((m) => m.user_email)).toEqual([
          admin.email,
          alice.email,
          bob.email,
        ]);
      },
    );

    ifRunningContainerTestsIt(
      "gives a forecaster the roster with every email withheld",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(forecaster);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.map((m) => m.user_id).sort()).toEqual(
          [admin.id, forecaster.id].sort(),
        );
        expect(result.data.every((m) => m.user_email === null)).toBe(true);
      },
    );

    ifRunningContainerTestsIt(
      "gives a site admin who is not a member the emails",
      async () => {
        const siteAdmin = await factory.createAdminUser();
        const member = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, member.id, "forecaster");
        signInAs(siteAdmin);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result).toMatchObject({ success: true });
        if (!result.success) return;
        expect(result.data.map((m) => m.user_email)).toEqual([member.email]);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a non-member still receives the roster, emails withheld (app code does not refuse; RLS is not in force on this connection)",
      async () => {
        const admin = await factory.createUser();
        const outsider = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(outsider);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.map((m) => m.user_id)).toEqual([admin.id]);
        expect(result.data[0].user_email).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "gives a signed-out caller the roster with emails withheld",
      async () => {
        const admin = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(null);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data).toHaveLength(1);
        expect(result.data[0].user_email).toBeNull();
      },
    );

    ifRunningContainerTestsIt(
      "returns an empty roster for a competition nobody has joined",
      async () => {
        const user = await factory.createUser();
        const competition = await privateCompetition();
        signInAs(user);

        const result = await actions.getCompetitionMembers(competition.id);

        expect(result).toEqual({ success: true, data: [] });
      },
    );
  });

  describe("getCurrentUserRole", () => {
    ifRunningContainerTestsIt("returns admin for an admin", async () => {
      const user = await factory.createUser();
      const competition = await privateCompetition();
      await join(competition.id, user.id, "admin");
      signInAs(user);

      expect(await actions.getCurrentUserRole(competition.id)).toEqual({
        success: true,
        data: "admin",
      });
    });

    ifRunningContainerTestsIt(
      "returns forecaster for a forecaster",
      async () => {
        const user = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, user.id, "forecaster");
        signInAs(user);

        expect(await actions.getCurrentUserRole(competition.id)).toEqual({
          success: true,
          data: "forecaster",
        });
      },
    );

    ifRunningContainerTestsIt("returns null for a non-member", async () => {
      const member = await factory.createUser();
      const outsider = await factory.createUser();
      const competition = await privateCompetition();
      await join(competition.id, member.id, "admin");
      signInAs(outsider);

      expect(await actions.getCurrentUserRole(competition.id)).toEqual({
        success: true,
        data: null,
      });
    });

    ifRunningContainerTestsIt("returns null when signed out", async () => {
      const competition = await privateCompetition();
      signInAs(null);

      expect(await actions.getCurrentUserRole(competition.id)).toEqual({
        success: true,
        data: null,
      });
    });
  });

  describe("removeCompetitionMember", () => {
    ifRunningContainerTestsIt(
      "lets an admin remove a forecaster, and the row is gone",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(admin);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: forecaster.id,
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await roleOf(competition.id, forecaster.id)).toBeUndefined();
        expect(await roleOf(competition.id, admin.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "refuses a forecaster, and the row is kept",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const other = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        await join(competition.id, other.id, "forecaster");
        signInAs(forecaster);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: other.id,
        });

        expect(result).toEqual({
          success: false,
          error: "Only competition admins can remove members",
          code: "UNAUTHORIZED",
        });
        expect(await roleOf(competition.id, other.id)).toBe("forecaster");
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-member, and the row is kept",
      async () => {
        const admin = await factory.createUser();
        const outsider = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(outsider);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: admin.id,
        });

        expect(result).toMatchObject({ success: false, code: "UNAUTHORIZED" });
        expect(await roleOf(competition.id, admin.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller, and the row is kept",
      async () => {
        const admin = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(null);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: admin.id,
        });

        expect(result).toEqual({
          success: false,
          error: "You must be logged in",
          code: "UNAUTHORIZED",
        });
        expect(await roleOf(competition.id, admin.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "refuses to remove the last admin when they remove themselves",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(admin);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: admin.id,
        });

        expect(result).toEqual({
          success: false,
          error: "Cannot remove the last admin from a competition",
          code: "VALIDATION_ERROR",
        });
        expect(await roleOf(competition.id, admin.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "lets an admin remove themselves when another admin remains",
      async () => {
        const first = await factory.createUser();
        const second = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, first.id, "admin");
        await join(competition.id, second.id, "admin");
        signInAs(first);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: first.id,
        });

        expect(result.success).toBe(true);
        expect(await roleOf(competition.id, first.id)).toBeUndefined();
        expect(await roleOf(competition.id, second.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: an admin can remove another admin, even the only other one, leaving themselves as sole admin",
      async () => {
        const first = await factory.createUser();
        const second = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, first.id, "admin");
        await join(competition.id, second.id, "admin");
        signInAs(first);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: second.id,
        });

        expect(result.success).toBe(true);
        expect(await roleOf(competition.id, second.id)).toBeUndefined();
        expect(await roleOf(competition.id, first.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "reports NOT_FOUND for someone who is not a member",
      async () => {
        const admin = await factory.createUser();
        const stranger = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(admin);

        const result = await actions.removeCompetitionMember({
          competitionId: competition.id,
          userId: stranger.id,
        });

        expect(result).toEqual({
          success: false,
          error: "Member not found in this competition",
          code: "NOT_FOUND",
        });
      },
    );
  });

  describe("updateMemberRole", () => {
    ifRunningContainerTestsIt(
      "lets an admin promote a forecaster, and the row changes",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(admin);

        const result = await actions.updateMemberRole({
          competitionId: competition.id,
          userId: forecaster.id,
          newRole: "admin",
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await roleOf(competition.id, forecaster.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "lets an admin demote another admin when two exist",
      async () => {
        const first = await factory.createUser();
        const second = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, first.id, "admin");
        await join(competition.id, second.id, "admin");
        signInAs(first);

        const result = await actions.updateMemberRole({
          competitionId: competition.id,
          userId: second.id,
          newRole: "forecaster",
        });

        expect(result.success).toBe(true);
        expect(await roleOf(competition.id, second.id)).toBe("forecaster");
        expect(await roleOf(competition.id, first.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "refuses a forecaster, and the role is unchanged",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(forecaster);

        const result = await actions.updateMemberRole({
          competitionId: competition.id,
          userId: forecaster.id,
          newRole: "admin",
        });

        expect(result).toEqual({
          success: false,
          error: "Only competition admins can update roles",
          code: "UNAUTHORIZED",
        });
        expect(await roleOf(competition.id, forecaster.id)).toBe("forecaster");
      },
    );

    ifRunningContainerTestsIt("refuses a signed-out caller", async () => {
      const admin = await factory.createUser();
      const competition = await privateCompetition();
      await join(competition.id, admin.id, "admin");
      signInAs(null);

      const result = await actions.updateMemberRole({
        competitionId: competition.id,
        userId: admin.id,
        newRole: "forecaster",
      });

      expect(result).toEqual({
        success: false,
        error: "You must be logged in",
        code: "UNAUTHORIZED",
      });
      expect(await roleOf(competition.id, admin.id)).toBe("admin");
    });

    ifRunningContainerTestsIt(
      "refuses to demote the last admin, and the role is kept",
      async () => {
        const admin = await factory.createUser();
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(admin);

        const result = await actions.updateMemberRole({
          competitionId: competition.id,
          userId: admin.id,
          newRole: "forecaster",
        });

        expect(result).toEqual({
          success: false,
          error: "Cannot demote the last admin",
          code: "VALIDATION_ERROR",
        });
        expect(await roleOf(competition.id, admin.id)).toBe("admin");
      },
    );

    ifRunningContainerTestsIt(
      "reports NOT_FOUND for someone who is not a member",
      async () => {
        const admin = await factory.createUser();
        const stranger = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(admin);

        const result = await actions.updateMemberRole({
          competitionId: competition.id,
          userId: stranger.id,
          newRole: "admin",
        });

        expect(result).toEqual({
          success: false,
          error: "Member not found in this competition",
          code: "NOT_FOUND",
        });
        expect(await roleOf(competition.id, stranger.id)).toBeUndefined();
      },
    );
  });

  describe("getMemberCount", () => {
    ifRunningContainerTestsIt("matches the membership rows", async () => {
      const users = await Promise.all([
        factory.createUser(),
        factory.createUser(),
        factory.createUser(),
      ]);
      const competition = await privateCompetition();
      const other = await privateCompetition();
      await join(competition.id, users[0].id, "admin");
      await join(competition.id, users[1].id, "forecaster");
      await join(competition.id, users[2].id, "forecaster");
      await join(other.id, users[0].id, "admin");
      signInAs(users[0]);

      const stored = await db
        .selectFrom("competition_members")
        .select("id")
        .where("competition_id", "=", competition.id)
        .execute();

      expect(stored).toHaveLength(3);
      expect(await actions.getMemberCount(competition.id)).toEqual({
        success: true,
        data: 3,
      });
      expect(await actions.getMemberCount(other.id)).toEqual({
        success: true,
        data: 1,
      });
    });

    ifRunningContainerTestsIt(
      "is zero for an empty competition, even when signed out",
      async () => {
        const competition = await privateCompetition();
        signInAs(null);

        expect(await actions.getMemberCount(competition.id)).toEqual({
          success: true,
          data: 0,
        });
      },
    );
  });

  describe("getEligibleMembers", () => {
    ifRunningContainerTestsIt(
      "excludes current members and deactivated users",
      async () => {
        const admin = await factory.createUser({ name: "A admin" });
        const member = await factory.createUser({ name: "B member" });
        const eligible = await factory.createUser({ name: "C eligible" });
        const gone = await factory.createUser({ name: "D deactivated" });
        await db
          .updateTable("users")
          .set({ deactivated_at: new Date() })
          .where("id", "=", gone.id)
          .execute();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, member.id, "forecaster");
        signInAs(admin);

        const result = await actions.getEligibleMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        const ids = result.data.map((u) => u.id);
        expect(ids).toContain(eligible.id);
        expect(ids).not.toContain(admin.id);
        expect(ids).not.toContain(member.id);
        expect(ids).not.toContain(gone.id);
        expect(result.data.find((u) => u.id === eligible.id)).toEqual({
          id: eligible.id,
          name: "C eligible",
          username: eligible.username,
        });
      },
    );

    ifRunningContainerTestsIt(
      "lets a site admin who is not a member list them",
      async () => {
        const siteAdmin = await factory.createAdminUser();
        const member = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, member.id, "forecaster");
        signInAs(siteAdmin);

        const result = await actions.getEligibleMembers(competition.id);

        expect(result.success).toBe(true);
        if (!result.success) return;
        const ids = result.data.map((u) => u.id);
        expect(ids).toContain(siteAdmin.id);
        expect(ids).not.toContain(member.id);
      },
    );

    ifRunningContainerTestsIt("refuses a forecaster", async () => {
      const forecaster = await factory.createUser();
      const competition = await privateCompetition();
      await join(competition.id, forecaster.id, "forecaster");
      signInAs(forecaster);

      expect(await actions.getEligibleMembers(competition.id)).toEqual({
        success: false,
        error: "Only competition admins can view eligible members",
        code: "UNAUTHORIZED",
      });
    });

    ifRunningContainerTestsIt("refuses a signed-out caller", async () => {
      const competition = await privateCompetition();
      signInAs(null);

      expect(await actions.getEligibleMembers(competition.id)).toEqual({
        success: false,
        error: "You must be logged in",
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("addCompetitionMemberById (refusals)", () => {
    ifRunningContainerTestsIt(
      "refuses a forecaster, and no row is written",
      async () => {
        const forecaster = await factory.createUser();
        const newcomer = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, forecaster.id, "forecaster");
        signInAs(forecaster);

        const result = await actions.addCompetitionMemberById({
          competitionId: competition.id,
          userId: newcomer.id,
          role: "forecaster",
        });

        expect(result).toEqual({
          success: false,
          error: "Only competition admins can add members",
          code: "UNAUTHORIZED",
        });
        expect(await roleOf(competition.id, newcomer.id)).toBeUndefined();
        expect(publishEvent).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt("refuses a signed-out caller", async () => {
      const newcomer = await factory.createUser();
      const competition = await privateCompetition();
      signInAs(null);

      const result = await actions.addCompetitionMemberById({
        competitionId: competition.id,
        userId: newcomer.id,
        role: "forecaster",
      });

      expect(result).toEqual({
        success: false,
        error: "You must be logged in",
        code: "UNAUTHORIZED",
      });
      expect(await roleOf(competition.id, newcomer.id)).toBeUndefined();
    });

    ifRunningContainerTestsIt(
      "lets a site admin who is not a member add someone",
      async () => {
        const siteAdmin = await factory.createAdminUser();
        const newcomer = await factory.createUser();
        const competition = await privateCompetition();
        signInAs(siteAdmin);

        const result = await actions.addCompetitionMemberById({
          competitionId: competition.id,
          userId: newcomer.id,
          role: "admin",
        });

        expect(result.success).toBe(true);
        expect(await roleOf(competition.id, newcomer.id)).toBe("admin");
        const row = await db
          .selectFrom("competition_members")
          .select("id")
          .where("competition_id", "=", competition.id)
          .where("user_id", "=", newcomer.id)
          .executeTakeFirstOrThrow();
        getTestTracker().trackId("competition_members", row.id);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a deactivated or unknown user, and no row is written",
      async () => {
        const admin = await factory.createUser();
        const gone = await factory.createUser();
        await db
          .updateTable("users")
          .set({ deactivated_at: new Date() })
          .where("id", "=", gone.id)
          .execute();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        signInAs(admin);

        const result = await actions.addCompetitionMemberById({
          competitionId: competition.id,
          userId: gone.id,
          role: "forecaster",
        });

        expect(result).toEqual({
          success: false,
          error: "No active user found with that ID",
          code: "NOT_FOUND",
        });
        expect(await roleOf(competition.id, gone.id)).toBeUndefined();
      },
    );

    ifRunningContainerTestsIt(
      "refuses someone who is already a member, leaving their role alone",
      async () => {
        const admin = await factory.createUser();
        const member = await factory.createUser();
        const competition = await privateCompetition();
        await join(competition.id, admin.id, "admin");
        await join(competition.id, member.id, "forecaster");
        signInAs(admin);

        const result = await actions.addCompetitionMemberById({
          competitionId: competition.id,
          userId: member.id,
          role: "admin",
        });

        expect(result).toEqual({
          success: false,
          error: "User is already a member of this competition",
          code: "VALIDATION_ERROR",
        });
        expect(await roleOf(competition.id, member.id)).toBe("forecaster");
      },
    );

    ifRunningContainerTestsIt(
      "reports a generic database error when the database refuses a public competition, and sends nothing",
      async () => {
        // A trigger rejects members in public competitions, so only a site
        // admin (who needs no membership of their own) can even get that far.
        const siteAdmin = await factory.createAdminUser();
        const newcomer = await factory.createUser();
        const competition = await factory.createCompetition({
          is_private: false,
        });
        signInAs(siteAdmin);

        const result = await actions.addCompetitionMemberById({
          competitionId: competition.id,
          userId: newcomer.id,
          role: "forecaster",
        });

        expect(result).toEqual({
          success: false,
          error: "Failed to add member",
          code: "DATABASE_ERROR",
        });
        expect(await roleOf(competition.id, newcomer.id)).toBeUndefined();
        expect(publishEvent).not.toHaveBeenCalled();
      },
    );
  });
});
