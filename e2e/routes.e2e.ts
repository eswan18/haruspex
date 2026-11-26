/**
 * Every page in the app renders. Each page no other spec visits is opened
 * once, as a seeded user who may see it, and must show its level-1 heading
 * (plus a landmark of its own where the heading is shared with another page,
 * such as a competition's name). The fixture fails the check on any 5xx or
 * uncaught page error along the way.
 *
 * The first check keeps the lists below honest: a page added under app/
 * fails the suite until it is swept here, named as covered by another spec,
 * or skipped with a reason.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { test, expect } from "./support/fixtures";
import { APP_JWT_SECRET, ROOT, STATE, readSeed } from "./support/harness";

const seed = readSeed();

/** A page as app/ names it: its folder under app/, dynamic segments and all. */
type Route = `/${string}`;

interface Sweep {
  route: Route;
  /** The route with its dynamic segments filled from the seed. */
  url: string;
  as: "reader" | "admin";
  /** What the page must show. */
  shows(page: Page): Promise<void>;
}

const h1 = (page: Page, name: string) =>
  expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();

const h2 = (page: Page, name: RegExp) =>
  expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

/** An unsubscribe link as the app signs one (lib/notifications/unsubscribe-token.ts). */
function unsubscribeToken(userId: number): string {
  const data = `${userId}:competition.prop_added`;
  const signature = crypto
    .createHmac("sha256", APP_JWT_SECRET)
    .update(data)
    .digest("hex");
  return `${data}:${signature}`;
}

const SWEEP: Sweep[] = [
  {
    route: "/competitions",
    url: "/competitions",
    as: "reader",
    shows: (page) => h1(page, "Competitions"),
  },
  {
    route: "/competitions/[competitionId]/forecast-stats",
    url: `/competitions/${seed.competition.id}/forecast-stats`,
    as: "reader",
    shows: async (page) => {
      await h1(page, seed.competition.name);
      await expect(page.getByText(/^Forecast stats/)).toBeVisible();
    },
  },
  {
    route: "/competitions/[competitionId]/members",
    // Only a private competition has a members list.
    url: `/competitions/${seed.privateCompetition.id}/members`,
    as: "reader",
    shows: async (page) => {
      await h1(page, seed.privateCompetition.name);
      await h2(page, /^Members · 1/i);
    },
  },
  {
    route: "/competitions/[competitionId]/props/awaiting",
    url: `/competitions/${seed.competition.id}/props/awaiting`,
    as: "reader",
    shows: async (page) => {
      await h1(page, seed.competition.name);
      await h2(page, /^Awaiting result/i);
    },
  },
  {
    route: "/competitions/[competitionId]/props/new",
    // In a public competition, only a site admin may write props.
    url: `/competitions/${seed.competition.id}/props/new`,
    as: "admin",
    shows: async (page) => {
      await h1(page, seed.competition.name);
      await h2(page, /^New prop/i);
    },
  },
  {
    route: "/competitions/[competitionId]/scores/user/[userId]",
    url: `/competitions/${seed.standingsCompetition.id}/scores/user/${seed.user.id}`,
    as: "reader",
    shows: async (page) => {
      await h1(page, seed.standingsCompetition.name);
      await h2(page, /^Your forecasts · 1 resolved/i);
    },
  },
  {
    route: "/props",
    url: "/props",
    as: "reader",
    shows: async (page) => {
      await h1(page, "Your props");
      await h2(page, /^Personal props/i);
    },
  },
  {
    route: "/props/new",
    url: "/props/new",
    as: "reader",
    shows: async (page) => {
      await h1(page, "Your props");
      await h2(page, /^New prop/i);
    },
  },
  {
    route: "/props/[propId]",
    url: `/props/${seed.personalProp.id}`,
    as: "reader",
    shows: async (page) => {
      await h1(page, seed.personalProp.text);
      await h2(page, /^Your forecast/i);
    },
  },
  {
    route: "/props/suggest",
    url: "/props/suggest",
    as: "reader",
    shows: (page) => h1(page, "Suggest a prop"),
  },
  {
    route: "/standalone/calibration",
    url: "/standalone/calibration",
    as: "reader",
    shows: (page) => h1(page, "Calibration"),
  },
  {
    route: "/unsubscribe",
    // The page reads no session; it trusts only the signed link.
    url: `/unsubscribe?t=${encodeURIComponent(unsubscribeToken(seed.user.id))}`,
    as: "reader",
    shows: (page) => h1(page, "Stop sending new props?"),
  },
  {
    route: "/admin/announcements",
    url: "/admin/announcements",
    as: "admin",
    shows: (page) => h1(page, "Send an announcement"),
  },
  {
    route: "/admin/competitions",
    url: "/admin/competitions",
    as: "admin",
    shows: async (page) => {
      await h1(page, "Competitions");
      await h2(page, /^All competitions/i);
    },
  },
  {
    route: "/admin/feature-flags",
    url: "/admin/feature-flags",
    as: "admin",
    shows: (page) => h1(page, "Feature flags"),
  },
  {
    route: "/admin/forecast-progress",
    url: "/admin/forecast-progress",
    as: "admin",
    shows: (page) => h1(page, "Forecast progress"),
  },
  {
    route: "/admin/stats",
    url: "/admin/stats",
    as: "admin",
    shows: (page) => h1(page, "Stats"),
  },
  {
    route: "/admin/suggested-props",
    url: "/admin/suggested-props",
    as: "admin",
    shows: (page) => h1(page, "Suggested props"),
  },
  {
    route: "/admin/users/[userId]",
    url: `/admin/users/${seed.user.id}`,
    as: "admin",
    shows: (page) => h1(page, seed.user.name),
  },
  {
    route: "/admin/users/[userId]/email",
    url: `/admin/users/${seed.user.id}/email`,
    as: "admin",
    shows: (page) => h1(page, `Email ${seed.user.name}`),
  },
];

/** Pages another spec already renders, and which one. */
const COVERED: Record<Route, string> = {
  "/": "signed-out.e2e.ts (landing), reader.e2e.ts (dashboard)",
  "/login": "signed-out.e2e.ts, sign-in.e2e.ts",
  "/help": "signed-out.e2e.ts, reader.e2e.ts",
  "/account": "reader.e2e.ts, sign-in.e2e.ts",
  "/admin": "admin.e2e.ts",
  "/admin/users": "admin.e2e.ts",
  "/competitions/[competitionId]": "reader.e2e.ts",
  "/competitions/[competitionId]/standings": "reader.e2e.ts",
  "/competitions/[competitionId]/props/open": "reader.e2e.ts",
  "/competitions/[competitionId]/props/resolved": "reader.e2e.ts, admin.e2e.ts",
  "/competitions/[competitionId]/props/[propId]":
    "reader.e2e.ts (forecast), admin.e2e.ts (resolve)",
};

/** Pages deliberately not rendered by any check, each with the reason. */
const SKIPPED: Record<Route, string> = {};

/**
 * The routes app/ defines: one per `page.*` file, its folder path with route
 * groups `(name)` and parallel-route slots `@name` dropped, and private
 * folders `_name` (not routes at all) left out.
 */
function routesOnDisk(): Route[] {
  const app = path.join(ROOT, "app");
  return fs
    .readdirSync(app, { recursive: true, encoding: "utf8" })
    .filter((file) => /^page\.(tsx?|jsx?|mdx)$/.test(path.basename(file)))
    .map((file) => path.dirname(file).split(path.sep))
    .filter((segments) => !segments.some((s) => s.startsWith("_")))
    .map(
      (segments) =>
        `/${segments
          .filter((s) => s !== "." && !/^\(.*\)$/.test(s) && !s.startsWith("@"))
          .join("/")}` as Route,
    );
}

test("every page in app/ is swept here, covered by another spec, or skipped with a reason", () => {
  const listed = new Set<string>([
    ...SWEEP.map((sweep) => sweep.route),
    ...Object.keys(COVERED),
    ...Object.keys(SKIPPED),
  ]);
  const onDisk = new Set<string>(routesOnDisk());
  const unlisted = [...onDisk].filter((route) => !listed.has(route)).sort();
  const gone = [...listed].filter((route) => !onDisk.has(route)).sort();
  expect
    .soft(
      unlisted,
      `Pages no smoke check renders: ${unlisted.join(", ")}. Add each to SWEEP in e2e/routes.e2e.ts, or to COVERED (naming the spec that renders it) or SKIPPED (with the reason).`,
    )
    .toEqual([]);
  expect(
    gone,
    `Listed in e2e/routes.e2e.ts but no longer a page under app/: ${gone.join(", ")}. Remove them.`,
  ).toEqual([]);
});

for (const as of ["reader", "admin"] as const) {
  test.describe(`as ${as === "reader" ? "a reader" : "an admin"}`, () => {
    test.use({ storageState: as === "reader" ? STATE.user : STATE.admin });

    for (const sweep of SWEEP.filter((sweep) => sweep.as === as)) {
      test(`${sweep.route} renders`, async ({ page }) => {
        await page.goto(sweep.url);
        await expect(page).toHaveURL(new URL(sweep.url, page.url()).toString());
        await sweep.shows(page);
      });
    }
  });
}
