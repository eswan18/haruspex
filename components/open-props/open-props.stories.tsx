import type { Meta, StoryObj } from "@storybook/react-vite";

import type { PropWithUserForecast } from "@/types/db_types";

import { OpenProps } from "./open-props";

const day = (n: number) => new Date(Date.UTC(2026, 8, 2) + n * 86_400_000);

const base = {
  prop_notes: null,
  prop_kind: "binary" as const,
  prop_user_id: null,
  prop_created_by_user_id: 1,
  prop_forecasts_due_date: day(6),
  prop_resolution_due_date: day(120),
  competition_id: 6,
  competition_name: "2026 Open",
  competition_is_private: false,
  competition_forecasts_close_date: day(6),
  competition_forecasts_open_date: day(-120),
  category_id: 1,
  resolution_id: null,
  resolution: null,
  resolution_user_id: null,
  resolution_voided: null,
  resolution_notes: null,
  user_forecast_id: null,
  user_forecast: null,
  community_average: null,
  options: [],
};

const props: PropWithUserForecast[] = [
  {
    ...base,
    prop_id: 1,
    prop_text: "Bitcoin closes the year above $150,000.",
    prop_notes:
      "Settled on the closing price reported by Coinbase at 00:00 UTC on 1 January 2027.",
    category_name: "Economics",
    user_forecast: 0.3,
    user_forecast_id: 900,
    community_average: 0.46,
  },
  {
    ...base,
    prop_id: 2,
    prop_text: "A European country wins the 2026 FIFA Men's World Cup.",
    category_name: "Sports",
    community_average: 0.64,
  },
  {
    ...base,
    prop_id: 3,
    prop_text:
      "Keir Starmer is the prime minister of the UK at the end of 2026.",
    category_name: "World politics",
    user_forecast: 0.72,
    user_forecast_id: 901,
    community_average: 0.58,
  },
  {
    ...base,
    prop_id: 4,
    prop_kind: "one_of",
    prop_text: "Which party holds the most seats after the next UK election?",
    category_name: "World politics",
    options: [
      {
        option_id: 1,
        text: "Labour",
        position: 0,
        outcome: null,
        user_forecast: null,
        community_average: 0.51,
      },
      {
        option_id: 2,
        text: "Conservative",
        position: 1,
        outcome: null,
        user_forecast: null,
        community_average: 0.24,
      },
      {
        option_id: 3,
        text: "Reform UK",
        position: 2,
        outcome: null,
        user_forecast: null,
        community_average: 0.25,
      },
    ],
  },
  {
    ...base,
    prop_id: 5,
    prop_text: "The S&P 500 closes the year higher than it began.",
    category_name: "Economics",
    community_average: 0.71,
  },
];

const meta = {
  title: "Competition/OpenProps",
  component: OpenProps,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof OpenProps>;

export default meta;
type Story = StoryObj<typeof meta>;

const shared = {
  title: "2026 Open",
  backHref: "/competitions/6",
  currentUserId: 4,
  onSaved: () => {},
};

/** The default view: only what is still unanswered. */
export const Default: Story = { args: { ...shared, props } };

/** An admin can also open the edit dialog from a row. */
export const AsAdmin: Story = {
  args: { ...shared, props, isAdmin: true },
};

/** Everything answered. */
export const AllDone: Story = {
  args: {
    ...shared,
    props: props.map((p) => ({
      ...p,
      user_forecast_id: 900,
      user_forecast: 0.4,
    })),
  },
};

export const Empty: Story = { args: { ...shared, props: [] } };

/** A prop of your own: no competition, so its own deadline is the only one. */
const mine = {
  ...base,
  competition_id: null,
  competition_name: null,
  competition_is_private: null,
  competition_forecasts_close_date: null,
  competition_forecasts_open_date: null,
  prop_user_id: 4,
};

/**
 * The same list standing on its own: a reader's personal props belong to no
 * competition, so there is no overview to go back to — only a way to write
 * another one.
 *
 * A personal list also holds props at every stage of their life, so its filter
 * bar cuts by stage rather than by whether the reader has forecasted yet, and
 * it opens on all of them.
 */
export const Personal: Story = {
  args: {
    props: [
      ...props,
      {
        ...mine,
        prop_id: 90,
        prop_text: "I ship the redesign before the end of the quarter.",
        category_name: "Work",
        prop_forecasts_due_date: day(-30),
        user_forecast_id: 501,
        user_forecast: 0.62,
      },
      {
        ...mine,
        prop_id: 91,
        prop_text: "I read twelve books this year.",
        category_name: "Life",
        prop_forecasts_due_date: day(-90),
        resolution_id: 44,
        resolution: false,
        resolution_voided: false,
        user_forecast_id: 502,
        user_forecast: 0.8,
      },
    ],
    title: "Your props",
    kicker: "Personal props",
    tabs: "stage",
    newHref: "/props/new",
    currentUserId: 4,
    isAdmin: true,
    onSaved: () => {},
  },
};
