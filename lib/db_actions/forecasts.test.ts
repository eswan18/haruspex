import { vi, describe, expect, beforeEach } from "vitest";
import { getTestDb } from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import { getTestTracker } from "../../tests/helpers/testIdTracker";
import {
  shouldRunContainerTests,
  ifRunningContainerTestsIt,
} from "../../tests/helpers/testUtils";

let getRecentlyResolvedForecasts: typeof import("./forecasts").getRecentlyResolvedForecasts;
let getPropsWithUserForecasts: typeof import("./forecasts").getPropsWithUserForecasts;
let saveChoiceForecast: typeof import("./forecasts").saveChoiceForecast;
let createForecast: typeof import("./forecasts").createForecast;
let getUnforecastedProps: typeof import("./forecasts").getUnforecastedProps;

// `forecasts.ts` transitively imports the server-only `attachOptions` helper.
vi.mock("server-only", () => ({}));

// Mock getUserFromCookies
vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getUserFromCookies } from "@/lib/get-user";

describe("getRecentlyResolvedForecasts", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      const forecastsModule = await import("./forecasts");
      getRecentlyResolvedForecasts =
        forecastsModule.getRecentlyResolvedForecasts;
    } else {
      vi.clearAllMocks();
    }
  });

  ifRunningContainerTestsIt(
    "should return only resolved forecasts for the specified user",
    async () => {
      const user = await factory.createUser({ name: "Test User" });
      vi.mocked(getUserFromCookies).mockResolvedValue(user);

      const competition = await factory.createCompetition();

      // Create two props - one resolved, one not
      const resolvedProp = await factory.createCompetitionProp(competition.id, {
        text: "Resolved prop",
      });
      const unresolvedProp = await factory.createCompetitionProp(
        competition.id,
        {
          text: "Unresolved prop",
        },
      );

      // Create forecasts for both
      await factory.createForecast(user.id, resolvedProp.id, { forecast: 0.7 });
      await factory.createForecast(user.id, unresolvedProp.id, {
        forecast: 0.5,
      });

      // Only resolve one prop
      await factory.createResolution(resolvedProp.id, {
        resolution: true,
        notes: "It happened",
        user_id: user.id,
      });

      const result = await getRecentlyResolvedForecasts({ userId: user.id });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].prop_text).toBe("Resolved prop");
        expect(result.data[0].resolution).toBe(true);
      }
    },
  );

  ifRunningContainerTestsIt(
    "should return resolved choice props with their options, newest first",
    async () => {
      const user = await factory.createUser({ name: "Choice User" });
      vi.mocked(getUserFromCookies).mockResolvedValue(user);

      const competition = await factory.createCompetition();

      const binaryProp = await factory.createCompetitionProp(competition.id, {
        text: "Binary prop",
      });
      await factory.createForecast(user.id, binaryProp.id, { forecast: 0.6 });
      await factory.createResolution(binaryProp.id, {
        resolution: false,
        user_id: user.id,
      });

      const { prop: choiceProp, options } = await factory.createChoiceProp(
        "one_of",
        ["North", "South", "East", "West"],
        { competition_id: competition.id, text: "Choice prop" },
      );
      await factory.createChoiceForecast(
        user.id,
        choiceProp.id,
        options.map((o) => ({ optionId: o.id, probability: 0.25 })),
      );
      const choiceResolution = await factory.createChoiceResolution(
        choiceProp.id,
        options.map((o, i) => ({ optionId: o.id, outcome: i === 0 })),
        { user_id: user.id },
      );
      // Touch the choice resolution so its updated_at is strictly the latest
      // (the set_updated_at trigger stamps now() on update).
      await testDb
        .updateTable("resolutions")
        .set({ notes: "resolved" })
        .where("id", "=", choiceResolution.id)
        .execute();

      const result = await getRecentlyResolvedForecasts({ userId: user.id });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toHaveLength(2);
      // Ordered by resolution time, newest first.
      const [choice, binary] = result.data;

      expect(choice.prop_id).toBe(choiceProp.id);
      expect(choice.prop_kind).toBe("one_of");
      // A resolved choice prop has no resolution boolean; only resolution_id.
      expect(choice.resolution).toBeNull();
      expect(choice.resolution_id).not.toBeNull();
      expect(Number(choice.score)).toBeCloseTo(0.375, 6);
      expect(choice.options.map((o) => o.text)).toEqual([
        "North",
        "South",
        "East",
        "West",
      ]);
      expect(choice.options.map((o) => o.outcome)).toEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(choice.options.map((o) => o.user_forecast)).toEqual([
        0.25, 0.25, 0.25, 0.25,
      ]);

      expect(binary.prop_id).toBe(binaryProp.id);
      expect(binary.prop_kind).toBe("binary");
      expect(binary.resolution).toBe(false);
      expect(binary.options).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "should respect the limit parameter",
    async () => {
      const user = await factory.createUser({ name: "Test User" });
      vi.mocked(getUserFromCookies).mockResolvedValue(user);

      const competition = await factory.createCompetition();

      // Create 5 resolved props
      for (let i = 0; i < 5; i++) {
        const prop = await factory.createCompetitionProp(competition.id, {
          text: `Prop ${i}`,
        });
        await factory.createForecast(user.id, prop.id, { forecast: 0.5 });
        await factory.createResolution(prop.id, {
          resolution: true,
          notes: `Resolution ${i}`,
          user_id: user.id,
        });
      }

      const result = await getRecentlyResolvedForecasts({
        userId: user.id,
        limit: 2,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
      }
    },
  );

  ifRunningContainerTestsIt("leaves out voided props", async () => {
    const user = await factory.createUser({ name: "Void User" });
    vi.mocked(getUserFromCookies).mockResolvedValue(user);
    const competition = await factory.createCompetition();
    const answered = await factory.createCompetitionProp(competition.id, {
      text: "Answered prop",
    });
    const voided = await factory.createCompetitionProp(competition.id, {
      text: "Voided prop",
    });
    await factory.createForecast(user.id, answered.id, { forecast: 0.7 });
    await factory.createForecast(user.id, voided.id, { forecast: 0.2 });
    await factory.createResolution(answered.id, { resolution: true });
    // Settled after the answered one, so it would sort first if it were kept.
    await factory.createResolution(voided.id, {
      resolution: null,
      voided: true,
    });

    const result = await getRecentlyResolvedForecasts({ userId: user.id });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((f) => f.prop_text)).toEqual(["Answered prop"]);
    }
  });
});

describe("getPropsWithUserForecasts", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      const forecastsModule = await import("./forecasts");
      getPropsWithUserForecasts = forecastsModule.getPropsWithUserForecasts;
    } else {
      vi.clearAllMocks();
    }
  });

  ifRunningContainerTestsIt(
    "returns no options for a binary prop and option summaries for a choice prop",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);

      const competition = await factory.createCompetition();
      const binaryProp = await factory.createCompetitionProp(competition.id, {
        text: "Binary prop",
      });
      await factory.createForecast(user.id, binaryProp.id, { forecast: 0.7 });

      const { prop: choiceProp, options } = await factory.createChoiceProp(
        "one_of",
        ["Red", "Green", "Blue"],
        { competition_id: competition.id, text: "Choice prop" },
      );
      await factory.createChoiceForecast(user.id, choiceProp.id, [
        { optionId: options[0].id, probability: 0.6 },
        { optionId: options[1].id, probability: 0.3 },
        { optionId: options[2].id, probability: 0.1 },
      ]);

      const result = await getPropsWithUserForecasts({
        userId: user.id,
        competitionId: competition.id,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      const binary = result.data.find((p) => p.prop_id === binaryProp.id)!;
      expect(binary.prop_kind).toBe("binary");
      expect(binary.options).toEqual([]);
      // `forecasts.forecast` is a numeric column, which pg returns as a string.
      expect(Number(binary.user_forecast)).toBe(0.7);
      expect(binary.user_forecast_id).not.toBeNull();

      const choice = result.data.find((p) => p.prop_id === choiceProp.id)!;
      expect(choice.prop_kind).toBe("one_of");
      expect(choice.user_forecast).toBeNull();
      expect(choice.user_forecast_id).not.toBeNull();
      expect(choice.options.map((o) => o.text)).toEqual([
        "Red",
        "Green",
        "Blue",
      ]);
      expect(choice.options.map((o) => o.user_forecast)).toEqual([
        0.6, 0.3, 0.1,
      ]);
      expect(choice.options.map((o) => Number(o.community_average))).toEqual([
        0.6, 0.3, 0.1,
      ]);
      expect(choice.options.every((o) => o.outcome === null)).toBe(true);
    },
  );
});

describe("saveChoiceForecast and the binary guards", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      const forecastsModule = await import("./forecasts");
      saveChoiceForecast = forecastsModule.saveChoiceForecast;
      createForecast = forecastsModule.createForecast;
    } else {
      vi.clearAllMocks();
    }
  });

  /** The child rows of a forecast, ordered by option id. */
  async function storedOptions(forecastId: number) {
    return testDb
      .selectFrom("forecast_options")
      .select(["option_id", "probability"])
      .where("forecast_id", "=", forecastId)
      .orderBy("option_id")
      .execute();
  }

  async function storedHeader(forecastId: number) {
    return testDb
      .selectFrom("forecasts")
      .selectAll()
      .where("id", "=", forecastId)
      .executeTakeFirstOrThrow();
  }

  /** Every forecast header row on a prop, however many there are. */
  async function headersFor(propId: number) {
    return testDb
      .selectFrom("forecasts")
      .selectAll()
      .where("prop_id", "=", propId)
      .execute();
  }

  /** A competition open until tomorrow. */
  async function openCompetition() {
    return factory.createCompetition({
      forecasts_close_date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }

  ifRunningContainerTestsIt(
    "writes one row per option, then replaces them on a re-save",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await openCompetition();
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["Red", "Green", "Blue"],
        { competition_id: competition.id },
      );

      const first = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.6 },
          { optionId: options[1].id, probability: 0.3 },
          { optionId: options[2].id, probability: 0.1 },
        ],
      });

      expect(first.success).toBe(true);
      if (!first.success) return;
      const forecastId = first.data;
      getTestTracker().trackId("forecasts", forecastId);

      // The header belongs to the caller and carries no probability of its own
      // — the enforce_forecast_kind trigger insists on that for choice props.
      const header = await storedHeader(forecastId);
      expect(header.user_id).toBe(user.id);
      expect(header.forecast).toBeNull();
      expect(await storedOptions(forecastId)).toEqual([
        { option_id: options[0].id, probability: 0.6 },
        { option_id: options[1].id, probability: 0.3 },
        { option_id: options[2].id, probability: 0.1 },
      ]);

      // `now()` is the transaction clock, so leave it room to advance before
      // the re-save; otherwise the updated_at assertion proves nothing.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.2 },
          { optionId: options[1].id, probability: 0.5 },
          { optionId: options[2].id, probability: 0.3 },
        ],
      });

      // Same header row, same number of children, new probabilities.
      expect(second).toEqual({ success: true, data: forecastId });
      expect(await storedOptions(forecastId)).toEqual([
        { option_id: options[0].id, probability: 0.2 },
        { option_id: options[1].id, probability: 0.5 },
        { option_id: options[2].id, probability: 0.3 },
      ]);
      expect(await headersFor(prop.id)).toHaveLength(1);
      const rewritten = await storedHeader(forecastId);
      expect(rewritten.forecast).toBeNull();
      expect(rewritten.updated_at.getTime()).toBeGreaterThan(
        header.updated_at.getTime(),
      );
    },
  );

  ifRunningContainerTestsIt(
    "does not hold any_of probabilities to a sum of 1",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await openCompetition();
      const { prop, options } = await factory.createChoiceProp(
        "any_of",
        ["Rain", "Snow"],
        { competition_id: competition.id },
      );

      const result = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.9 },
          { optionId: options[1].id, probability: 0.8 },
        ],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      getTestTracker().trackId("forecasts", result.data);
      expect(await storedOptions(result.data)).toEqual([
        { option_id: options[0].id, probability: 0.9 },
        { option_id: options[1].id, probability: 0.8 },
      ]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects a forecast that misses one of the prop's options, writing nothing",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await openCompetition();
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["Red", "Green", "Blue"],
        { competition_id: competition.id },
      );

      const result = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.5 },
          { optionId: options[1].id, probability: 0.5 },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(
        `Missing probability for option ${options[2].id}`,
      );
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(await headersFor(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects a save once the competition's close date has passed",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await factory.createCompetition({
        forecasts_close_date: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const { prop, options } = await factory.createChoiceProp(
        "one_of",
        ["Red", "Green"],
        { competition_id: competition.id },
      );

      const result = await saveChoiceForecast({
        propId: prop.id,
        probabilities: [
          { optionId: options[0].id, probability: 0.5 },
          { optionId: options[1].id, probability: 0.5 },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("Cannot save forecasts past the due date");
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(await headersFor(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "createForecast refuses a choice prop before the trigger sees it",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await openCompetition();
      const { prop } = await factory.createChoiceProp(
        "one_of",
        ["Red", "Green"],
        { competition_id: competition.id },
      );

      const result = await createForecast({
        forecast: { prop_id: prop.id, user_id: user.id, forecast: 0.5 },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("Use the per-option form for this proposition");
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(await headersFor(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "createForecast still accepts a binary prop",
    async () => {
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(user);
      const competition = await openCompetition();
      const prop = await factory.createCompetitionProp(competition.id);

      const result = await createForecast({
        forecast: { prop_id: prop.id, user_id: user.id, forecast: 0.75 },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      getTestTracker().trackId("forecasts", result.data);
      const header = await storedHeader(result.data);
      // `forecasts.forecast` is numeric, which pg returns as a string.
      expect(Number(header.forecast)).toBe(0.75);
    },
  );
});

describe("getUnforecastedProps", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();
      getUnforecastedProps = (await import("./forecasts")).getUnforecastedProps;
    } else {
      vi.clearAllMocks();
    }
  });

  ifRunningContainerTestsIt(
    "does not count a voided prop as owed",
    async () => {
      const admin = await factory.createAdminUser();
      const user = await factory.createUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const competition = await factory.createCompetition();
      const owed = await factory.createCompetitionProp(competition.id);
      const voided = await factory.createCompetitionProp(competition.id);
      await factory.createResolution(voided.id, {
        resolution: null,
        voided: true,
      });

      const result = await getUnforecastedProps({
        competitionId: competition.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.map((p) => p.prop_id)).toEqual([owed.id]);
      }
    },
  );
});
