import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { sheetCss } from "@/components/prop-list/sheet";

import { SettingToggle, toggleCss } from "./setting-toggle";

/** The sheet's own stock, so the control is seen on the paper it prints on. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + toggleCss }} />
      <div className="col" style={{ paddingTop: "3rem" }}>
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "Controls/SettingToggle",
  component: SettingToggle,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Sheet>
        <Story />
      </Sheet>
    ),
  ],
  args: {
    label: "Default",
    value: true,
    onSet: fn(),
  },
} satisfies Meta<typeof SettingToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = { args: { value: true } };

export const Off: Story = { args: { value: false } };

/** No flag row exists yet: neither state is live, and either press creates it. */
export const NotSet: Story = { args: { value: null } };

/** A save is in flight; the control shows what was asked for, lighter. */
export const Busy: Story = { args: { value: false, busy: true } };

/** Without an `onSet` handler the control reads the value and takes no press. */
export const ReadOnly: Story = { args: { value: true, onSet: undefined } };
