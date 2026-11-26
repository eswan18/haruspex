/**
 * The rows every smoke check starts from. Written through the owner
 * connection, so row-level security does not get in the way of seeding.
 */
import type { Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import {
  TestDataFactory,
  type TestCompetition,
  type TestProp,
  type TestUser,
} from "../../tests/helpers/testFactories";

export type { TestCompetition, TestProp, TestUser };

export interface Seed {
  user: TestUser;
  /** A site admin (`users.is_admin`). */
  admin: TestUser;
  /**
   * Public and open for forecasting. It has no members: the schema refuses
   * members on a public competition (trigger check_competition_is_private), and
   * every user may see and forecast in one.
   */
  competition: TestCompetition;
  /** Binary, in `competition`, unresolved, with no forecasts. */
  openProp: TestProp;
  /** Binary, in `competition`, resolved yes, with an 80% forecast from `user`. */
  resolvedProp: TestProp;
  /**
   * A second public competition for the standings check, so that check does
   * not depend on whether the forecast check has run. Its one prop is
   * resolved yes with an 80% forecast from `user`: `user` has forecast every
   * prop in it, so they are ranked there, with a Brier score of 0.040.
   */
  standingsCompetition: TestCompetition;
  /** A third public competition for the resolve check, which changes it. */
  resolveCompetition: TestCompetition;
  /** Binary, unresolved, in `resolveCompetition`. */
  resolvableProp: TestProp;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function seed(db: Kysely<Database>): Promise<Seed> {
  const factory = new TestDataFactory(db);
  // The factory records each row it creates for vitest's per-test cleanup, and
  // asks vitest which test is running to do it. There is no vitest here, and
  // no cleanup to do: the database goes away with its container. getTracker()
  // is private, so check it is still there rather than patch nothing.
  const patchable = factory as unknown as { getTracker?: unknown };
  if (typeof patchable.getTracker !== "function") {
    throw new Error(
      "TestDataFactory has no getTracker() to replace; update e2e/support/seed.ts",
    );
  }
  patchable.getTracker = () => ({ trackId() {} });

  // createUser gives each a random UUID as idp_user_id; the minted tokens'
  // `sub` is that value.
  const user = await factory.createUser({
    name: "E2E Reader",
    email: "reader@example.com",
  });
  const admin = await factory.createAdminUser({
    name: "E2E Admin",
    email: "admin@example.com",
  });

  const now = Date.now();
  const competition = await factory.createCompetition({
    name: "E2E Competition",
    is_private: false,
    forecasts_open_date: new Date(now - 7 * DAY_MS),
    forecasts_close_date: new Date(now + 30 * DAY_MS),
    end_date: new Date(now + 60 * DAY_MS),
  });

  const openProp = await factory.createCompetitionProp(competition.id, {
    text: "E2E open prop",
    kind: "binary",
  });

  const resolvedProp = await factory.createCompetitionProp(competition.id, {
    text: "E2E resolved prop",
    kind: "binary",
  });
  await factory.createForecast(user.id, resolvedProp.id, { forecast: 0.8 });
  await factory.createResolution(resolvedProp.id, { resolution: true });

  const standingsCompetition = await factory.createCompetition({
    name: "E2E Standings Competition",
    is_private: false,
    forecasts_open_date: new Date(now - 7 * DAY_MS),
    forecasts_close_date: new Date(now + 30 * DAY_MS),
    end_date: new Date(now + 60 * DAY_MS),
  });
  const standingsProp = await factory.createCompetitionProp(
    standingsCompetition.id,
    { text: "E2E standings prop", kind: "binary" },
  );
  await factory.createForecast(user.id, standingsProp.id, { forecast: 0.8 });
  await factory.createResolution(standingsProp.id, { resolution: true });

  const resolveCompetition = await factory.createCompetition({
    name: "E2E Resolve Competition",
    is_private: false,
    forecasts_open_date: new Date(now - 7 * DAY_MS),
    forecasts_close_date: new Date(now + 30 * DAY_MS),
    end_date: new Date(now + 60 * DAY_MS),
  });
  const resolvableProp = await factory.createCompetitionProp(
    resolveCompetition.id,
    { text: "E2E prop to resolve", kind: "binary" },
  );

  return {
    user,
    admin,
    competition,
    openProp,
    resolvedProp,
    standingsCompetition,
    resolveCompetition,
    resolvableProp,
  };
}
