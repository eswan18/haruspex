import type { Meta, StoryObj } from "@storybook/react-vite";

import { HelpSheet } from "./help-sheet";

const meta = {
  title: "Help/HelpSheet",
  component: HelpSheet,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof HelpSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prod: Story = {
  args: { mcpUrl: "https://haruspex.fyi/mcp" },
};

/** A deployment with no MCP endpoint configured. */
export const NoAssistantSetup: Story = {
  args: { mcpUrl: null },
};
