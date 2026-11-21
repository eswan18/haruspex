import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import type { Database, VUser } from "@/types/db_types";
import { getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import { getTestTracker } from "../helpers/testIdTracker";
import { callTool, type ToolCallResult } from "../helpers/mcpCall";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * Every tool, end to end through the real MCP server: real tool functions,
 * real core, the app's `db` connected as `app_user` so row-level security
 * applies, and the SDK validating each result against the tool's output
 * schema. A field the schema does not allow (a competition status it does not
 * list, a null where it wants a string) fails here instead of in a client.
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

import { buildMcpServer } from "@/lib/mcp/server";

const DAY = 24 * 60 * 60 * 1000;
const BOTH = ["haruspex:read", "haruspex:write"];

describe("the MCP server's tools, end to end", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  /**
   * A reader who belongs to a private competition, can see a public season
   * with a resolved choice prop, owns a personal prop, and has the
   * personal-props flag: every shape of row the tools return.
   */
  async function seededReader() {
    const user = (await factory.createUser()) as unknown as VUser;
    const flag = await db
      .insertInto("feature_flags")
      .values({ name: "personal-props", enabled: true, user_id: user.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("feature_flags", flag.id);

    const priv = await factory.createCompetition({
      is_private: true,
      forecasts_open_date: null,
      forecasts_close_date: null,
      end_date: null,
    });
    const member = await db
      .insertInto("competition_members")
      .values({ competition_id: priv.id, user_id: user.id, role: "forecaster" })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("competition_members", member.id);
    const privProp = await factory.createCompetitionProp(priv.id, {
      forecasts_due_date: new Date(Date.now() + 7 * DAY),
      resolution_due_date: new Date(Date.now() + 30 * DAY),
    });
    await factory.createForecast(user.id, privProp.id, { forecast: 0.4 });

    const season = await factory.createCompetition({
      is_private: false,
      forecasts_open_date: new Date(Date.now() - 30 * DAY),
      forecasts_close_date: new Date(Date.now() - 7 * DAY),
      end_date: new Date(Date.now() + 30 * DAY),
    });
    const { prop: choiceProp, options } = await factory.createChoiceProp(
      "one_of",
      ["Red", "Blue"],
      { competition_id: season.id },
    );
    await factory.createChoiceResolution(choiceProp.id, [
      { optionId: options[0].id, outcome: true },
      { optionId: options[1].id, outcome: false },
    ]);

    const personal = await factory.createPersonalProp(user.id);
    return { user, privProp, choiceProp, personal };
  }

  /**
   * The result came back, matched its output schema (or the SDK would have
   * made it an error), and carries the same data as JSON text, since some
   * clients hand the model only the text content.
   */
  function expectData(result: ToolCallResult | undefined) {
    const text = (result?.content ?? []).map((c) => c.text ?? "");
    expect(result?.isError, text.join("\n")).toBeFalsy();
    expect(result?.structuredContent).toBeDefined();
    expect(text.map((t) => tryParse(t))).toContainEqual(
      result?.structuredContent,
    );
    return result!.structuredContent!;
  }

  function tryParse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  const call = (
    user: VUser,
    name: string,
    args: Record<string, unknown> = {},
  ) => callTool(buildMcpServer(user), user, name, args, BOTH);

  ifRunningContainerTestsIt(
    "list_competitions returns a private competition",
    async () => {
      const { user } = await seededReader();
      const data = expectData(await call(user, "list_competitions"));
      const statuses = (data.competitions as { status: string }[]).map(
        (c) => c.status,
      );
      expect(statuses).toContain("private");
    },
  );

  ifRunningContainerTestsIt("list_categories returns data", async () => {
    const { user } = await seededReader();
    expectData(await call(user, "list_categories"));
  });

  ifRunningContainerTestsIt(
    "list_props returns every kind of prop",
    async () => {
      const { user, privProp, choiceProp, personal } = await seededReader();
      const data = expectData(await call(user, "list_props", { limit: 200 }));
      const ids = (data.props as { id: number }[]).map((p) => p.id);
      expect(ids).toEqual(
        expect.arrayContaining([privProp.id, choiceProp.id, personal.id]),
      );
    },
  );

  ifRunningContainerTestsIt(
    "get_prop returns a resolved choice prop and a forecasted binary one",
    async () => {
      const { user, privProp, choiceProp } = await seededReader();
      const choice = expectData(
        await call(user, "get_prop", { prop_id: choiceProp.id }),
      );
      expect(choice.status).toBe("resolved");
      const binary = expectData(
        await call(user, "get_prop", { prop_id: privProp.id }),
      );
      expect(binary.your_forecast).toBe(0.4);
    },
  );

  ifRunningContainerTestsIt(
    "create_prop then resolve_prop on a personal prop",
    async () => {
      const { user } = await seededReader();
      const created = expectData(
        await call(user, "create_prop", {
          text: `Will this end-to-end test pass ${Math.random()}?`,
          personal: true,
          forecasts_due_date: new Date(Date.now() + 7 * DAY).toISOString(),
          resolution_due_date: new Date(Date.now() + 30 * DAY).toISOString(),
        }),
      );
      getTestTracker().trackId("props", created.id as number);

      const resolved = expectData(
        await call(user, "resolve_prop", {
          prop_id: created.id,
          resolution: true,
        }),
      );
      expect(resolved.resolution).toBe(true);
      const row = await db
        .selectFrom("resolutions")
        .select("id")
        .where("prop_id", "=", created.id as number)
        .executeTakeFirstOrThrow();
      getTestTracker().trackId("resolutions", row.id);
    },
  );

  describe("list_suggested_props", () => {
    async function suggestion(
      suggesterId: number,
      decided?: { status: "accepted" | "rejected"; by: number },
    ) {
      const row = await db
        .insertInto("suggested_props")
        .values({
          suggester_user_id: suggesterId,
          prop: `Will suggestion ${Math.random()} come true?`,
          notes: "Settle it by the official count.",
          status: decided?.status ?? null,
          decided_by: decided?.by ?? null,
          decided_at: decided ? new Date() : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      getTestTracker().trackId("suggested_props", row.id);
      return row.id;
    }

    ifRunningContainerTestsIt(
      "shows a site admin the undecided queue by default",
      async () => {
        const admin = (await factory.createAdminUser()) as unknown as VUser;
        const suggester = await factory.createUser();
        const pending = await suggestion(suggester.id);
        const accepted = await suggestion(suggester.id, {
          status: "accepted",
          by: admin.id,
        });

        const data = expectData(await call(admin, "list_suggested_props"));
        const rows = data.suggestions as {
          id: number;
          status: string;
          suggested_by: { id: number };
        }[];
        const ids = rows.map((r) => r.id);
        expect(ids).toContain(pending);
        expect(ids).not.toContain(accepted);
        const mine = rows.find((r) => r.id === pending)!;
        expect(mine.status).toBe("undecided");
        expect(mine.suggested_by.id).toBe(suggester.id);
      },
    );

    ifRunningContainerTestsIt(
      "shows decided ones, with who decided, when asked",
      async () => {
        const admin = (await factory.createAdminUser()) as unknown as VUser;
        const suggester = await factory.createUser();
        const rejected = await suggestion(suggester.id, {
          status: "rejected",
          by: admin.id,
        });

        const data = expectData(
          await call(admin, "list_suggested_props", {
            status: "all",
            limit: 200,
          }),
        );
        const row = (
          data.suggestions as {
            id: number;
            status: string;
            decided_by: string | null;
          }[]
        ).find((r) => r.id === rejected)!;
        expect(row.status).toBe("rejected");
        expect(row.decided_by).toBe(admin.name);
      },
    );

    ifRunningContainerTestsIt(
      "is not offered to anyone but a site admin",
      async () => {
        const { user } = await seededReader();
        const result = await call(user, "list_suggested_props");
        // No result at all: the server answers "unknown tool" with a protocol
        // error. Were the tool registered, the core's refusal would come back
        // as an isError result instead.
        expect(result).toBeUndefined();
      },
    );
  });
});
