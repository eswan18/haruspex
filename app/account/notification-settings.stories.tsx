import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { sheetCss } from "@/components/prop-list/sheet";
import { toggleCss } from "@/components/setting-toggle/setting-toggle";

import { NotificationList, notifyCss } from "./notification-settings";

/** The account sheet's stock, so the rows are seen on the paper they print on. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{ __html: sheetCss + notifyCss + toggleCss }}
      />
      <div className="col" style={{ paddingTop: "3rem" }}>
        <h2 className="kicker">
          <span>Notifications</span>
        </h2>
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "Account/NotificationList",
  component: NotificationList,
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
    values: {
      "competition.member_added": true,
      "competition.prop_added": true,
    },
    onSet: fn(),
  },
} satisfies Meta<typeof NotificationList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What a reader who has never touched this sees: the registry's defaults. */
export const Defaults: Story = {};

export const OneTurnedOff: Story = {
  args: {
    values: {
      "competition.member_added": true,
      "competition.prop_added": false,
    },
  },
};

/** A save is in flight: that switch reads what was asked for, lighter. */
export const Saving: Story = {
  args: {
    values: {
      "competition.member_added": true,
      "competition.prop_added": false,
    },
    busy: "competition.prop_added",
  },
};

/** Without a handler the rows print the settings and take no press. */
export const ReadOnly: Story = { args: { onSet: undefined } };
