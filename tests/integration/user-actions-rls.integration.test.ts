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
 * Every write a person can make, run through the real server action with the
 * app's `db` connected as `app_user` -- the non-owner role that row-level
 * security actually applies to.
 *
 * Every other action test connects as the table owner, which RLS exempts, so
 * a policy that blocks a real user's action passes there. That is how
 * createSuggestedProp shipped an insert no reader could complete (#227).
 * Seeding still goes through the owner connection; only the action under test
 * runs as app_user.
 */
vi.mock("@/lib/database", async () => {
  if (process.env.TEST_USE_CONTAINERS !== "true") return { db: null };
  const { getRlsTestDb } = await import("../helpers/testDatabase");
  return { db: await getRlsTestDb() };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/get-user", () => ({ getUserFromCookies: vi.fn() }));
vi.mock("@/lib/pubsub/client", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getUserFromCookies } from "@/lib/get-user";
import {
  createForecast,
  updateForecast,
  saveChoiceForecast,
} from "@/lib/db_actions/forecasts";
import {
  createProp,
  updateProp,
  resolveProp,
  unresolveProp,
  deleteResolution,
  deleteProp,
} from "@/lib/db_actions/props";
import { updatePropOptions } from "@/lib/db_actions/prop-options";
import {
  createCompetition,
  updateCompetition,
  deleteCompetition,
} from "@/lib/db_actions/competitions";
import {
  addCompetitionMemberById,
  updateMemberRole,
  removeCompetitionMember,
} from "@/lib/db_actions/competition-members";
import {
  createSuggestedProp,
  setSuggestedPropStatus,
} from "@/lib/db_actions/suggested-props";
import { setNotificationPreference } from "@/lib/db_actions/notification-preferences";
import { setUserActive, updateUser } from "@/lib/db_actions/users";

const DAY = 24 * 60 * 60 * 1000;

describe("user actions under row-level security", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  function actAs(user: { id: number }) {
    vi.mocked(getUserFromCookies).mockResolvedValue(user as VUser);
  }

  /**
   * A competition taking forecasts now. A private one carries no dates of its
   * own (private_competitions_no_dates): its deadlines live on each prop, see
   * `privateDeadlines`.
   */
  function openCompetition(isPrivate: boolean) {
    return factory.createCompetition(
      isPrivate
        ? {
            is_private: true,
            forecasts_open_date: null,
            forecasts_close_date: null,
            end_date: null,
          }
        : {
            is_private: false,
            forecasts_open_date: new Date(Date.now() - 7 * DAY),
            forecasts_close_date: new Date(Date.now() + 7 * DAY),
            end_date: new Date(Date.now() + 30 * DAY),
          },
    );
  }

  /** Future deadlines for a prop in a private competition. */
  const privateDeadlines = () => ({
    forecasts_due_date: new Date(Date.now() + 7 * DAY),
    resolution_due_date: new Date(Date.now() + 30 * DAY),
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

  async function propIdByText(text: string): Promise<number> {
    const row = await db
      .selectFrom("props")
      .select("id")
      .where("text", "=", text)
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("props", row.id);
    return row.id;
  }

  /** Fails with the action's own error message, which says what broke. */
  function expectOk(result: { success: boolean; error?: string }) {
    expect(result.success ? "ok" : result.error).toBe("ok");
  }

  describe("a reader in a public competition", () => {
    ifRunningContainerTestsIt("creates and updates a forecast", async () => {
      const reader = await factory.createUser();
      const comp = await openCompetition(false);
      const prop = await factory.createCompetitionProp(comp.id);
      actAs(reader);

      const created = await createForecast({
        forecast: { user_id: reader.id, prop_id: prop.id, forecast: 0.3 },
      });
      expectOk(created);
      if (!created.success) return;
      getTestTracker().trackId("forecasts", created.data);

      expectOk(
        await updateForecast({ id: created.data, forecast: { forecast: 0.6 } }),
      );
    });

    ifRunningContainerTestsIt(
      "saves a forecast on a choice prop, then changes it",
      async () => {
        const reader = await factory.createUser();
        const comp = await openCompetition(false);
        const { prop, options } = await factory.createChoiceProp(
          "one_of",
          ["Red", "Blue"],
          { competition_id: comp.id },
        );
        actAs(reader);

        const first = await saveChoiceForecast({
          propId: prop.id,
          probabilities: [
            { optionId: options[0].id, probability: 0.7 },
            { optionId: options[1].id, probability: 0.3 },
          ],
        });
        expectOk(first);
        if (first.success) getTestTracker().trackId("forecasts", first.data);

        expectOk(
          await saveChoiceForecast({
            propId: prop.id,
            probabilities: [
              { optionId: options[0].id, probability: 0.4 },
              { optionId: options[1].id, probability: 0.6 },
            ],
          }),
        );
      },
    );
  });

  describe("a forecaster in a private competition", () => {
    ifRunningContainerTestsIt("creates and updates a forecast", async () => {
      const member = await factory.createUser();
      const comp = await openCompetition(true);
      await addMember(comp.id, member.id, "forecaster");
      const prop = await factory.createCompetitionProp(
        comp.id,
        privateDeadlines(),
      );
      actAs(member);

      const created = await createForecast({
        forecast: { user_id: member.id, prop_id: prop.id, forecast: 0.3 },
      });
      expectOk(created);
      if (!created.success) return;
      getTestTracker().trackId("forecasts", created.data);

      expectOk(
        await updateForecast({ id: created.data, forecast: { forecast: 0.6 } }),
      );
    });

    ifRunningContainerTestsIt("saves a choice forecast", async () => {
      const member = await factory.createUser();
      const comp = await openCompetition(true);
      await addMember(comp.id, member.id, "forecaster");
      const { prop, options } = await factory.createChoiceProp(
        "any_of",
        ["Red", "Blue"],
        { competition_id: comp.id, ...privateDeadlines() },
      );
      actAs(member);

      const saved = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.7 },
          { optionId: options[1].id, probability: 0.2 },
        ],
      });
      expectOk(saved);
      if (saved.success) getTestTracker().trackId("forecasts", saved.data);
    });
  });

  describe("a prop whose own deadline has passed", () => {
    /**
     * A private competition has no close date of its own; each prop carries
     * one. The forecast actions read `competition_forecasts_close_date`, which
     * the views define as COALESCE(prop deadline, competition close date) --
     * so despite the name it is the prop's own deadline wherever there is one.
     */
    const pastDeadlines = () => ({
      forecasts_due_date: new Date(Date.now() - DAY),
      resolution_due_date: new Date(Date.now() + 30 * DAY),
    });

    ifRunningContainerTestsIt(
      "refuses a new forecast, a changed one and a choice forecast",
      async () => {
        const member = await factory.createUser();
        const comp = await openCompetition(true);
        await addMember(comp.id, member.id, "forecaster");
        const closed = await factory.createCompetitionProp(
          comp.id,
          pastDeadlines(),
        );
        const alreadyForecast = await factory.createCompetitionProp(
          comp.id,
          pastDeadlines(),
        );
        const existing = await factory.createForecast(
          member.id,
          alreadyForecast.id,
          { forecast: 0.5 },
        );
        const { prop: closedChoice, options } = await factory.createChoiceProp(
          "one_of",
          ["Red", "Blue"],
          { competition_id: comp.id, ...pastDeadlines() },
        );
        actAs(member);

        const created = await createForecast({
          forecast: { user_id: member.id, prop_id: closed.id, forecast: 0.3 },
        });
        expect(created).toMatchObject({
          success: false,
          code: "VALIDATION_ERROR",
        });

        const updated = await updateForecast({
          id: existing.id,
          forecast: { forecast: 0.9 },
        });
        expect(updated).toMatchObject({
          success: false,
          code: "VALIDATION_ERROR",
        });

        const choice = await saveChoiceForecast({
          propId: closedChoice.id,
          probabilities: [
            { optionId: options[0].id, probability: 0.5 },
            { optionId: options[1].id, probability: 0.5 },
          ],
        });
        expect(choice).toMatchObject({
          success: false,
          code: "VALIDATION_ERROR",
        });
      },
    );

    ifRunningContainerTestsIt(
      "refuses a forecast on a personal prop past its deadline",
      async () => {
        const owner = await factory.createUser();
        const prop = await factory.createPersonalProp(owner.id, {
          forecasts_due_date: new Date(Date.now() - DAY),
        });
        actAs(owner);

        const created = await createForecast({
          forecast: { user_id: owner.id, prop_id: prop.id, forecast: 0.3 },
        });
        expect(created).toMatchObject({
          success: false,
          code: "VALIDATION_ERROR",
        });
      },
    );
  });

  describe("a reader with personal props", () => {
    ifRunningContainerTestsIt(
      "creates, forecasts, edits, resolves, unresolves and deletes a yes/no prop",
      async () => {
        const owner = await factory.createUser();
        actAs(owner);
        const text = `Personal binary ${Math.random()}`;

        expectOk(
          await createProp({
            prop: {
              text,
              notes: null,
              category_id: null,
              competition_id: null,
              user_id: owner.id,
            },
          }),
        );
        const propId = await propIdByText(text);

        const forecast = await createForecast({
          forecast: { user_id: owner.id, prop_id: propId, forecast: 0.5 },
        });
        expectOk(forecast);
        if (forecast.success) {
          getTestTracker().trackId("forecasts", forecast.data);
        }

        expectOk(
          await updateProp({ id: propId, prop: { text: `${text} (edited)` } }),
        );
        expectOk(await resolveProp({ propId, resolution: true }));
        expectOk(await unresolveProp({ propId }));
        expectOk(await resolveProp({ propId, resolution: false }));

        const resolution = await db
          .selectFrom("resolutions")
          .select("id")
          .where("prop_id", "=", propId)
          .executeTakeFirstOrThrow();
        expectOk(await deleteResolution({ id: resolution.id }));

        await db
          .deleteFrom("forecasts")
          .where("prop_id", "=", propId)
          .execute();
        expectOk(await deleteProp({ id: propId }));
      },
    );

    ifRunningContainerTestsIt(
      "creates a choice prop, renames its options and resolves it",
      async () => {
        const owner = await factory.createUser();
        actAs(owner);
        const text = `Personal choice ${Math.random()}`;

        expectOk(
          await createProp({
            prop: {
              text,
              notes: null,
              category_id: null,
              competition_id: null,
              user_id: owner.id,
              kind: "one_of",
            },
            options: ["Knicks", "Spurs"],
          }),
        );
        const propId = await propIdByText(text);
        const options = await db
          .selectFrom("prop_options")
          .select(["id", "text"])
          .where("prop_id", "=", propId)
          .orderBy("position")
          .execute();

        expectOk(
          await updatePropOptions({
            propId,
            options: options.map((o) => ({ id: o.id, text: `${o.text}!` })),
          }),
        );
        expectOk(
          await resolveProp({
            propId,
            outcomes: [
              { optionId: options[0].id, outcome: true },
              { optionId: options[1].id, outcome: false },
            ],
          }),
        );
      },
    );
  });

  describe("an admin of a private competition who is not a site admin", () => {
    async function setup() {
      const compAdmin = await factory.createUser();
      const comp = await openCompetition(true);
      await addMember(comp.id, compAdmin.id, "admin");
      actAs(compAdmin);
      return { compAdmin, comp };
    }

    ifRunningContainerTestsIt(
      "creates, edits, resolves, unresolves and deletes a prop",
      async () => {
        const { comp } = await setup();
        const text = `Competition binary ${Math.random()}`;

        expectOk(
          await createProp({
            prop: {
              text,
              notes: null,
              category_id: null,
              competition_id: comp.id,
              user_id: null,
              ...privateDeadlines(),
            },
          }),
        );
        const propId = await propIdByText(text);

        expectOk(
          await updateProp({ id: propId, prop: { text: `${text} (edited)` } }),
        );
        expectOk(await resolveProp({ propId, resolution: true }));
        expectOk(await unresolveProp({ propId }));
        expectOk(await deleteProp({ id: propId }));
      },
    );

    ifRunningContainerTestsIt(
      "creates a choice prop, renames its options and resolves it",
      async () => {
        const { comp } = await setup();
        const text = `Competition choice ${Math.random()}`;

        expectOk(
          await createProp({
            prop: {
              text,
              notes: null,
              category_id: null,
              competition_id: comp.id,
              user_id: null,
              kind: "any_of",
              ...privateDeadlines(),
            },
            options: ["Red", "Blue"],
          }),
        );
        const propId = await propIdByText(text);
        const options = await db
          .selectFrom("prop_options")
          .select(["id", "text"])
          .where("prop_id", "=", propId)
          .orderBy("position")
          .execute();

        expectOk(
          await updatePropOptions({
            propId,
            options: options.map((o) => ({ id: o.id, text: `${o.text}!` })),
          }),
        );
        expectOk(
          await resolveProp({
            propId,
            outcomes: [
              { optionId: options[0].id, outcome: true },
              { optionId: options[1].id, outcome: true },
            ],
          }),
        );
      },
    );

    ifRunningContainerTestsIt("edits the competition", async () => {
      const { comp } = await setup();
      expectOk(
        await updateCompetition({
          id: comp.id,
          competition: { name: `${comp.name} (renamed)` },
        }),
      );
    });

    ifRunningContainerTestsIt(
      "adds a member, changes their role and removes them",
      async () => {
        const { comp } = await setup();
        const newcomer = await factory.createUser();

        const added = await addCompetitionMemberById({
          competitionId: comp.id,
          userId: newcomer.id,
          role: "forecaster",
        });
        expectOk(added);
        if (added.success) {
          getTestTracker().trackId("competition_members", added.data.id);
        }

        expectOk(
          await updateMemberRole({
            competitionId: comp.id,
            userId: newcomer.id,
            newRole: "admin",
          }),
        );
        expectOk(
          await removeCompetitionMember({
            competitionId: comp.id,
            userId: newcomer.id,
          }),
        );
      },
    );
  });

  describe("a site admin", () => {
    ifRunningContainerTestsIt(
      "creates a private and a public competition, and deletes them",
      async () => {
        const admin = await factory.createAdminUser();
        actAs(admin);
        const tag = Math.random().toString(36).slice(2);

        expectOk(
          await createCompetition({
            competition: {
              name: `Private ${tag}`,
              is_private: true,
              forecasts_open_date: null,
              forecasts_close_date: null,
              end_date: null,
            },
          }),
        );
        expectOk(
          await createCompetition({
            competition: {
              name: `Public ${tag}`,
              is_private: false,
              forecasts_open_date: new Date(Date.now() + 1 * DAY),
              forecasts_close_date: new Date(Date.now() + 7 * DAY),
              end_date: new Date(Date.now() + 30 * DAY),
            },
          }),
        );

        const created = await db
          .selectFrom("competitions")
          .select("id")
          .where("name", "in", [`Private ${tag}`, `Public ${tag}`])
          .execute();
        expect(created).toHaveLength(2);
        for (const { id } of created) {
          await db
            .deleteFrom("competition_members")
            .where("competition_id", "=", id)
            .execute();
          expectOk(await deleteCompetition({ id }));
        }
      },
    );

    ifRunningContainerTestsIt(
      // Props in a private competition are its own admins' business, not the
      // site admin's (lib/prop-write-access.ts), so this covers membership and
      // settings only.
      "manages a private competition they are not a member of",
      async () => {
        const admin = await factory.createAdminUser();
        const comp = await openCompetition(true);
        const member = await factory.createUser();
        actAs(admin);

        const added = await addCompetitionMemberById({
          competitionId: comp.id,
          userId: member.id,
          role: "forecaster",
        });
        expectOk(added);
        if (added.success) {
          getTestTracker().trackId("competition_members", added.data.id);
        }
        expectOk(
          await updateCompetition({
            id: comp.id,
            competition: { name: `${comp.name} (renamed)` },
          }),
        );
      },
    );

    ifRunningContainerTestsIt(
      "accepts a suggestion and deactivates and reactivates a user",
      async () => {
        const admin = await factory.createAdminUser();
        const reader = await factory.createUser();
        const suggestion = await db
          .insertInto("suggested_props")
          .values({ suggester_user_id: reader.id, prop: "A claim." })
          .returning("id")
          .executeTakeFirstOrThrow();
        getTestTracker().trackId("suggested_props", suggestion.id);
        actAs(admin);

        expectOk(
          await setSuggestedPropStatus({
            id: suggestion.id,
            status: "accepted",
          }),
        );
        expectOk(await setUserActive({ userId: reader.id, active: false }));
        expectOk(await setUserActive({ userId: reader.id, active: true }));
      },
    );
  });

  describe("any signed-in reader", () => {
    ifRunningContainerTestsIt("suggests a prop", async () => {
      const reader = await factory.createUser();
      actAs(reader);
      expectOk(
        await createSuggestedProp({
          prop: "A claim worth making.",
          notes: null,
        }),
      );
    });

    ifRunningContainerTestsIt(
      "turns a notification off and on again",
      async () => {
        const reader = await factory.createUser();
        actAs(reader);
        expectOk(
          await setNotificationPreference({
            type: "admin.announcement",
            enabled: false,
          }),
        );
        expectOk(
          await setNotificationPreference({
            type: "admin.announcement",
            enabled: true,
          }),
        );
      },
    );

    ifRunningContainerTestsIt("edits their own name", async () => {
      const reader = await factory.createUser();
      actAs(reader);
      expectOk(
        await updateUser({ id: reader.id, user: { name: "A new name" } }),
      );
    });
  });
});
