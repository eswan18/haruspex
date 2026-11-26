import { vi, describe, expect, beforeEach } from "vitest";
import { getTestDb } from "../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../tests/helpers/testFactories";
import { getTestTracker } from "../../tests/helpers/testIdTracker";
import {
  shouldRunContainerTests,
  ifRunningContainerTestsIt,
} from "../../tests/helpers/testUtils";

let createProp: typeof import("./props").createProp;
let resolveProp: typeof import("./props").resolveProp;
let unresolveProp: typeof import("./props").unresolveProp;

// `props.ts` transitively imports the server-only `attachOptions` helper.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getUserFromCookies } from "@/lib/get-user";

/**
 * `createProp` against a real PostgreSQL: the option insert, its position and
 * trimming, and the fact that a rejected prop leaves no row behind.
 */
describe("createProp against the database", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      const propsModule = await import("./props");
      createProp = propsModule.createProp;
    } else {
      vi.clearAllMocks();
    }
  });

  /** Every prop carrying this text, so cleanup and absence checks are exact. */
  async function propsWithText(text: string) {
    const rows = await testDb
      .selectFrom("props")
      .select(["id", "kind", "text"])
      .where("text", "=", text)
      .execute();
    // Props created through the action are not tracked by the factory.
    for (const row of rows) {
      getTestTracker().trackId("props", row.id);
    }
    return rows;
  }

  ifRunningContainerTestsIt(
    "stores a choice prop with its trimmed options in position order",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);

      const text = "Which team wins the championship?";
      const result = await createProp({
        prop: {
          text,
          kind: "one_of",
          category_id: 1,
          user_id: null,
          competition_id: null,
        },
        options: ["  Knicks  ", "Spurs", "\tNets\n"],
      });

      expect(result.success).toBe(true);

      const props = await propsWithText(text);
      expect(props).toHaveLength(1);
      expect(props[0].kind).toBe("one_of");

      const options = await testDb
        .selectFrom("prop_options")
        .select(["text", "position"])
        .where("prop_id", "=", props[0].id)
        .orderBy("position")
        .execute();
      expect(options).toEqual([
        { text: "Knicks", position: 0 },
        { text: "Spurs", position: 1 },
        { text: "Nets", position: 2 },
      ]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects options on a yes/no prop and inserts nothing",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);

      const text = "Will it rain in Chicago tomorrow?";
      const result = await createProp({
        prop: { text, category_id: 1, user_id: null, competition_id: null },
        options: ["A", "B"],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
      expect(await propsWithText(text)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects a choice prop with no options and inserts nothing",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);

      const text = "Which candidate wins the primary?";
      const result = await createProp({
        prop: {
          text,
          kind: "one_of",
          category_id: 1,
          user_id: null,
          competition_id: null,
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
      expect(await propsWithText(text)).toEqual([]);
    },
  );
});

/**
 * `resolveProp` against a real PostgreSQL: the header/children split for
 * choice props, the delete-and-reinsert on an overwrite, and the fact that a
 * rejected resolution writes nothing at all.
 */
describe("resolveProp against the database", () => {
  let testDb: any;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      testDb = await getTestDb();
      factory = new TestDataFactory(testDb);
      vi.clearAllMocks();

      const propsModule = await import("./props");
      resolveProp = propsModule.resolveProp;
      unresolveProp = propsModule.unresolveProp;
    } else {
      vi.clearAllMocks();
    }
  });

  /** The prop's resolution header, tracked for cleanup if it exists. */
  async function storedHeader(propId: number) {
    const row = await testDb
      .selectFrom("resolutions")
      .select(["id", "resolution", "voided", "notes", "user_id"])
      .where("prop_id", "=", propId)
      .executeTakeFirst();
    // Resolutions written by the action are not tracked by the factory.
    if (row) getTestTracker().trackId("resolutions", row.id);
    return row;
  }

  /** Every outcome row for the prop, whatever resolution they hang off. */
  async function storedOutcomes(propId: number) {
    return testDb
      .selectFrom("resolution_options")
      .select(["resolution_id", "option_id", "outcome"])
      .where("prop_id", "=", propId)
      .orderBy("option_id")
      .execute();
  }

  /** Every resolution header for the prop, to prove there is only ever one. */
  async function storedHeaderCount(propId: number) {
    const rows = await testDb
      .selectFrom("resolutions")
      .select("id")
      .where("prop_id", "=", propId)
      .execute();
    return rows.length;
  }

  ifRunningContainerTestsIt(
    "writes a resolution header and no outcome rows for a binary prop",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const prop = await factory.createProp();

      const result = await resolveProp({
        propId: prop.id,
        resolution: true,
        notes: "x",
      });

      expect(result.success).toBe(true);
      expect(await storedHeaderCount(prop.id)).toBe(1);

      const header = await storedHeader(prop.id);
      expect(header.resolution).toBe(true);
      expect(header.notes).toBe("x");
      // The author comes from the session, not the caller: the dialog has
      // never sent one, and a client-supplied author could name anyone.
      expect(header.user_id).toBe(admin.id);
      // A binary resolution lives entirely in the header row.
      expect(await storedOutcomes(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "overwrites a binary resolution in place rather than adding a second one",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const prop = await factory.createProp();

      const first = await resolveProp({
        propId: prop.id,
        resolution: true,
        notes: "x",
      });
      expect(first.success).toBe(true);
      const before = await storedHeader(prop.id);

      const result = await resolveProp({
        propId: prop.id,
        resolution: false,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(await storedHeaderCount(prop.id)).toBe(1);

      const after = await storedHeader(prop.id);
      // The same row, updated: an overwrite must not orphan the old header.
      expect(after.id).toBe(before.id);
      expect(after.resolution).toBe(false);
      expect(await storedOutcomes(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "writes a null header and one outcome row per option for a one_of prop",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "Knicks",
        "Spurs",
        "Nets",
      ]);

      const result = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: false },
          { optionId: options[1].id, outcome: true },
          { optionId: options[2].id, outcome: false },
        ],
        notes: "Spurs took it",
      });

      expect(result.success).toBe(true);

      // The header carries no resolution of its own — the
      // enforce_resolution_kind trigger insists on that for choice props.
      const header = await storedHeader(prop.id);
      expect(header.resolution).toBeNull();
      expect(header.notes).toBe("Spurs took it");
      expect(header.user_id).toBe(admin.id);

      expect(await storedOutcomes(prop.id)).toEqual([
        {
          resolution_id: header.id,
          option_id: options[0].id,
          outcome: false,
        },
        { resolution_id: header.id, option_id: options[1].id, outcome: true },
        {
          resolution_id: header.id,
          option_id: options[2].id,
          outcome: false,
        },
      ]);
    },
  );

  ifRunningContainerTestsIt(
    "replaces the outcome rows when overwriting with a different winner",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "Knicks",
        "Spurs",
      ]);
      await factory.createChoiceResolution(prop.id, [
        { optionId: options[0].id, outcome: true },
        { optionId: options[1].id, outcome: false },
      ]);

      const result = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: false },
          { optionId: options[1].id, outcome: true },
        ],
        notes: "Corrected",
        overwrite: true,
      });

      expect(result.success).toBe(true);

      // One header, one row per option: the old children were deleted rather
      // than left alongside the new ones.
      const headers = await testDb
        .selectFrom("resolutions")
        .select("id")
        .where("prop_id", "=", prop.id)
        .execute();
      expect(headers).toHaveLength(1);

      const header = await storedHeader(prop.id);
      expect(header.resolution).toBeNull();
      expect(header.notes).toBe("Corrected");
      expect(await storedOutcomes(prop.id)).toEqual([
        {
          resolution_id: header.id,
          option_id: options[0].id,
          outcome: false,
        },
        { resolution_id: header.id, option_id: options[1].id, outcome: true },
      ]);
    },
  );

  ifRunningContainerTestsIt(
    "accepts an any_of prop resolved with every option false",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("any_of", [
        "Rain",
        "Snow",
      ]);

      const result = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: false },
          { optionId: options[1].id, outcome: false },
        ],
      });

      expect(result.success).toBe(true);
      const header = await storedHeader(prop.id);
      expect(header.resolution).toBeNull();
      expect(await storedOutcomes(prop.id)).toEqual([
        {
          resolution_id: header.id,
          option_id: options[0].id,
          outcome: false,
        },
        {
          resolution_id: header.id,
          option_id: options[1].id,
          outcome: false,
        },
      ]);
    },
  );

  ifRunningContainerTestsIt(
    "rejects a one_of prop with two winners and writes nothing",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "Knicks",
        "Spurs",
      ]);

      const result = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: true },
          { optionId: options[1].id, outcome: true },
        ],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
        expect(result.error).toContain("exactly one");
      }
      expect(await storedHeader(prop.id)).toBeUndefined();
      expect(await storedOutcomes(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "unresolveProp removes a choice resolution and its outcome rows",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("any_of", [
        "Rain",
        "Snow",
      ]);
      await factory.createChoiceResolution(prop.id, [
        { optionId: options[0].id, outcome: true },
        { optionId: options[1].id, outcome: false },
      ]);
      expect(await storedOutcomes(prop.id)).toHaveLength(2);

      const result = await unresolveProp({ propId: prop.id });

      expect(result.success).toBe(true);
      expect(await storedHeader(prop.id)).toBeUndefined();
      // The composite foreign key cascades the children away with the header.
      expect(await storedOutcomes(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt("voids a binary prop", async () => {
    const admin = await factory.createAdminUser();
    vi.mocked(getUserFromCookies).mockResolvedValue(admin);
    const prop = await factory.createProp();

    const result = await resolveProp({
      propId: prop.id,
      voided: true,
      notes: "OpenAI stayed private",
    });

    expect(result.success).toBe(true);
    const header = await storedHeader(prop.id);
    expect(header).toMatchObject({
      resolution: null,
      voided: true,
      notes: "OpenAI stayed private",
      user_id: admin.id,
    });
  });

  ifRunningContainerTestsIt(
    "voids a resolved one_of prop and clears its outcomes",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("one_of", [
        "Knicks",
        "Spurs",
      ]);
      const first = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: true },
          { optionId: options[1].id, outcome: false },
        ],
      });
      expect(first.success).toBe(true);
      const before = await storedHeader(prop.id);

      const result = await resolveProp({
        propId: prop.id,
        voided: true,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      const after = await storedHeader(prop.id);
      expect(after.id).toBe(before.id);
      expect(after.voided).toBe(true);
      expect(after.resolution).toBeNull();
      expect(await storedOutcomes(prop.id)).toEqual([]);
    },
  );

  ifRunningContainerTestsIt(
    "un-voids a binary prop by overwriting with an answer",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const prop = await factory.createProp();
      expect(
        (await resolveProp({ propId: prop.id, voided: true })).success,
      ).toBe(true);

      const result = await resolveProp({
        propId: prop.id,
        resolution: false,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(await storedHeader(prop.id)).toMatchObject({
        resolution: false,
        voided: false,
      });
    },
  );

  ifRunningContainerTestsIt(
    "un-voids an any_of prop by overwriting with outcomes",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const { prop, options } = await factory.createChoiceProp("any_of", [
        "Rain",
        "Snow",
      ]);
      expect(
        (await resolveProp({ propId: prop.id, voided: true })).success,
      ).toBe(true);

      const result = await resolveProp({
        propId: prop.id,
        outcomes: [
          { optionId: options[0].id, outcome: true },
          { optionId: options[1].id, outcome: false },
        ],
        overwrite: true,
      });

      expect(result.success).toBe(true);
      const header = await storedHeader(prop.id);
      expect(header.voided).toBe(false);
      expect(await storedOutcomes(prop.id)).toHaveLength(2);
    },
  );

  ifRunningContainerTestsIt(
    "refuses voided together with a resolution or outcomes",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const binary = await factory.createProp();
      const { prop: choice, options } = await factory.createChoiceProp(
        "one_of",
        ["A", "B"],
      );

      const withValue = await resolveProp({
        propId: binary.id,
        voided: true,
        resolution: true,
      });
      const withOutcomes = await resolveProp({
        propId: choice.id,
        voided: true,
        outcomes: [
          { optionId: options[0].id, outcome: true },
          { optionId: options[1].id, outcome: false },
        ],
      });

      for (const result of [withValue, withOutcomes]) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe("VALIDATION_ERROR");
      }
      expect(await storedHeader(binary.id)).toBeUndefined();
      expect(await storedHeader(choice.id)).toBeUndefined();
    },
  );

  ifRunningContainerTestsIt(
    "refuses to void an already-resolved prop without overwrite",
    async () => {
      const admin = await factory.createAdminUser();
      vi.mocked(getUserFromCookies).mockResolvedValue(admin);
      const prop = await factory.createProp();
      expect(
        (await resolveProp({ propId: prop.id, resolution: true })).success,
      ).toBe(true);

      const result = await resolveProp({ propId: prop.id, voided: true });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("already has a resolution");
      }
      expect(await storedHeader(prop.id)).toMatchObject({
        resolution: true,
        voided: false,
      });
    },
  );
});
