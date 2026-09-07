import type { Meta, StoryObj } from "@storybook/react-vite";

import { DashboardView } from "./dashboard-view";
import { standingsFixture, resolvedFixture } from "./dashboard-view.fixtures";

const meta = {
  title: "Dashboard/DashboardView",
  component: DashboardView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DashboardView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default view: only seasons still in play, with the finished ones held
 *  back behind the bar. */
export const Default: Story = {
  args: {
    standings: standingsFixture.filter((s) => s.phase !== "final"),
    resolved: resolvedFixture,
    hiddenCount: standingsFixture.filter((s) => s.phase === "final").length,
  },
};

/** Everything, finished seasons included. */
export const ShowingAll: Story = {
  args: {
    standings: standingsFixture,
    resolved: resolvedFixture,
    showAll: true,
  },
};

/** Seasons still in play carry the big number; finished ones collapse to a row. */
export const InPlayOnly: Story = {
  args: {
    standings: standingsFixture.filter((s) => s.phase !== "final"),
    resolved: resolvedFixture,
  },
};

/** Forecasting has shut but props are still resolving: still featured, since the
 *  standing can still move. Closed is not over. */
export const StillScoring: Story = {
  args: {
    standings: standingsFixture.filter((s) => s.phase === "scoring"),
    resolved: resolvedFixture,
  },
};

/** Joined a competition but nothing has resolved yet, so there is no rank. */
export const Unscored: Story = {
  args: {
    standings: [
      {
        id: 9,
        name: "2027 Season",
        phase: "live",
        isPrivate: false,
        leaders: [],
        you: null,
        fieldSize: 0,
      },
    ],
    resolved: [],
  },
};

/** Only public competitions, so the Private half is omitted entirely. */
export const PublicOnly: Story = {
  args: {
    standings: standingsFixture.filter((s) => !s.isPrivate),
    resolved: resolvedFixture,
  },
};

/**
 * Every resolved outcome is set in the same ink, however the forecast landed.
 * The spread here is deliberate: a confident forecast that came in against the
 * reader (95% / No), one that came in for them (90% / Yes), and a well-judged
 * near-coin-flip (45% / No) that is not a mistake at all. None of them is red.
 */
export const ResolvedOutcomes: Story = {
  args: {
    standings: [],
    resolved: [
      {
        forecastId: 11,
        propId: 201,
        propText: "The incumbent wins re-election",
        forecast: 0.95,
        resolution: false,
      },
      {
        forecastId: 12,
        propId: 202,
        propText: "The merger clears review before June",
        forecast: 0.9,
        resolution: true,
      },
      {
        forecastId: 13,
        propId: 203,
        propText: "England win the Ashes",
        forecast: 0.45,
        resolution: false,
      },
      {
        forecastId: 14,
        propId: 204,
        propText: "A US government shutdown before April",
        forecast: 0.05,
        resolution: true,
      },
    ],
  },
};

/** The first thing a brand-new account sees. */
export const Empty: Story = {
  args: { standings: [], resolved: [] },
};
