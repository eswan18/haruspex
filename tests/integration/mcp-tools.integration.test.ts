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
 * The MCP tool functions, with the app's `db` connected as `app_user` so
 * row-level security really applies (see user-actions-rls.integration.test.ts).
 */
vi.mock("@/lib/database", async () => {
  if (process.env.TEST_USE_CONTAINERS !== "true") return { db: null };
  const { getRlsTestDb } = await import("../helpers/testDatabase");
  return { db: await getRlsTestDb() };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pubsub/client", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import { publishEvent } from "@/lib/pubsub/client";
import { resolveCompetition, resolveCategory } from "@/lib/mcp/names";
import {
  listCompetitionsTool,
  listCategoriesTool,
  listPropsTool,
  getPropTool,
  createPropTool,
  resolvePropTool,
} from "@/lib/mcp/tools";

const DAY = 24 * 60 * 60 * 1000;

describe("MCP tools under row-level security", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  const as = (user: { id: number }) => user as VUser;

  const privateCompetition = (overrides = {}) =>
    factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
      ...overrides,
    });

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

  async function grantFlag(name: string, userId: number) {
    const row = await db
      .insertInto("feature_flags")
      .values({ name, enabled: true, user_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("feature_flags", row.id);
  }

  const ids = (r: { ok: true; data: { props: { id: number }[] } }) =>
    r.data.props.map((p) => p.id);

  describe("name resolution", () => {
    ifRunningContainerTestsIt(
      "finds a competition by id and by name in any case",
      async () => {
        const user = await factory.createUser();
        const comp = await factory.createCompetition({
          name: `Zeta ${Math.random()}`,
        });
        const byId = await resolveCompetition(as(user), comp.id);
        const byName = await resolveCompetition(
          as(user),
          comp.name.toUpperCase(),
        );
        expect(byId.ok && byId.competition.id).toBe(comp.id);
        expect(byName.ok && byName.competition.id).toBe(comp.id);
      },
    );

    ifRunningContainerTestsIt(
      "refuses an ambiguous name, listing both ids",
      async () => {
        const user = await factory.createUser();
        const tag = Math.random().toString(36).slice(2, 8);
        const a = await factory.createCompetition({ name: `Q1 ${tag}` });
        const b = await factory.createCompetition({ name: `q1 ${tag}` });
        const result = await resolveCompetition(as(user), `q1 ${tag}`);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("matches several competitions");
        expect(result.error).toContain(`id ${a.id}`);
        expect(result.error).toContain(`id ${b.id}`);
        expect(result.error).toContain("pass an id");
      },
    );

    ifRunningContainerTestsIt(
      "offers candidates for an unknown name or category",
      async () => {
        const user = await factory.createUser();
        await factory.createCompetition();
        const comp = await resolveCompetition(as(user), "no-such-season");
        const cat = await resolveCategory(as(user), "no-such-category");
        expect(comp.ok).toBe(false);
        expect(cat.ok).toBe(false);
        if (comp.ok || cat.ok) return;
        expect(comp.error).toContain('No competition "no-such-season"');
        expect(comp.error).toContain("Did you mean");
        expect(cat.error).toContain('No category "no-such-category"');
      },
    );
  });

  describe("list tools", () => {
    ifRunningContainerTestsIt(
      "lists competitions with role and status, and categories",
      async () => {
        const user = await factory.createUser();
        const comp = await privateCompetition();
        await addMember(comp.id, user.id, "forecaster");
        const result = await listCompetitionsTool(as(user), {});
        if (!result.ok) throw new Error(result.error);
        expect(
          result.data.competitions.find((c) => c.id === comp.id),
        ).toMatchObject({
          your_role: "forecaster",
          status: "private",
          can_add_props: false,
          forecasts_close_date: null,
        });
        const cats = await listCategoriesTool(as(user), {});
        expect(cats.ok && cats.data.categories.length).toBeGreaterThan(0);
      },
    );
  });

  describe("listPropsTool", () => {
    ifRunningContainerTestsIt(
      "lists voided props under status voided, apart from resolved ones",
      async () => {
        const owner = await factory.createUser();
        const voided = await factory.createPersonalProp(owner.id);
        const answered = await factory.createPersonalProp(owner.id);
        await factory.createResolution(voided.id, {
          resolution: null,
          voided: true,
        });
        await factory.createResolution(answered.id, { resolution: true });

        const onlyVoided = await listPropsTool(as(owner), {
          personal: true,
          status: "voided",
        });
        const onlyResolved = await listPropsTool(as(owner), {
          personal: true,
          status: "resolved",
        });
        if (!onlyVoided.ok || !onlyResolved.ok) throw new Error("read");
        expect(ids(onlyVoided)).toEqual([voided.id]);
        expect(ids(onlyResolved)).toEqual([answered.id]);
      },
    );

    ifRunningContainerTestsIt(
      "omits another user's personal prop even for a site admin",
      async () => {
        const admin = await factory.createAdminUser();
        const other = await factory.createUser();
        const personal = await factory.createPersonalProp(other.id);
        const result = await listPropsTool(as(admin), { limit: 200 });
        if (!result.ok) throw new Error(result.error);
        expect(ids(result)).not.toContain(personal.id);
      },
    );

    ifRunningContainerTestsIt(
      "shows a private competition's props to a member (positive membership branch)",
      async () => {
        const member = await factory.createUser();
        const outsider = await factory.createUser();
        const comp = await privateCompetition();
        await addMember(comp.id, member.id, "forecaster");
        const prop = await factory.createCompetitionProp(comp.id);

        const mine = await listPropsTool(as(member), { competition: comp.id });
        const theirs = await listPropsTool(as(outsider), { limit: 200 });
        if (!mine.ok || !theirs.ok) throw new Error("read");
        expect(ids(mine)).toEqual([prop.id]);
        expect(ids(theirs)).not.toContain(prop.id);
      },
    );

    ifRunningContainerTestsIt(
      "shows a user their own personal prop",
      async () => {
        const owner = await factory.createUser();
        const personal = await factory.createPersonalProp(owner.id);
        const result = await listPropsTool(as(owner), { personal: true });
        if (!result.ok) throw new Error(result.error);
        expect(ids(result)).toEqual([personal.id]);
        expect(result.data.props[0].personal).toBe(true);
      },
    );

    ifRunningContainerTestsIt(
      "shows anyone a public season's prop",
      async () => {
        const reader = await factory.createUser();
        const comp = await factory.createCompetition({ is_private: false });
        const prop = await factory.createCompetitionProp(comp.id);
        const result = await listPropsTool(as(reader), {
          competition: comp.id,
        });
        if (!result.ok) throw new Error(result.error);
        expect(ids(result)).toEqual([prop.id]);
        expect(result.data.props[0].competition).toEqual({
          id: comp.id,
          name: comp.name,
        });
      },
    );

    ifRunningContainerTestsIt("filters by status", async () => {
      const owner = await factory.createUser();
      const open = await factory.createPersonalProp(owner.id);
      const done = await factory.createPersonalProp(owner.id);
      await factory.createResolution(done.id);

      const resolved = await listPropsTool(as(owner), {
        personal: true,
        status: "resolved",
      });
      const opened = await listPropsTool(as(owner), {
        personal: true,
        status: "open",
      });
      if (!resolved.ok || !opened.ok) throw new Error("read");
      expect(ids(resolved)).toEqual([done.id]);
      expect(ids(opened)).toEqual([open.id]);
    });

    ifRunningContainerTestsIt(
      "limits newest-first and flags truncation",
      async () => {
        const owner = await factory.createUser();
        await factory.createPersonalProp(owner.id);
        const newer = await factory.createPersonalProp(owner.id);
        const result = await listPropsTool(as(owner), {
          personal: true,
          limit: 1,
        });
        if (!result.ok) throw new Error(result.error);
        expect(ids(result)).toEqual([newer.id]);
        expect(result.data.truncated).toBe(true);
      },
    );

    ifRunningContainerTestsIt(
      "refuses competition together with personal",
      async () => {
        const user = await factory.createUser();
        const result = await listPropsTool(as(user), {
          competition: 1,
          personal: true,
        });
        expect(result.ok).toBe(false);
      },
    );
  });

  describe("getPropTool", () => {
    ifRunningContainerTestsIt(
      "returns the caller's forecast on a binary prop",
      async () => {
        const user = await factory.createUser();
        const prop = await factory.createProp();
        await factory.createForecast(user.id, prop.id, { forecast: 0.65 });
        const result = await getPropTool(as(user), { prop_id: prop.id });
        if (!result.ok) throw new Error(result.error);
        expect(result.data.your_forecast).toBe(0.65);
        expect(result.data.status).toBe("open");
      },
    );

    ifRunningContainerTestsIt(
      "returns your_probability per option on a choice prop",
      async () => {
        const user = await factory.createUser();
        const { prop, options } = await factory.createChoiceProp("one_of", [
          "a",
          "b",
        ]);
        await factory.createChoiceForecast(user.id, prop.id, [
          { optionId: options[0].id, probability: 0.3 },
          { optionId: options[1].id, probability: 0.7 },
        ]);
        const result = await getPropTool(as(user), { prop_id: prop.id });
        if (!result.ok) throw new Error(result.error);
        expect(result.data.your_forecast).toBeNull();
        expect(result.data.options.map((o) => o.your_probability)).toEqual([
          0.3, 0.7,
        ]);
      },
    );

    ifRunningContainerTestsIt(
      "says so when a prop is not visible",
      async () => {
        const admin = await factory.createAdminUser();
        const other = await factory.createUser();
        const personal = await factory.createPersonalProp(other.id);
        const result = await getPropTool(as(admin), { prop_id: personal.id });
        expect(result).toEqual({
          ok: false,
          error: `No prop ${personal.id} (or not one you can see)`,
        });
      },
    );
  });

  describe("createPropTool", () => {
    ifRunningContainerTestsIt(
      "creates a personal prop with the flag",
      async () => {
        const user = await factory.createUser();
        await grantFlag("personal-props", user.id);
        const result = await createPropTool(as(user), {
          text: "It rains in Lisbon on New Year's Day",
          personal: true,
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.data).toMatchObject({
          personal: true,
          competition: null,
          status: "open",
          kind: "binary",
        });
        // The tool tracked nothing, so register the prop for cleanup.
        getTestTracker().trackId("props", result.data.id);
      },
    );

    ifRunningContainerTestsIt(
      "creates a choice prop with options",
      async () => {
        const user = await factory.createUser();
        await grantFlag("personal-props", user.id);
        const result = await createPropTool(as(user), {
          text: "Which team wins the league this year",
          personal: true,
          kind: "one_of",
          options: ["Red", "Blue"],
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.data.options.map((o) => o.text)).toEqual(["Red", "Blue"]);
        getTestTracker().trackId("props", result.data.id);
      },
    );

    ifRunningContainerTestsIt("needs exactly one destination", async () => {
      const user = await factory.createUser();
      const both = await createPropTool(as(user), {
        text: "A long enough proposition",
        competition: 1,
        personal: true,
      });
      const neither = await createPropTool(as(user), {
        text: "A long enough proposition",
      });
      expect(both.ok).toBe(false);
      expect(neither.ok).toBe(false);
    });

    ifRunningContainerTestsIt(
      "refuses a reader adding to a public season",
      async () => {
        const reader = await factory.createUser();
        const comp = await factory.createCompetition({ is_private: false });
        const result = await createPropTool(as(reader), {
          text: "A long enough proposition",
          competition: comp.id,
          category: 1,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("not allowed");
      },
    );

    ifRunningContainerTestsIt("names the invalid field", async () => {
      const user = await factory.createUser();
      await grantFlag("personal-props", user.id);
      const result = await createPropTool(as(user), {
        text: "short",
        personal: true,
      });
      expect(result).toEqual({
        ok: false,
        error: "text: Proposition text must be at least 8 characters long",
      });
    });

    ifRunningContainerTestsIt(
      "notifies members only when notify_members is true",
      async () => {
        const admin = await factory.createUser();
        const member = await factory.createUser();
        const comp = await privateCompetition();
        await addMember(comp.id, admin.id, "admin");
        await addMember(comp.id, member.id, "forecaster");
        const deadlines = {
          forecasts_due_date: new Date(Date.now() + 7 * DAY).toISOString(),
          resolution_due_date: new Date(Date.now() + 30 * DAY).toISOString(),
        };

        const quiet = await createPropTool(as(admin), {
          text: "A quiet proposition here",
          competition: comp.id,
          ...deadlines,
        });
        if (!quiet.ok) throw new Error(quiet.error);
        getTestTracker().trackId("props", quiet.data.id);
        await new Promise((r) => setTimeout(r, 200));
        expect(publishEvent).not.toHaveBeenCalled();

        const loud = await createPropTool(as(admin), {
          text: "A loud proposition here",
          competition: comp.id,
          notify_members: true,
          ...deadlines,
        });
        if (!loud.ok) throw new Error(loud.error);
        getTestTracker().trackId("props", loud.data.id);
        await vi.waitFor(() => expect(publishEvent).toHaveBeenCalled());
      },
    );
  });

  describe("resolvePropTool", () => {
    ifRunningContainerTestsIt(
      "lets the owner void a personal prop",
      async () => {
        const owner = await factory.createUser();
        const prop = await factory.createPersonalProp(owner.id);
        const result = await resolvePropTool(as(owner), {
          prop_id: prop.id,
          voided: true,
          notes: "condition failed",
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.data).toMatchObject({
          status: "voided",
          resolution: null,
        });
        expect(result.summary).toBe(`Voided prop ${prop.id}`);
      },
    );

    ifRunningContainerTestsIt(
      "lets the owner resolve a personal binary prop",
      async () => {
        const owner = await factory.createUser();
        const prop = await factory.createPersonalProp(owner.id);
        const result = await resolvePropTool(as(owner), {
          prop_id: prop.id,
          resolution: true,
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.data).toMatchObject({
          status: "resolved",
          resolution: true,
        });
        const again = await resolvePropTool(as(owner), {
          prop_id: prop.id,
          resolution: false,
        });
        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.error).toContain("overwrite: true");
      },
    );

    ifRunningContainerTestsIt("refuses a forecaster", async () => {
      const forecaster = await factory.createUser();
      const comp = await privateCompetition();
      await addMember(comp.id, forecaster.id, "forecaster");
      const prop = await factory.createCompetitionProp(comp.id);
      const result = await resolvePropTool(as(forecaster), {
        prop_id: prop.id,
        resolution: true,
      });
      expect(result.ok).toBe(false);
    });
  });
});
