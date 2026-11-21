import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import type { Database, VUser } from "@/types/db_types";
import { getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import { getTestTracker } from "../helpers/testIdTracker";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * The core reads, with the app's `db` connected as `app_user` so row-level
 * security really applies (see user-actions-rls.integration.test.ts).
 */
vi.mock("@/lib/database", async () => {
  if (process.env.TEST_USE_CONTAINERS !== "true") return { db: null };
  const { getRlsTestDb } = await import("../helpers/testDatabase");
  return { db: await getRlsTestDb() };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { featureEnabled } from "@/lib/core/feature-flags";
import { listCategories } from "@/lib/core/categories";
import { listCompetitions } from "@/lib/core/competitions";
import { listProps, getProp } from "@/lib/core/props";

describe("core reads under row-level security", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  const asCaller = (user: { id: number }) => user as VUser;

  function privateCompetition() {
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

  async function addFlag(
    name: string,
    enabled: boolean,
    userId: number | null,
  ) {
    const row = await db
      .insertInto("feature_flags")
      .values({ name, enabled, user_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("feature_flags", row.id);
  }

  describe("featureEnabled", () => {
    ifRunningContainerTestsIt(
      "lets a user-specific row beat a global one",
      async () => {
        const user = await factory.createUser();
        const name = `flag_${Math.random().toString(36).substring(7)}`;
        await addFlag(name, false, null);
        await addFlag(name, true, user.id);
        expect(await featureEnabled(user.id, name)).toBe(true);
      },
    );

    ifRunningContainerTestsIt("is false when no row exists", async () => {
      const user = await factory.createUser();
      expect(await featureEnabled(user.id, "no-such-flag-anywhere")).toBe(
        false,
      );
    });
  });

  describe("listCompetitions", () => {
    ifRunningContainerTestsIt(
      "member view omits a private competition a site admin is not in; rls view keeps it",
      async () => {
        const admin = await factory.createAdminUser();
        const comp = await privateCompetition();

        const member = await listCompetitions(asCaller(admin), {
          view: "member",
        });
        const rls = await listCompetitions(asCaller(admin));
        expect(member.success && rls.success).toBe(true);
        if (!member.success || !rls.success) return;
        expect(member.data.map((c) => c.id)).not.toContain(comp.id);
        expect(rls.data.map((c) => c.id)).toContain(comp.id);
      },
    );

    ifRunningContainerTestsIt(
      "reports role and can_add_props for members and admins",
      async () => {
        const forecaster = await factory.createUser();
        const compAdmin = await factory.createUser();
        const comp = await privateCompetition();
        await addMember(comp.id, forecaster.id, "forecaster");
        await addMember(comp.id, compAdmin.id, "admin");

        const asForecaster = await listCompetitions(asCaller(forecaster), {
          view: "member",
        });
        const asAdmin = await listCompetitions(asCaller(compAdmin), {
          view: "member",
        });
        if (!asForecaster.success || !asAdmin.success) throw new Error("read");
        const f = asForecaster.data.find((c) => c.id === comp.id);
        const a = asAdmin.data.find((c) => c.id === comp.id);
        expect(f).toMatchObject({ role: "forecaster", can_add_props: false });
        expect(a).toMatchObject({ role: "admin", can_add_props: true });
      },
    );

    ifRunningContainerTestsIt(
      "gives only a site admin can_add_props on a public season",
      async () => {
        const reader = await factory.createUser();
        const admin = await factory.createAdminUser();
        const comp = await factory.createCompetition({ is_private: false });

        const asReader = await listCompetitions(asCaller(reader));
        const asAdmin = await listCompetitions(asCaller(admin));
        if (!asReader.success || !asAdmin.success) throw new Error("read");
        expect(asReader.data.find((c) => c.id === comp.id)).toMatchObject({
          role: null,
          can_add_props: false,
        });
        expect(asAdmin.data.find((c) => c.id === comp.id)).toMatchObject({
          can_add_props: true,
        });
      },
    );
  });

  describe("props", () => {
    ifRunningContainerTestsIt(
      "member view drops others' personal props and private seasons the caller is not in; rls view keeps them",
      async () => {
        const admin = await factory.createAdminUser();
        const other = await factory.createUser();
        const personal = await factory.createPersonalProp(other.id);
        const comp = await privateCompetition();
        const privateProp = await factory.createCompetitionProp(comp.id);

        const member = await listProps(asCaller(admin), { view: "member" });
        const rls = await listProps(asCaller(admin), {});
        if (!member.success || !rls.success) throw new Error("read");
        const memberIds = member.data.map((p) => p.prop_id);
        const rlsIds = rls.data.map((p) => p.prop_id);
        expect(memberIds).not.toContain(personal.id);
        expect(memberIds).not.toContain(privateProp.id);
        expect(rlsIds).toContain(personal.id);
        expect(rlsIds).toContain(privateProp.id);
      },
    );

    ifRunningContainerTestsIt(
      "getProp hides another user's personal prop in the member view only",
      async () => {
        const admin = await factory.createAdminUser();
        const other = await factory.createUser();
        const personal = await factory.createPersonalProp(other.id);

        const member = await getProp(asCaller(admin), personal.id, {
          view: "member",
        });
        const rls = await getProp(asCaller(admin), personal.id);
        expect(member).toEqual({ success: true, data: null });
        expect(rls.success && rls.data?.prop_id).toBe(personal.id);
      },
    );

    ifRunningContainerTestsIt(
      "getProp returns an owner's personal choice prop with its options",
      async () => {
        const owner = await factory.createUser();
        const { prop } = await factory.createChoiceProp("one_of", ["a", "b"], {
          user_id: owner.id,
          competition_id: null,
        });
        const result = await getProp(asCaller(owner), prop.id, {
          view: "member",
        });
        if (!result.success || !result.data) throw new Error("read");
        expect(result.data.options.map((o) => o.text)).toEqual(["a", "b"]);
      },
    );
  });

  describe("getProp withUserForecast", () => {
    ifRunningContainerTestsIt(
      "carries the caller's binary forecast, null for none, and omits it by default",
      async () => {
        const user = await factory.createUser();
        const other = await factory.createUser();
        const prop = await factory.createProp();
        await factory.createForecast(user.id, prop.id, { forecast: 0.7 });
        await factory.createForecast(other.id, prop.id, { forecast: 0.2 });

        const mine = await getProp(asCaller(user), prop.id, {
          withUserForecast: true,
        });
        const theirs = await getProp(asCaller(other), prop.id, {
          withUserForecast: true,
        });
        const plain = await getProp(asCaller(user), prop.id);
        if (!mine.success || !theirs.success || !plain.success) {
          throw new Error("read");
        }
        expect(mine.data?.user_forecast).toBe(0.7);
        expect(theirs.data?.user_forecast).toBe(0.2);
        expect(plain.data).not.toHaveProperty("user_forecast");

        const nobody = await factory.createUser();
        const none = await getProp(asCaller(nobody), prop.id, {
          withUserForecast: true,
        });
        expect(none.success && none.data?.user_forecast).toBeNull();
      },
    );

    ifRunningContainerTestsIt("is null for a choice prop", async () => {
      const user = await factory.createUser();
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "a",
        "b",
      ]);
      await factory.createChoiceForecast(user.id, prop.id, [
        { optionId: options[0].id, probability: 0.6 },
        { optionId: options[1].id, probability: 0.4 },
      ]);
      const result = await getProp(asCaller(user), prop.id, {
        withUserForecast: true,
      });
      if (!result.success || !result.data) throw new Error("read");
      expect(result.data.user_forecast).toBeNull();
      expect(result.data.options[0].user_forecast).toBe(0.6);
    });
  });

  describe("listCategories", () => {
    ifRunningContainerTestsIt("returns the seeded categories", async () => {
      const result = await listCategories(null);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.length).toBeGreaterThan(0);
    });
  });
});
