import type { Meta, StoryObj } from "@storybook/react-vite";
import { useForm } from "react-hook-form";

import { FormSheet } from "@/components/form-sheet/form-sheet";

import { EmailBodyField } from "./email-body-field";

const draft = `Hello fellow forecasters,

It's the end of October and 2027 is in sight. I'm soliciting ideas for next year's props. **Submit them here: [haruspex.fyi/props/suggest](https://haruspex.fyi/props/suggest)**. To be considered, prop suggestions must be submitted by November 28.

**Forecasts will open December 1 at midnight UTC, and will close January 1 at midnight UTC.** I will send you a reminder before forecasts open.

## New Site Name

I have some other news too. "Forecasting" was a bit too on-the-nose, so I've settled on a much more arcane name for the site: "Haruspex".

## Call for Participants

- Registration is open to anyone.
- Props are visible from December 1.

Thanks,
Ethan`;

/** The field inside the sheet it lives on, with a real form behind it. */
function Harness({
  initiallyPreviewing,
  value,
}: {
  initiallyPreviewing: boolean;
  value: string;
}) {
  const form = useForm({ defaultValues: { body: value } });
  const body = form.watch("body") ?? "";
  return (
    <FormSheet
      title="Send an announcement"
      kicker="Announcement"
      back={{ href: "/admin", label: "Admin" }}
    >
      <form>
        <EmailBodyField
          id="body"
          value={body}
          limit={10_000}
          registration={form.register("body")}
          placeholder="Hello fellow forecasters,"
          initiallyPreviewing={initiallyPreviewing}
        />
      </form>
    </FormSheet>
  );
}

const meta = {
  title: "Admin/EmailBodyField",
  component: Harness,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: { initiallyPreviewing: false, value: draft },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Write: Story = {};

/** The announcement draft, as readers will see it. */
export const Preview: Story = { args: { initiallyPreviewing: true } };

export const EmptyPreview: Story = {
  args: { initiallyPreviewing: true, value: "" },
};
