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
import { revalidatePath } from "next/cache";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The competition actions, against a real PostgreSQL.
 *
 * The code under test reaches the database through `lib/database`, which in
 * container tests connects as the container's superuser (TEST_DATABASE_URL).
 * That role owns the tables and bypasses row-level security, so every
 * allow/deny and visibility result below comes from the application code's
 * own checks, not from RLS policies. In particular, "who can see a private
 * competition" is NOT what these tests pin; that belongs to the RLS tests.
 *
 * The test database is shared with other files (and holds seed competitions),
 * so assertions about lists look only at the rows this file created.
 */
describe("competition actions against the database", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;
  let actions: typeof import("./competitions");

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
      actions = await import("./competitions");
    }
  });

  const uniqueName = (label: string) =>
    `${label} ${Math.random().toString(36).substring(2, 10)}`;

  async function privateCompetition(name?: string) {
    return factory.createCompetition({
      ...(name ? { name } : {}),
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

  async function competitionRow(id: number) {
    return db
      .selectFrom("competitions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /** Finds (and tracks) the row an action created, by its unique name. */
  async function createdCompetition(name: string) {
    const row = await db
      .selectFrom("competitions")
      .selectAll()
      .where("name", "=", name)
      .executeTakeFirst();
    if (row) getTestTracker().trackId("competitions", row.id);
    return row;
  }

  async function membersOf(competitionId: number) {
    const rows = await db
      .selectFrom("competition_members")
      .select(["id", "user_id", "role"])
      .where("competition_id", "=", competitionId)
      .execute();
    for (const row of rows) {
      getTestTracker().trackId("competition_members", row.id);
    }
    return rows;
  }

  async function countByName(name: string) {
    const rows = await db
      .selectFrom("competitions")
      .select("id")
      .where("name", "=", name)
      .execute();
    for (const row of rows) getTestTracker().trackId("competitions", row.id);
    return rows.length;
  }

  describe("getCompetitionById", () => {
    ifRunningContainerTestsIt("returns a public competition", async () => {
      const user = await factory.createUser();
      const competition = await factory.createCompetition();
      vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

      const result = await actions.getCompetitionById(competition.id);

      expect(result).toEqual({ success: true, data: competition });
    });

    ifRunningContainerTestsIt(
      "returns a private competition to a member of it",
      async () => {
        const member = await factory.createUser();
        const competition = await privateCompetition();
        await addMember(competition.id, member.id, "forecaster");
        vi.mocked(getUserFromCookies).mockResolvedValue(member as never);

        const result = await actions.getCompetitionById(competition.id);

        expect(result).toEqual({ success: true, data: competition });
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: returns a private competition to a signed-in non-member (app code does not refuse; RLS is not in force on this connection)",
      async () => {
        const stranger = await factory.createUser();
        const competition = await privateCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(stranger as never);

        const result = await actions.getCompetitionById(competition.id);

        expect(result).toEqual({ success: true, data: competition });
      },
    );

    ifRunningContainerTestsIt(
      "returns a public competition to a signed-out caller",
      async () => {
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.getCompetitionById(competition.id);

        expect(result).toEqual({ success: true, data: competition });
      },
    );

    ifRunningContainerTestsIt(
      "returns NOT_FOUND for an id that does not exist",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.getCompetitionById(2147483000);

        expect(result).toEqual({
          success: false,
          error: "Competition not found",
          code: "NOT_FOUND",
        });
      },
    );
  });

  describe("getCompetitions", () => {
    ifRunningContainerTestsIt(
      "gives each competition the caller's role and whether they can add props",
      async () => {
        const user = await factory.createUser();
        const publicComp = await factory.createCompetition();
        const adminOf = await privateCompetition();
        const forecasterIn = await privateCompetition();
        await addMember(adminOf.id, user.id, "admin");
        await addMember(forecasterIn.id, user.id, "forecaster");
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.getCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        const byId = new Map(result.data.map((c) => [c.id, c]));
        expect(byId.get(publicComp.id)).toMatchObject({
          role: null,
          can_add_props: false,
        });
        expect(byId.get(adminOf.id)).toMatchObject({
          role: "admin",
          can_add_props: true,
        });
        expect(byId.get(forecasterIn.id)).toMatchObject({
          role: "forecaster",
          can_add_props: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "lets a site admin add props to public competitions but not to private ones they are not in",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const publicComp = await factory.createCompetition();
        const privateComp = await privateCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.getCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        const byId = new Map(result.data.map((c) => [c.id, c]));
        expect(byId.get(publicComp.id)).toMatchObject({
          role: null,
          can_add_props: true,
        });
        expect(byId.get(privateComp.id)).toMatchObject({
          role: null,
          can_add_props: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: lists a private competition to a non-member (app code does not filter; RLS is not in force on this connection)",
      async () => {
        const stranger = await factory.createUser();
        const privateComp = await privateCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(stranger as never);

        const result = await actions.getCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.find((c) => c.id === privateComp.id)).toMatchObject(
          { role: null, can_add_props: false },
        );
      },
    );

    ifRunningContainerTestsIt(
      "lists competitions to a signed-out caller with no role and no right to add props",
      async () => {
        const publicComp = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.getCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.find((c) => c.id === publicComp.id)).toMatchObject({
          role: null,
          can_add_props: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "orders competitions by name, descending",
      async () => {
        const tag = Math.random().toString(36).substring(2, 8);
        const user = await factory.createUser();
        const b = await factory.createCompetition({ name: `order_b_${tag}` });
        const c = await factory.createCompetition({ name: `order_c_${tag}` });
        const a = await factory.createCompetition({ name: `order_a_${tag}` });
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);
        const mine = [a.id, b.id, c.id];

        const result = await actions.getCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(
          result.data.filter((x) => mine.includes(x.id)).map((x) => x.id),
        ).toEqual([c.id, b.id, a.id]);
      },
    );
  });

  describe("getWritableCompetitions", () => {
    ifRunningContainerTestsIt(
      "returns private competitions the caller administers and no others, for a non-admin",
      async () => {
        const user = await factory.createUser();
        const publicComp = await factory.createCompetition();
        const adminOf = await privateCompetition();
        const forecasterIn = await privateCompetition();
        const notIn = await privateCompetition();
        await addMember(adminOf.id, user.id, "admin");
        await addMember(forecasterIn.id, user.id, "forecaster");
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.getWritableCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        const ids = result.data.map((c) => c.id);
        expect(ids).toContain(adminOf.id);
        expect(ids).not.toContain(forecasterIn.id);
        expect(ids).not.toContain(notIn.id);
        expect(ids).not.toContain(publicComp.id);
      },
    );

    ifRunningContainerTestsIt(
      "returns public competitions to a site admin but not private ones they are not an admin of",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const publicComp = await factory.createCompetition();
        const notIn = await privateCompetition();
        const adminOf = await privateCompetition();
        await addMember(adminOf.id, admin.id, "admin");
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.getWritableCompetitions();

        expect(result.success).toBe(true);
        if (!result.success) return;
        const ids = result.data.map((c) => c.id);
        expect(ids).toContain(publicComp.id);
        expect(ids).toContain(adminOf.id);
        expect(ids).not.toContain(notIn.id);
      },
    );

    ifRunningContainerTestsIt("refuses a signed-out caller", async () => {
      vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

      const result = await actions.getWritableCompetitions();

      expect(result).toEqual({
        success: false,
        error: "You must be logged in",
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("createCompetition", () => {
    ifRunningContainerTestsIt(
      "lets a site admin create a public competition whose row matches the input, with no members",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Created public");
        const open = new Date(Date.now() + DAY);
        const close = new Date(Date.now() + 2 * DAY);
        const end = new Date(Date.now() + 3 * DAY);

        const result = await actions.createCompetition({
          competition: {
            name,
            forecasts_open_date: open,
            forecasts_close_date: close,
            end_date: end,
          },
        });

        const row = await createdCompetition(name);
        expect(result).toEqual({ success: true, data: undefined });
        expect(row).toMatchObject({
          name,
          is_private: false,
          forecasts_open_date: open,
          forecasts_close_date: close,
          end_date: end,
          created_by_user_id: admin.id,
        });
        expect(await membersOf(row!.id)).toEqual([]);
        expect(revalidatePath).toHaveBeenCalledWith("/competitions");
        expect(revalidatePath).toHaveBeenCalledWith("/admin/competitions");
      },
    );

    ifRunningContainerTestsIt(
      "creates a private competition and makes the creator its admin member",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Created private");

        const result = await actions.createCompetition({
          competition: {
            name,
            is_private: true,
            forecasts_open_date: null,
            forecasts_close_date: null,
            end_date: null,
          },
        });

        const row = await createdCompetition(name);
        expect(result).toEqual({ success: true, data: undefined });
        expect(row).toMatchObject({
          name,
          is_private: true,
          forecasts_open_date: null,
          forecasts_close_date: null,
          end_date: null,
          created_by_user_id: admin.id,
        });
        expect(await membersOf(row!.id)).toEqual([
          { id: expect.any(Number), user_id: admin.id, role: "admin" },
        ]);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: created_by_user_id in the input is overwritten with the caller's id",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const someoneElse = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Forged creator");

        const result = await actions.createCompetition({
          competition: {
            name,
            is_private: true,
            forecasts_open_date: null,
            forecasts_close_date: null,
            end_date: null,
            created_by_user_id: someoneElse.id,
          },
        });

        const row = await createdCompetition(name);
        expect(result.success).toBe(true);
        expect(row?.created_by_user_id).toBe(admin.id);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin and creates no row",
      async () => {
        const user = await factory.createUser();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);
        const name = uniqueName("Refused");

        const result = await actions.createCompetition({
          competition: { name, is_private: true },
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can create competitions",
          code: "UNAUTHORIZED",
        });
        expect(await countByName(name)).toBe(0);
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller and creates no row",
      async () => {
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);
        const name = uniqueName("Refused signed out");

        const result = await actions.createCompetition({
          competition: { name, is_private: true },
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can create competitions",
          code: "UNAUTHORIZED",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a close date before the open date and creates no row",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Close before open");

        const result = await actions.createCompetition({
          competition: {
            name,
            forecasts_open_date: new Date(Date.now() + 2 * DAY),
            forecasts_close_date: new Date(Date.now() + DAY),
            end_date: new Date(Date.now() + 3 * DAY),
          },
        });

        expect(result).toEqual({
          success: false,
          error: "Open date must be before close date",
          code: "VALIDATION_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a close date equal to the open date and creates no row",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Close equals open");
        const same = new Date(Date.now() + DAY);

        const result = await actions.createCompetition({
          competition: {
            name,
            forecasts_open_date: same,
            forecasts_close_date: same,
            end_date: new Date(Date.now() + 3 * DAY),
          },
        });

        expect(result).toEqual({
          success: false,
          error: "Open date must be before close date",
          code: "VALIDATION_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "refuses an end date not after the close date and creates no row",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("End before close");

        const result = await actions.createCompetition({
          competition: {
            name,
            forecasts_open_date: new Date(Date.now() + DAY),
            forecasts_close_date: new Date(Date.now() + 3 * DAY),
            end_date: new Date(Date.now() + 2 * DAY),
          },
        });

        expect(result).toEqual({
          success: false,
          error: "Close date must be before end date",
          code: "VALIDATION_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a public competition with no dates skips date validation and is refused by the database instead",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Public no dates");

        const result = await actions.createCompetition({
          competition: { name },
        });

        expect(result).toEqual({
          success: false,
          error: "Failed to create competition",
          code: "DATABASE_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a private competition that omits its dates (rather than passing null) is refused by the database",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Private omitted dates");

        const result = await actions.createCompetition({
          competition: { name, is_private: true },
        });

        expect(result).toEqual({
          success: false,
          error: "Failed to create competition",
          code: "DATABASE_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a private competition given dates is refused by the database, not by validation, and no member is added",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Private with dates");

        const result = await actions.createCompetition({
          competition: {
            name,
            is_private: true,
            forecasts_open_date: new Date(Date.now() + DAY),
            forecasts_close_date: new Date(Date.now() + 2 * DAY),
            end_date: new Date(Date.now() + 3 * DAY),
          },
        });

        expect(result).toEqual({
          success: false,
          error: "Failed to create competition",
          code: "DATABASE_ERROR",
        });
        expect(await countByName(name)).toBe(0);
      },
    );
  });

  describe("updateCompetition", () => {
    ifRunningContainerTestsIt(
      "lets a site admin rename a public competition",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Renamed");

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect((await competitionRow(competition.id))?.name).toBe(name);
        expect(revalidatePath).toHaveBeenCalledWith("/competitions");
        expect(revalidatePath).toHaveBeenCalledWith("/admin/competitions");
      },
    );

    ifRunningContainerTestsIt(
      "lets a site admin move the dates of a public competition when the new order is valid",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const end = new Date(competition.end_date!.getTime() + 10 * DAY);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { end_date: end },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect((await competitionRow(competition.id))?.end_date).toEqual(end);
      },
    );

    ifRunningContainerTestsIt(
      "lets the admin of a private competition rename it",
      async () => {
        const memberAdmin = await factory.createUser();
        const competition = await privateCompetition();
        await addMember(competition.id, memberAdmin.id, "admin");
        vi.mocked(getUserFromCookies).mockResolvedValue(memberAdmin as never);
        const name = uniqueName("Renamed by member admin");

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect((await competitionRow(competition.id))?.name).toBe(name);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin with no membership and leaves the row unchanged",
      async () => {
        const user = await factory.createUser();
        const competition = await privateCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name: "Nope" },
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can update competitions",
          code: "UNAUTHORIZED",
        });
        expect((await competitionRow(competition.id))?.name).toBe(
          competition.name,
        );
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt(
      "refuses a forecaster of a private competition and leaves the row unchanged",
      async () => {
        const forecaster = await factory.createUser();
        const competition = await privateCompetition();
        await addMember(competition.id, forecaster.id, "forecaster");
        vi.mocked(getUserFromCookies).mockResolvedValue(forecaster as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name: "Nope" },
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can update competitions",
          code: "UNAUTHORIZED",
        });
        expect((await competitionRow(competition.id))?.name).toBe(
          competition.name,
        );
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin on a public competition and leaves the row unchanged",
      async () => {
        const user = await factory.createUser();
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name: "Nope" },
        });

        expect(result).toEqual({
          success: false,
          error: "Only admins can update competitions",
          code: "UNAUTHORIZED",
        });
        expect((await competitionRow(competition.id))?.name).toBe(
          competition.name,
        );
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller and leaves the row unchanged",
      async () => {
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name: "Nope" },
        });

        expect(result).toEqual({
          success: false,
          error: "You must be logged in",
          code: "UNAUTHORIZED",
        });
        expect((await competitionRow(competition.id))?.name).toBe(
          competition.name,
        );
      },
    );

    ifRunningContainerTestsIt(
      "silently ignores is_private in the input: the rest is applied and the flag stays",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Privacy ignored");

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name, is_private: true },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await competitionRow(competition.id)).toMatchObject({
          name,
          is_private: false,
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a new close date before the existing open date and leaves the row unchanged",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: {
            name: "Should not apply",
            forecasts_close_date: new Date(
              competition.forecasts_open_date!.getTime() - DAY,
            ),
          },
        });

        expect(result).toEqual({
          success: false,
          error: "Open date must be before close date",
          code: "VALIDATION_ERROR",
        });
        expect(await competitionRow(competition.id)).toMatchObject({
          name: competition.name,
          forecasts_close_date: competition.forecasts_close_date,
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a new end date not after the existing close date and leaves the row unchanged",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { end_date: competition.forecasts_close_date },
        });

        expect(result).toEqual({
          success: false,
          error: "Close date must be before end date",
          code: "VALIDATION_ERROR",
        });
        expect((await competitionRow(competition.id))?.end_date).toEqual(
          competition.end_date,
        );
      },
    );

    ifRunningContainerTestsIt(
      "treats an explicit undefined date as 'unchanged' when validating",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);
        const name = uniqueName("Undefined date");

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { name, end_date: undefined },
        });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await competitionRow(competition.id)).toMatchObject({
          name,
          end_date: competition.end_date,
        });
      },
    );

    ifRunningContainerTestsIt(
      "returns NOT_FOUND to a site admin changing a date of a competition that does not exist",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateCompetition({
          id: 2147483000,
          competition: { end_date: new Date(Date.now() + DAY) },
        });

        expect(result).toEqual({
          success: false,
          error: "Competition not found",
          code: "NOT_FOUND",
        });
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a site admin updating a competition that does not exist (no date fields) gets success",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateCompetition({
          id: 2147483000,
          competition: { name: "Ghost" },
        });

        expect(result).toEqual({ success: true, data: undefined });
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: giving a private competition a date passes validation and is refused by the database, leaving the row unchanged",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await privateCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.updateCompetition({
          id: competition.id,
          competition: { end_date: new Date(Date.now() + DAY) },
        });

        expect(result).toEqual({
          success: false,
          error: "Failed to update competition",
          code: "DATABASE_ERROR",
        });
        expect((await competitionRow(competition.id))?.end_date).toBeNull();
      },
    );
  });

  describe("deleteCompetition", () => {
    ifRunningContainerTestsIt(
      "lets a site admin delete a competition with no props",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await competitionRow(competition.id)).toBeUndefined();
        expect(revalidatePath).toHaveBeenCalledWith("/competitions");
        expect(revalidatePath).toHaveBeenCalledWith("/admin/competitions");
      },
    );

    ifRunningContainerTestsIt(
      "deletes a private competition together with its memberships",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const member = await factory.createUser();
        const competition = await privateCompetition();
        await addMember(competition.id, member.id, "forecaster");
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({ success: true, data: undefined });
        expect(await competitionRow(competition.id)).toBeUndefined();
        expect(await membersOf(competition.id)).toEqual([]);
      },
    );

    ifRunningContainerTestsIt(
      "refuses to delete a competition holding one prop, in the singular, and keeps everything",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        const prop = await factory.createProp({
          competition_id: competition.id,
        });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({
          success: false,
          error:
            "This competition still has 1 prop. Delete or move them first.",
          code: "VALIDATION_ERROR",
        });
        expect(await competitionRow(competition.id)).toBeDefined();
        expect(
          await db
            .selectFrom("props")
            .select("id")
            .where("id", "=", prop.id)
            .executeTakeFirst(),
        ).toBeDefined();
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt(
      "refuses to delete a competition holding several props, in the plural, and keeps everything",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        const competition = await factory.createCompetition();
        await factory.createProp({ competition_id: competition.id });
        await factory.createProp({ competition_id: competition.id });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({
          success: false,
          error:
            "This competition still has 2 props. Delete or move them first.",
          code: "VALIDATION_ERROR",
        });
        expect(await competitionRow(competition.id)).toBeDefined();
        const remaining = await db
          .selectFrom("props")
          .select("id")
          .where("competition_id", "=", competition.id)
          .execute();
        expect(remaining).toHaveLength(2);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a non-admin and keeps the competition",
      async () => {
        const user = await factory.createUser();
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(user as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({
          success: false,
          error: "Only admins can delete competitions",
          code: "UNAUTHORIZED",
        });
        expect(await competitionRow(competition.id)).toBeDefined();
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    ifRunningContainerTestsIt(
      "refuses the admin of a private competition and keeps it and its memberships",
      async () => {
        const memberAdmin = await factory.createUser();
        const competition = await privateCompetition();
        await addMember(competition.id, memberAdmin.id, "admin");
        vi.mocked(getUserFromCookies).mockResolvedValue(memberAdmin as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({
          success: false,
          error: "Only admins can delete competitions",
          code: "UNAUTHORIZED",
        });
        expect(await competitionRow(competition.id)).toBeDefined();
        expect(await membersOf(competition.id)).toHaveLength(1);
      },
    );

    ifRunningContainerTestsIt(
      "refuses a signed-out caller and keeps the competition",
      async () => {
        const competition = await factory.createCompetition();
        vi.mocked(getUserFromCookies).mockResolvedValue(null as never);

        const result = await actions.deleteCompetition({ id: competition.id });

        expect(result).toEqual({
          success: false,
          error: "Only admins can delete competitions",
          code: "UNAUTHORIZED",
        });
        expect(await competitionRow(competition.id)).toBeDefined();
      },
    );

    ifRunningContainerTestsIt(
      "SURPRISE: a site admin deleting a competition that does not exist gets success",
      async () => {
        const admin = await factory.createUser({ is_admin: true });
        vi.mocked(getUserFromCookies).mockResolvedValue(admin as never);

        const result = await actions.deleteCompetition({ id: 2147483000 });

        expect(result).toEqual({ success: true, data: undefined });
      },
    );
  });
});
