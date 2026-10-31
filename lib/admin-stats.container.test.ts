import { vi, describe, expect, beforeEach } from "vitest";
import { sql, type Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import {
  asUser,
  getRlsTestDb,
  getTestDb,
} from "../tests/helpers/testDatabase";
import { TestDataFactory } from "../tests/helpers/testFactories";
import { getTestTracker } from "../tests/helpers/testIdTracker";
import {
  ifRunningContainerTestsIt,
  shouldRunContainerTests,
} from "../tests/helpers/testUtils";

vi.mock("server-only", () => ({}));

import { loadAdminStats } from "./admin-stats";

/**
 * The admin stats against a real PostgreSQL, read the way the page reads them:
 * as an admin, through the non-owner role that RLS applies to.
 *
 * Other test files share this database, so "now" is pinned to 2099 and every
 * row whose time matters is dated then: the month and week windows see only
 * what this file put there. Totals that any test can move are checked as the
 * difference this file made.
 */
const NOW = new Date("2099-06-17T12:00:00Z"); // a Wednesday
const at = (iso: string) => new Date(iso);

describe("loadAdminStats against the database", () => {
  let db: Kysely<Database>;
  let rls: Kysely<Database>;
  let factory: TestDataFactory;

  beforeEach(async () => {
    if (shouldRunContainerTests()) {
      db = await getTestDb();
      rls = await getRlsTestDb();
      factory = new TestDataFactory(db);
    }
  });

  async function dated(userId: number, createdAt: Date) {
    await db
      .updateTable("users")
      .set({ created_at: createdAt })
      .where("id", "=", userId)
      .execute();
  }

  async function addMember(competitionId: number, userId: number) {
    const row = await db
      .insertInto("competition_members")
      .values({ competition_id: competitionId, user_id: userId, role: "forecaster" })
      .returning("id")
      .executeTakeFirstOrThrow();
    getTestTracker().trackId("competition_members", row.id);
  }

  ifRunningContainerTestsIt(
    "counts sign-ups by UTC month, this month and last",
    async () => {
      const admin = await factory.createAdminUser();
      const juneA = await factory.createUser();
      const mayA = await factory.createUser();
      const mayB = await factory.createUser();
      const firstMonth = await factory.createUser();
      const tooOld = await factory.createUser();
      await dated(juneA.id, at("2099-06-01T00:00:00Z"));
      await dated(mayA.id, at("2099-05-31T23:59:59Z"));
      await dated(mayB.id, at("2099-05-01T00:00:00Z"));
      await dated(firstMonth.id, at("2098-07-15T00:00:00Z"));
      await dated(tooOld.id, at("2098-06-30T23:59:59Z"));

      const stats = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );

      expect(stats.users.newThisMonth).toBe(1);
      expect(stats.users.newLastMonth).toBe(2);
      expect(stats.signupsByMonth).toHaveLength(12);
      expect(stats.signupsByMonth[0]).toEqual({
        start: at("2098-07-01T00:00:00Z"),
        count: 1,
      });
      expect(stats.signupsByMonth[10]).toEqual({
        start: at("2099-05-01T00:00:00Z"),
        count: 2,
      });
      expect(stats.signupsByMonth[11]).toEqual({
        start: at("2099-06-01T00:00:00Z"),
        count: 1,
      });
    },
  );

  ifRunningContainerTestsIt(
    "counts distinct forecasters by UTC week, by creation or last change",
    async () => {
      const admin = await factory.createAdminUser();
      const a = await factory.createUser();
      const b = await factory.createUser();
      const p1 = await factory.createProp();
      const p2 = await factory.createProp();
      const p3 = await factory.createProp();

      // a: two forecasts made this week. b: one made long ago, changed this week.
      const f1 = await factory.createForecast(a.id, p1.id);
      const f2 = await factory.createForecast(a.id, p2.id);
      const f3 = await factory.createForecast(b.id, p3.id);
      const thisWeek = at("2099-06-16T09:00:00Z");
      // The set_updated_at trigger stamps now() over any updated_at we write,
      // so backdating needs triggers off for this one transaction.
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("forecasts")
          .set({ created_at: thisWeek, updated_at: thisWeek })
          .where("id", "in", [f1.id, f2.id])
          .execute();
        await trx
          .updateTable("forecasts")
          .set({ created_at: at("2099-04-01T00:00:00Z"), updated_at: thisWeek })
          .where("id", "=", f3.id)
          .execute();
      });

      const stats = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );

      expect(stats.forecastersByWeek).toHaveLength(12);
      // Weeks start on Monday 00:00 UTC.
      expect(stats.forecastersByWeek[11]).toEqual({
        start: at("2099-06-15T00:00:00Z"),
        count: 2,
      });
      expect(stats.forecastersByWeek[10]!.count).toBe(0);
      expect(stats.forecasts.last7Days).toBe(2);
    },
  );

  ifRunningContainerTestsIt(
    "reports each competition's members, forecasters and completeness",
    async () => {
      const admin = await factory.createAdminUser();
      const m1 = await factory.createUser();
      const m2 = await factory.createUser();
      const outsider = await factory.createUser();

      const priv = await factory.createCompetition({
        is_private: true,
        forecasts_open_date: null,
        forecasts_close_date: null,
        end_date: null,
      });
      await addMember(priv.id, m1.id);
      await addMember(priv.id, m2.id);
      const pp1 = await factory.createCompetitionProp(priv.id);
      const pp2 = await factory.createCompetitionProp(priv.id);
      await factory.createForecast(m1.id, pp1.id);
      await factory.createForecast(m1.id, pp2.id);
      await factory.createForecast(m2.id, pp1.id);

      const pub = await factory.createCompetition({
        forecasts_open_date: at("2099-06-01T00:00:00Z"),
        forecasts_close_date: at("2099-07-01T00:00:00Z"),
        end_date: at("2099-12-31T00:00:00Z"),
      });
      const pubProp = await factory.createCompetitionProp(pub.id);
      await factory.createForecast(outsider.id, pubProp.id);

      const stats = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );
      const row = (id: number) =>
        stats.competitions.rows.find((c) => c.id === id);

      expect(row(priv.id)).toEqual({
        id: priv.id,
        name: priv.name,
        state: "open",
        members: 2,
        forecasters: 2,
        props: 2,
        forecasts: 3,
        complete: 3 / 4,
      });
      expect(row(pub.id)).toEqual({
        id: pub.id,
        name: pub.name,
        state: "open",
        members: null,
        forecasters: 1,
        props: 1,
        forecasts: 1,
        complete: 1,
      });
    },
  );

  ifRunningContainerTestsIt(
    "counts opt-outs among active users, and pending suggestions",
    async () => {
      const admin = await factory.createAdminUser();
      const before = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );

      const optedOut = await factory.createUser();
      const deactivatedOptOut = await factory.createUser();
      await db
        .updateTable("users")
        .set({ deactivated_at: new Date() })
        .where("id", "=", deactivatedOptOut.id)
        .execute();
      await db
        .insertInto("notification_preferences")
        .values([
          { user_id: optedOut.id, notification_type: "admin.announcement", enabled: false },
          {
            user_id: deactivatedOptOut.id,
            notification_type: "admin.announcement",
            enabled: false,
          },
        ])
        .execute();
      const suggestion = await db
        .insertInto("suggested_props")
        .values({ suggester_user_id: optedOut.id, prop: "Will it rain?" })
        .returning("id")
        .executeTakeFirstOrThrow();
      getTestTracker().trackId("suggested_props", suggestion.id);

      const after = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );
      const off = (s: typeof after) =>
        s.notifications.find((x) => x.type === "admin.announcement")!.off;

      // The deactivated user's opt-out is not counted: they get nothing anyway.
      expect(off(after) - off(before)).toBe(1);
      expect(after.users.active - before.users.active).toBe(1);
      expect(after.users.deactivated - before.users.deactivated).toBe(1);
      expect(after.suggestions.pending - before.suggestions.pending).toBe(1);
    },
  );
});
