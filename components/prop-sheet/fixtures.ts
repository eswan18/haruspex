import type { PropWithUserForecast } from "@/types/db_types";

import type { FieldEntry } from "./build";

export const CURRENT_USER_ID = 4;

const day = (n: number) => new Date(Date.UTC(2026, 8, 2) + n * 86_400_000);

const basePropRow = {
  prop_id: 41,
  prop_text: "Bitcoin closes the year above $150,000.",
  prop_notes:
    "Settled on the closing price reported by Coinbase at 00:00 UTC on 1 January 2027.",
  prop_kind: "binary" as const,
  prop_user_id: null,
  prop_created_by_user_id: 1,
  category_id: 4,
  category_name: "Economics",
  competition_id: 6,
  competition_name: "2026 Open",
  competition_is_private: false,
  competition_forecasts_open_date: day(-120),
  resolution_user_id: null,
  resolution_voided: null,
  user_forecast: 0.3,
  user_forecast_id: 900,
  community_average: 0.46,
  options: [],
};

/** Still forecastable: the deadline has not passed. */
export const openProp: PropWithUserForecast = {
  ...basePropRow,
  prop_forecasts_due_date: day(6),
  prop_resolution_due_date: day(120),
  competition_forecasts_close_date: day(6),
  resolution_id: null,
  resolution: null,
  resolution_notes: null,
};

/** Past the deadline, no result yet. */
export const closedProp: PropWithUserForecast = {
  ...basePropRow,
  prop_forecasts_due_date: day(-9),
  prop_resolution_due_date: day(40),
  competition_forecasts_close_date: day(-9),
  resolution_id: null,
  resolution: null,
  resolution_notes: null,
};

/** Resolved yes, so every mark carries a tail to the truth. */
export const resolvedProp: PropWithUserForecast = {
  ...basePropRow,
  prop_forecasts_due_date: day(-60),
  prop_resolution_due_date: day(-2),
  competition_forecasts_close_date: day(-60),
  resolution_id: 7,
  resolution_voided: false,
  resolution: true,
  resolution_notes: "Closed at $163,410 on Coinbase. Resolved **Yes**.",
};

/** Nobody has forecasted, and neither have you. */
export const untouchedProp: PropWithUserForecast = {
  ...openProp,
  user_forecast: null,
  user_forecast_id: null,
  community_average: null,
};

export const choiceProp: PropWithUserForecast = {
  ...basePropRow,
  prop_id: 42,
  prop_text: "Which party holds the most seats after the next UK election?",
  prop_notes: null,
  prop_kind: "one_of",
  category_name: "World politics",
  prop_forecasts_due_date: day(11),
  prop_resolution_due_date: day(200),
  competition_forecasts_close_date: day(11),
  resolution_id: null,
  resolution: null,
  resolution_notes: null,
  user_forecast: null,
  user_forecast_id: 901,
  community_average: null,
  options: [
    {
      option_id: 1,
      text: "Labour",
      position: 0,
      outcome: null,
      user_forecast: 0.45,
      community_average: 0.51,
    },
    {
      option_id: 2,
      text: "Conservative",
      position: 1,
      outcome: null,
      user_forecast: 0.3,
      community_average: 0.24,
    },
    {
      option_id: 3,
      text: "Reform UK",
      position: 2,
      outcome: null,
      user_forecast: 0.2,
      community_average: 0.19,
    },
    {
      option_id: 4,
      text: "Liberal Democrat",
      position: 3,
      outcome: null,
      user_forecast: 0.05,
      community_average: 0.06,
    },
  ],
};

const names = [
  "Akshay Rangesh",
  "Carly Fiorina",
  "Greg Moore",
  "Ethan Swan",
  "A. Lindqvist",
  "T. Mbeki",
  "M. Calder",
  "R. Okonkwo",
  "J. Vance",
  "P. Nakamura",
  "Lindsay Muth",
  "John Yu",
];
const values = [
  0.88, 0.79, 0.71, 0.3, 0.62, 0.55, 0.5, 0.44, 0.38, 0.31, 0.22, 0.12,
];

/** Twelve forecasts on one prop, yours among them. */
export const field: FieldEntry[] = names
  .map((userName, i) => ({
    forecastId: 900 + i,
    userId: i + 1,
    userName,
    forecast: values[i],
    isYou: i + 1 === CURRENT_USER_ID,
  }))
  .sort((a, b) => b.forecast - a.forecast);
