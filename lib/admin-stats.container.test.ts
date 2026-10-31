import { vi, describe, expect, beforeEach } from "vitest";
import { sql, type Kysely } from "kysely";

import type { Database } from "@/types/db_types";
import { asUser, getRlsTestDb, getTestDb } from "../tests/helpers/testDatabase";
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
      .values({
        competition_id: competitionId,
        user_id: userId,
        role: "forecaster",
      })
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
      // These totals span the whole table, and other files write to it while
      // this runs -- the review tests decide suggestions, and every file's
      // cleanup deletes users. A before/after difference read across commits
      // picks that up, so the whole test is one REPEATABLE READ snapshot: the
      // reads see this test's own writes and nobody else's. It rolls back,
      // leaving nothing to clean up. Reads still go through app_user, so RLS
      // applies to them exactly as it does to the page.
      class Rollback extends Error {}
      await db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (trx) => {
          const factory = new TestDataFactory(trx);
          const admin = await factory.createAdminUser();
          const readAsAdmin = async () => {
            await sql`SET LOCAL ROLE app_user`.execute(trx);
            await sql`SELECT set_config('app.current_user_id', ${String(admin.id)}, true)`.execute(
              trx,
            );
            const stats = await loadAdminStats(trx, NOW);
            await sql`RESET ROLE`.execute(trx);
            return stats;
          };
          const before = await readAsAdmin();

          const optedOut = await factory.createUser();
          const deactivatedOptOut = await factory.createUser();
          await trx
            .updateTable("users")
            .set({ deactivated_at: new Date() })
            .where("id", "=", deactivatedOptOut.id)
            .execute();
          await trx
            .insertInto("notification_preferences")
            .values([
              {
                user_id: optedOut.id,
                notification_type: "admin.announcement",
                enabled: false,
              },
              {
                user_id: deactivatedOptOut.id,
                notification_type: "admin.announcement",
                enabled: false,
              },
            ])
            .execute();
          await trx
            .insertInto("suggested_props")
            .values({ suggester_user_id: optedOut.id, prop: "Will it rain?" })
            .execute();

          const after = await readAsAdmin();
          const off = (s: typeof after) =>
            s.notifications.find((x) => x.type === "admin.announcement")!.off;

          // The deactivated user's opt-out is not counted: they get nothing
          // anyway. The admin was created before `before`, so is in both.
          expect(off(after) - off(before)).toBe(1);
          expect(after.users.active - before.users.active).toBe(1);
          expect(after.users.deactivated - before.users.deactivated).toBe(1);
          expect(after.suggestions.pending - before.suggestions.pending).toBe(
            1,
          );
          throw new Rollback();
        })
        .catch((err) => {
          if (!(err instanceof Rollback)) throw err;
        });
    },
  );
  ifRunningContainerTestsIt(
    "counts distinct active users by UTC day, week and month",
    async () => {
      const admin = await factory.createAdminUser();
      const [a, b, c, d, e, gone] = await Promise.all(
        Array.from({ length: 6 }, () => factory.createUser()),
      );
      await db
        .updateTable("users")
        .set({ deactivated_at: new Date() })
        .where("id", "=", gone.id)
        .execute();
      // NOW is Wednesday 2099-06-17. Rows are written directly: what the
      // recorder writes is its own test's business.
      await db
        .insertInto("user_active_days")
        .values([
          { user_id: a.id, day: "2099-06-17" }, // today
          { user_id: b.id, day: "2099-06-17" }, // today
          { user_id: a.id, day: "2099-06-15" }, // Monday this week
          { user_id: c.id, day: "2099-06-11" }, // last week, within 7 days
          { user_id: d.id, day: "2099-05-20" }, // within 30 days
          { user_id: e.id, day: "2099-05-18" }, // exactly 30 days back: out
          { user_id: gone.id, day: "2099-06-01" }, // since deactivated
        ])
        .execute();

      const { activeUsers } = await asUser(rls, admin.id, (trx) =>
        loadAdminStats(trx, NOW),
      );

      expect(activeUsers.today).toBe(2);
      expect(activeUsers.last7Days).toBe(3);
      // History keeps everyone who was active then; the share's numerator
      // keeps only accounts still active.
      expect(activeUsers.last30Days).toBe(5);
      expect(activeUsers.last30DaysStillActive).toBe(4);

      expect(activeUsers.daily).toHaveLength(30);
      expect(activeUsers.daily.at(-1)).toEqual({
        start: at("2099-06-17T00:00:00Z"),
        count: 2,
      });
      expect(activeUsers.daily.at(-3)).toEqual({
        start: at("2099-06-15T00:00:00Z"),
        count: 1,
      });

      expect(activeUsers.weekly).toHaveLength(26);
      // a twice this week counts once.
      expect(activeUsers.weekly.at(-1)).toEqual({
        start: at("2099-06-15T00:00:00Z"),
        count: 2,
      });
      expect(activeUsers.weekly.at(-2)).toEqual({
        start: at("2099-06-08T00:00:00Z"),
        count: 1,
      });

      expect(activeUsers.monthly).toHaveLength(12);
      expect(activeUsers.monthly.at(-1)).toEqual({
        start: at("2099-06-01T00:00:00Z"),
        count: 4,
      });
      expect(activeUsers.monthly.at(-2)).toEqual({
        start: at("2099-05-01T00:00:00Z"),
        count: 2,
      });
      expect(activeUsers.monthly[0]!.start).toEqual(at("2098-07-01T00:00:00Z"));
    },
  );
});
