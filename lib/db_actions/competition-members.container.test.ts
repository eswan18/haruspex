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
          notify: [{ email: newcomer.email, name: newcomer.name }],
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
