import type { CompetitionViewData, Standing } from "./types";

/** Fixed so stories and screenshots don't drift day to day. */
export const NOW = new Date("2026-09-02T12:00:00Z");

const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const field: Standing[] = [
  { userId: 1, userName: "Akshay Rangesh", score: 0.101, incomplete: false },
  { userId: 2, userName: "Carly Fiorina", score: 0.187, incomplete: false },
  { userId: 3, userName: "Greg Moore", score: 0.22, incomplete: false },
  { userId: 4, userName: "A. Lindqvist", score: 0.231, incomplete: false },
  { userId: 9, userName: "Ethan Swan", score: 0.24, incomplete: false },
  { userId: 5, userName: "T. Mbeki", score: 0.251, incomplete: false },
  { userId: 6, userName: "M. Calder", score: 0.263, incomplete: false },
  { userId: 7, userName: "R. Okonkwo", score: 0.279, incomplete: false },
  { userId: 8, userName: "J. Vance", score: 0.301, incomplete: false },
  { userId: 10, userName: "P. Nakamura", score: 0.144, incomplete: true },
];

const owed = [
  {
    propId: 101,
    propText:
      "Cursor raises a funding round at, or completes an IPO at, a valuation of $30 billion or above.",
    deadline: day(3),
    hasUserForecast: false,
  },
  {
    propId: 102,
    propText: "A European country wins the 2026 FIFA Men's World Cup.",
    deadline: day(11),
    hasUserForecast: false,
  },
  {
    propId: 103,
    propText:
      "The U.S. Men's National Team reaches the Quarterfinals (or beyond) of the 2026 FIFA World Cup.",
    deadline: day(11),
    hasUserForecast: false,
  },
  {
    propId: 104,
    propText:
      "Keir Starmer is the prime minister of the UK at the end of 2026.",
    deadline: day(40),
    hasUserForecast: false,
  },
  {
    propId: 105,
    propText: "Bitcoin closes the year above $150,000.",
    deadline: day(40),
    hasUserForecast: false,
  },
  {
    propId: 106,
    propText: "SpaceX flies Starship to orbit and back with a crew aboard.",
    deadline: null,
    hasUserForecast: false,
  },
];

export const CURRENT_USER_ID = 9;

/** Mid-season: some results in, some props still owed. The common case. */
export const midSeason: CompetitionViewData = {
  id: 6,
  name: "2026 Open",
  isPrivate: false,
  phase: "live",
  state: "open" as const,
  fieldSize: 14,
  counts: { toForecast: 6, open: 11, unresolved: 4, resolved: 17, total: 32 },
  you: { rank: 5, score: 0.24, incomplete: false },
  owed,
  standings: field,
};

/** Just opened: props to forecast, nothing resolved, no scores to show. */
export const preSeason: CompetitionViewData = {
  ...midSeason,
  name: "2027 Open",
  counts: { toForecast: 9, open: 12, unresolved: 0, resolved: 0, total: 12 },
  you: null,
  standings: [],
};

/** Forecasting shut, results still landing. Scores move but nothing is owed. */
export const scoringSeason: CompetitionViewData = {
  ...midSeason,
  phase: "scoring",
  state: "scoring" as const,
  counts: { toForecast: 0, open: 0, unresolved: 6, resolved: 26, total: 32 },
  owed: [],
};

/** Over. Every prop settled. */
export const finalSeason: CompetitionViewData = {
  ...midSeason,
  name: "2025 Open",
  phase: "final",
  state: "final" as const,
  counts: { toForecast: 0, open: 0, unresolved: 0, resolved: 32, total: 32 },
  owed: [],
};

/** A small private group, where the field is a handful of people. */
export const privateSeason: CompetitionViewData = {
  ...midSeason,
  id: 12,
  name: "Anna & Ethan",
  isPrivate: true,
  fieldSize: 2,
  counts: { toForecast: 2, open: 5, unresolved: 1, resolved: 8, total: 14 },
  you: { rank: 2, score: 0.171, incomplete: false },
  owed: owed.slice(0, 2),
  standings: [
    {
      userId: 11,
      userName: "Annaluisa Kambas",
      score: 0.043,
      incomplete: false,
    },
    { userId: 9, userName: "Ethan Swan", score: 0.171, incomplete: false },
  ],
};

/**
 * A private competition with nothing in it yet — the state that had no way
 * forward. Every other link to the new-prop form sits behind a non-empty prop
 * list, so its own admin could not write the first one.
 */
export const emptyPrivateSeason: CompetitionViewData = {
  ...privateSeason,
  id: 13,
  name: "New Group",
  counts: { toForecast: 0, open: 0, unresolved: 0, resolved: 0, total: 0 },
  you: null,
  owed: [],
  standings: [],
};
