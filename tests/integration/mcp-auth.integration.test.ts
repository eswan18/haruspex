import { vi, describe, expect, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import type { Database } from "@/types/db_types";
import { getTestDb } from "../helpers/testDatabase";
import { TestDataFactory } from "../helpers/testFactories";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../helpers/testUtils";

/**
 * The MCP gate's default user lookup, with the app's `db` connected as
 * `app_user` as it is in production.
 */
vi.mock("@/lib/database", async () => {
  if (process.env.TEST_USE_CONTAINERS !== "true") return { db: null };
  const { getRlsTestDb } = await import("../helpers/testDatabase");
  return { db: await getRlsTestDb() };
});

import { findUserBySub } from "@/lib/mcp/auth";

describe("findUserBySub", () => {
  let db: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      factory = new TestDataFactory(db);
    }
  });

  ifRunningContainerTestsIt("finds a user by idp_user_id", async () => {
    const user = await factory.createUser();
    const found = await findUserBySub(user.idp_user_id!);
    expect(found?.id).toBe(user.id);
  });

  ifRunningContainerTestsIt(
    "returns undefined for an unknown subject",
    async () => {
      await factory.createUser();
      expect(await findUserBySub(crypto.randomUUID())).toBeUndefined();
    },
  );
});
