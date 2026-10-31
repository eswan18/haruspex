import "server-only";
import { sql, type Kysely, type Transaction } from "kysely";

import { getCompetitionStatusFromObject } from "@/lib/competition-status";
import { notificationEnabled } from "@/lib/notifications/preferences";
import {
  NOTIFICATIONS,
  OPTIONAL_NOTIFICATION_TYPES,
  type OptionalNotificationType,
} from "@/lib/notifications/types";
import { seasonStateOf, type SeasonState } from "@/components/competition-stamp/competition-stamp";
import type { Database } from "@/types/db_types";

type Executor = Kysely<Database> | Transaction<Database>;

/** How many months and weeks the two charts cover. */
export const CHART_PERIODS = 12;

export interface CompetitionStats {
  id: number;
  name: string;
  state: SeasonState;
  /** Members of a private competition; null for a public one, which has none. */
  members: number | null;
  /** Distinct people with a forecast on any of its props. */
  forecasters: number;
  props: number;
  forecasts: number;
  /**
   * Forecasts made out of those that could be: props × members for a private
   * competition, props × forecasters for a public one (anyone may join, so the
   * people who did are the denominator). Null when nothing could be made yet.
   */
  complete: number | null;
}

export interface AdminStats {
  asOf: Date;
  users: {
    active: number;
    deactivated: number;
    newThisMonth: number;
    newLastMonth: number;
  };
  forecasts: { total: number; last7Days: number };
  props: { inCompetitions: number; personal: number };
  competitions: {
    total: number;
    takingForecasts: number;
    rows: CompetitionStats[];
  };
  suggestions: { pending: number; accepted: number; rejected: number };
  notifications: {
    type: OptionalNotificationType;
    label: string;
    description: string;
    /** Active users who get none of this, by choice or by default. */
    off: number;
  }[];
  /** Oldest first; each `start` is the first instant of the UTC month. */
  signupsByMonth: { start: Date; count: number }[];
  /**
   * Oldest first; each `start` is a Monday 00:00 UTC. The count is distinct
   * people who made a forecast that week or last changed one then: a forecast
   * is one row edited in place, so an edit between two others leaves no trace.
   */
  forecastersByWeek: { start: Date; count: number }[];
}

const n = (value: unknown): number => Number(value ?? 0);

/**
 * Everything the admin Stats page shows, as of `now`.
 *
 * Read through RLS as an admin (the caller's `withRLS`), whose policies see
 * every row; the container test holds that true. Months and weeks are UTC,
 * like the rest of the app's deadlines.
 */
export async function loadAdminStats(
  db: Executor,
  now: Date = new Date(),
): Promise<AdminStats> {
  const [
    users,
    forecasts,
    props,
    competitions,
    suggestions,
    notifications,
    signups,
    forecasters,
  ] = await Promise.all([
    db
      .selectFrom("users")
      .select([
        sql<string>`count(*) filter (where deactivated_at is null)`.as("active"),
        sql<string>`count(*) filter (where deactivated_at is not null)`.as(
          "deactivated",
        ),
        sql<string>`count(*) filter (where created_at >= date_trunc('month', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC')`.as(
          "new_this_month",
        ),
        sql<string>`count(*) filter (where created_at >= (date_trunc('month', ${now}::timestamptz at time zone 'UTC') - interval '1 month') at time zone 'UTC' and created_at < date_trunc('month', ${now}::timestamptz at time zone 'UTC') at time zone 'UTC')`.as(
          "new_last_month",
        ),
      ])
      .executeTakeFirstOrThrow(),

    db
      .selectFrom("forecasts")
      .select([
        sql<string>`count(*)`.as("total"),
        sql<string>`count(*) filter (where created_at >= ${now}::timestamptz - interval '7 days')`.as(
          "last_7_days",
        ),
      ])
      .executeTakeFirstOrThrow(),

    db
      .selectFrom("props")
      .select([
        sql<string>`count(*) filter (where competition_id is not null)`.as(
          "in_competitions",
        ),
        sql<string>`count(*) filter (where competition_id is null)`.as(
          "personal",
        ),
      ])
      .executeTakeFirstOrThrow(),

    db
      .selectFrom("competitions as c")
      .select([
        "c.id",
        "c.name",
        "c.is_private",
        "c.forecasts_open_date",
        "c.forecasts_close_date",
        "c.end_date",
        sql<string>`(select count(*) from competition_members m where m.competition_id = c.id)`.as(
          "members",
        ),
        sql<string>`(select count(*) from props p where p.competition_id = c.id)`.as(
          "props",
        ),
        sql<string>`(select count(*) from forecasts f join props p on p.id = f.prop_id where p.competition_id = c.id)`.as(
          "forecasts",
        ),
        sql<string>`(select count(distinct f.user_id) from forecasts f join props p on p.id = f.prop_id where p.competition_id = c.id)`.as(
          "forecasters",
        ),
      ])
      .orderBy("c.created_at", "desc")
      .orderBy("c.id", "desc")
      .execute(),

    db
      .selectFrom("suggested_props")
      .select([
        sql<string>`count(*) filter (where status is null)`.as("pending"),
        sql<string>`count(*) filter (where status = 'accepted')`.as("accepted"),
        sql<string>`count(*) filter (where status = 'rejected')`.as("rejected"),
      ])
      .executeTakeFirstOrThrow(),

    db
      .selectFrom("users")
      .where("users.deactivated_at", "is", null)
      .select(
        OPTIONAL_NOTIFICATION_TYPES.map((type) =>
          sql<string>`count(*) filter (where not ${notificationEnabled(type)})`.as(
            type,
          ),
        ),
      )
      .executeTakeFirstOrThrow(),

    sql<{ start: Date; count: string }>`
      with months as (
        select generate_series(
          date_trunc('month', ${now}::timestamptz at time zone 'UTC') - (${CHART_PERIODS - 1}::int * interval '1 month'),
          date_trunc('month', ${now}::timestamptz at time zone 'UTC'),
          interval '1 month'
        ) as start
      )
      select m.start at time zone 'UTC' as start, count(u.id) as count
      from months m
      left join users u
        on u.created_at >= m.start at time zone 'UTC'
       and u.created_at < (m.start + interval '1 month') at time zone 'UTC'
      group by m.start
      order by m.start
    `.execute(db),

    sql<{ start: Date; count: string }>`
      with weeks as (
        select generate_series(
          date_trunc('week', ${now}::timestamptz at time zone 'UTC') - (${CHART_PERIODS - 1}::int * interval '1 week'),
          date_trunc('week', ${now}::timestamptz at time zone 'UTC'),
          interval '1 week'
        ) as start
      )
      select w.start at time zone 'UTC' as start, count(distinct f.user_id) as count
      from weeks w
      left join forecasts f
        on (f.created_at >= w.start at time zone 'UTC'
            and f.created_at < (w.start + interval '1 week') at time zone 'UTC')
        or (f.updated_at >= w.start at time zone 'UTC'
            and f.updated_at < (w.start + interval '1 week') at time zone 'UTC')
      group by w.start
      order by w.start
    `.execute(db),
  ]);

  const competitionRows: CompetitionStats[] = competitions.map((c) => {
    const members = c.is_private ? n(c.members) : null;
    const forecastersCount = n(c.forecasters);
    const propsCount = n(c.props);
    const forecastsCount = n(c.forecasts);
    const possible = propsCount * (members ?? forecastersCount);
    return {
      id: c.id,
      name: c.name,
      state: seasonStateOf(getCompetitionStatusFromObject(c, now)),
      members,
      forecasters: forecastersCount,
      props: propsCount,
      forecasts: forecastsCount,
      complete: possible > 0 ? forecastsCount / possible : null,
    };
  });

  return {
    asOf: now,
    users: {
      active: n(users.active),
      deactivated: n(users.deactivated),
      newThisMonth: n(users.new_this_month),
      newLastMonth: n(users.new_last_month),
    },
    forecasts: {
      total: n(forecasts.total),
      last7Days: n(forecasts.last_7_days),
    },
    props: {
      inCompetitions: n(props.in_competitions),
      personal: n(props.personal),
    },
    competitions: {
      total: competitionRows.length,
      takingForecasts: competitionRows.filter((c) => c.state === "open")
        .length,
      rows: competitionRows,
    },
    suggestions: {
      pending: n(suggestions.pending),
      accepted: n(suggestions.accepted),
      rejected: n(suggestions.rejected),
    },
    notifications: OPTIONAL_NOTIFICATION_TYPES.map((type) => {
      const spec = NOTIFICATIONS[type];
      return {
        type,
        label: spec.label,
        description: spec.description,
        off: n((notifications as Record<string, unknown>)[type]),
      };
    }),
    signupsByMonth: signups.rows.map((r) => ({
      start: new Date(r.start),
      count: n(r.count),
    })),
    forecastersByWeek: forecasters.rows.map((r) => ({
      start: new Date(r.start),
      count: n(r.count),
    })),
  };
}
