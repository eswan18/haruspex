import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { BugReportDialog } from "./bug-report-dialog";

const meta = {
  title: "Chrome/BugReportDialog",
  component: BugReportDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    onOpenChange: fn(),
    send: fn(async () => {}),
  },
} satisfies Meta<typeof BugReportDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Written: Story = {
  args: {
    initialMessage:
      "I opened the Office Pool standings and my score shows as blank, though I forecast on every prop.",
  },
};

/** Sending fails: the text stays, and the field says so. Press Send. */
export const SendFails: Story = {
  args: {
    initialMessage: "The chart on the prop page is empty.",
    send: fn(async () => {
      throw new Error("ERROR_NO_CLIENT");
    }),
  },
};
