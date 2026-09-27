import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import { getTestDb } from "../../../tests/helpers/testDatabase";
import { TestDataFactory } from "../../../tests/helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../../../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));

import { signUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

const TYPE = "competition.prop_added";

/**
 * The whole path against a real PostgreSQL: a signed link, the POST, and the
 * row it writes under RLS as that reader. The unit tests mock the write, so
 * this is the only thing that proves the reader's own write policy lets their
 * unsubscribe through.
 */
describe("POST /api/unsubscribe against the database", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;
  let POST: typeof import("./route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", "container-secret");
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
      ({ POST } = await import("./route"));
    }
  });

  function oneClick(token: string) {
    return new Request(
      `https://haruspex.test/api/unsubscribe?t=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
    );
  }

  async function storedChoice(userId: number) {
    const row = await db
      .selectFrom("notification_preferences")
      .select("enabled")
      .where("user_id", "=", userId)
      .where("notification_type", "=", TYPE)
      .executeTakeFirst();
    return row?.enabled;
  }

  ifRunningContainerTestsIt("writes the reader's opt-out", async () => {
    const reader = await factory.createUser();

    const response = await POST(oneClick(signUnsubscribeToken(reader.id, TYPE)));

    expect(response.status).toBe(200);
    expect(await storedChoice(reader.id)).toBe(false);
  });

  ifRunningContainerTestsIt(
    "turns it back on without minting a second row",
    async () => {
      const reader = await factory.createUser();
      const token = signUnsubscribeToken(reader.id, TYPE);

      await POST(oneClick(token));
      await POST(
        new Request(
          `https://haruspex.test/api/unsubscribe?t=${encodeURIComponent(token)}&enabled=true`,
          { method: "POST" },
        ),
      );

      expect(await storedChoice(reader.id)).toBe(true);
      const rows = await db
        .selectFrom("notification_preferences")
        .select("user_id")
        .where("user_id", "=", reader.id)
        .execute();
      // The upsert is keyed on (user_id, notification_type), so a change of
      // mind edits the choice rather than stacking another one.
      expect(rows).toHaveLength(1);
    },
  );

  ifRunningContainerTestsIt(
    "writes nothing for a token it cannot verify",
    async () => {
      const reader = await factory.createUser();
      const forged = `${reader.id}:${TYPE}:${"0".repeat(64)}`;

      const response = await POST(oneClick(forged));

      expect(response.status).toBe(400);
      expect(await storedChoice(reader.id)).toBeUndefined();
    },
  );

  ifRunningContainerTestsIt(
    "is harmless when pressed twice, as a mail client may",
    async () => {
      const reader = await factory.createUser();
      const token = signUnsubscribeToken(reader.id, TYPE);

      const first = await POST(oneClick(token));
      const second = await POST(oneClick(token));

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await storedChoice(reader.id)).toBe(false);
    },
  );
});
