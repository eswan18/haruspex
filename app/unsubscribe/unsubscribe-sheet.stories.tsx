import type { Meta, StoryObj } from "@storybook/react-vite";

import { NOTIFICATIONS } from "@/lib/notifications/types";

import { UnsubscribeSheet } from "./unsubscribe-sheet";

const propAdded = NOTIFICATIONS["competition.prop_added"];

const meta = {
  title: "Account/UnsubscribeSheet",
  component: UnsubscribeSheet,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    state: "ask",
    label: propAdded.optional ? propAdded.label : undefined,
    description: propAdded.optional ? propAdded.description : undefined,
    token: "7:competition.prop_added:signature",
  },
} satisfies Meta<typeof UnsubscribeSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Where the link lands. Nothing has been written yet. */
export const Ask: Story = {};

/** After the press: switched off, with one press back. */
export const TurnedOff: Story = { args: { state: "off" } };

/** After the undo. */
export const BackOn: Story = { args: { state: "on" } };

/** A mangled link, or one older than the key that signed it. */
export const Invalid: Story = {
  args: { state: "invalid", label: undefined, description: undefined },
};
