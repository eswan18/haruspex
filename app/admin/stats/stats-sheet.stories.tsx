import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AdminStats } from "@/lib/admin-stats";

import { StatsSheet } from "./stats-sheet";
import { sheetCss } from "@/components/prop-list/sheet";

const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 1)));
const weeks = Array.from(
  { length: 12 },
  (_, i) => new Date(Date.UTC(2026, 7, 10 + 7 * i)),
);

// Sample figures for the story only.
const sample: AdminStats = {
  asOf: new Date("2026-10-31T12:00:00Z"),
  users: { active: 48, deactivated: 3, newThisMonth: 6, newLastMonth: 2 },
  forecasts: { total: 3120, last7Days: 41 },
  props: { inCompetitions: 214, personal: 37 },
  competitions: {
    total: 4,
    takingForecasts: 2,
    rows: [
      { id: 4, name: "2027 Annual", state: "upcoming", members: null, forecasters: 0, props: 0, forecasts: 0, complete: null },
      { id: 3, name: "Office Pool", state: "open", members: 9, forecasters: 8, props: 14, forecasts: 97, complete: 97 / 126 },
      { id: 2, name: "2026 Annual", state: "scoring", members: null, forecasters: 38, props: 50, forecasts: 1840, complete: 1840 / 1900 },
      { id: 1, name: "2025 Annual", state: "final", members: null, forecasters: 31, props: 40, forecasts: 1183, complete: 1183 / 1240 },
    ],
  },
  suggestions: { pending: 5, accepted: 22, rejected: 9 },
  notifications: [
    { type: "admin.announcement", label: "Announcements", description: "Occasional messages to everyone on Haruspex, like the yearly call for prop ideas.", off: 2 },
    { type: "competition.member_added", label: "Added to a competition", description: "When someone adds you to a private competition, so you know it is there.", off: 0 },
    { type: "competition.prop_added", label: "New props", description: "When a prop is added to a competition of yours that opens each prop on its own deadline.", off: 4 },
  ],
  activeUsers: {
    today: 7,
    last7Days: 19,
    last30Days: 31,
    last30DaysStillActive: 30,
    daily: Array.from({ length: 30 }, (_, i) => ({
      start: new Date(Date.UTC(2026, 9, 2 + i)),
      count: [6, 9, 11, 8, 7, 4, 3][i % 7]! + (i > 20 ? 3 : 0),
    })),
    weekly: Array.from({ length: 26 }, (_, i) => ({
      start: new Date(Date.UTC(2026, 4, 4 + 7 * i)),
      count: 10 + Math.round(6 * Math.sin(i / 3)) + (i > 18 ? 6 : 0),
    })),
    monthly: months.map((start, i) => ({
      start,
      count: [22, 30, 41, 28, 19, 17, 15, 16, 18, 20, 27, 31][i]!,
    })),
  },
  signupsByMonth: months.map((start, i) => ({ start, count: [3, 9, 17, 6, 2, 1, 0, 1, 2, 1, 2, 6][i]! })),
  forecastersByWeek: weeks.map((start, i) => ({ start, count: [4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 5][i]! })),
};

const meta = {
  title: "Admin/StatsSheet",
  component: StatsSheet,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <>
        <style dangerouslySetInnerHTML={{ __html: sheetCss }} />
        <Story />
      </>
    ),
  ],
  args: { stats: sample },
} satisfies Meta<typeof StatsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A fresh install: nothing yet, and nothing should divide by zero. */
export const Empty: Story = {
  args: {
    stats: {
      ...sample,
      users: { active: 1, deactivated: 0, newThisMonth: 1, newLastMonth: 0 },
      forecasts: { total: 0, last7Days: 0 },
      props: { inCompetitions: 0, personal: 0 },
      competitions: { total: 0, takingForecasts: 0, rows: [] },
      suggestions: { pending: 0, accepted: 0, rejected: 0 },
      notifications: sample.notifications.map((n) => ({ ...n, off: 0 })),
      activeUsers: {
        today: 0,
        last7Days: 0,
        last30Days: 0,
        last30DaysStillActive: 0,
        daily: sample.activeUsers.daily.map((p) => ({ ...p, count: 0 })),
        weekly: sample.activeUsers.weekly.map((p) => ({ ...p, count: 0 })),
        monthly: sample.activeUsers.monthly.map((p) => ({ ...p, count: 0 })),
      },
      signupsByMonth: sample.signupsByMonth.map((p) => ({ ...p, count: 0 })),
      forecastersByWeek: sample.forecastersByWeek.map((p) => ({ ...p, count: 0 })),
    },
  },
};
