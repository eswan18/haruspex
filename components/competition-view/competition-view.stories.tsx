import type { Meta, StoryObj } from "@storybook/react-vite";

import { CompetitionOverview } from "./competition-overview";
import {
  CURRENT_USER_ID,
  NOW,
  emptyPrivateSeason,
  finalSeason,
  midSeason,
  preSeason,
  privateSeason,
  scoringSeason,
} from "./fixtures";

const shared = { currentUserId: CURRENT_USER_ID, now: NOW };

const meta = {
  title: "Competition/Overview",
  component: CompetitionOverview,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof CompetitionOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common case: results in, props still owed. */
export const MidSeason: Story = { args: { data: midSeason, ...shared } };

/** Just opened. Nothing scored, so the left column has no standing to print. */
export const PreSeason: Story = { args: { data: preSeason, ...shared } };

/** Forecasting shut, results still landing: nothing owed, scores still moving. */
export const Scoring: Story = { args: { data: scoringSeason, ...shared } };

/** Over. Every prop settled. */
export const Final: Story = { args: { data: finalSeason, ...shared } };

/** A two-person private group — the smallest field the layout has to hold. */
export const SmallPrivate: Story = { args: { data: privateSeason, ...shared } };

/**
 * A writer's view: the kicker offers the way to the form. Shown on the
 * reader's power to write a prop, never on the number of open ones.
 */
export const CanWriteProps: Story = {
  args: {
    data: privateSeason,
    ...shared,
    newPropHref: "/competitions/12/props/new",
  },
};

/**
 * The case this link exists for: an empty private competition, seen by its
 * admin. With no open props there is no open-props link to carry the form, so
 * without this the admin has no way to write the first prop.
 */
export const EmptyButWritable: Story = {
  args: {
    data: emptyPrivateSeason,
    ...shared,
    newPropHref: "/competitions/13/props/new",
  },
};

/** The same empty competition to a forecaster, who may not write one. */
export const EmptyAndReadOnly: Story = {
  args: { data: emptyPrivateSeason, ...shared },
};
