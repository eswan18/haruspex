import "server-only";

import type { NewProp, VUser } from "@/types/db_types";
import { getCompetitionStatusFromObject } from "@/lib/competition-status";
import type { CompetitionStatus } from "@/lib/competition-status";
import {
  listCompetitions,
  type CompetitionWithRole,
} from "@/lib/core/competitions";
import { listCategories } from "@/lib/core/categories";
import { listSuggestedProps } from "@/lib/core/suggested-props";
import {
  createProp,
  getProp,
  listProps,
  resolveProp,
  type PropWithOptions,
} from "@/lib/core/props";
import { getPropStatusFromProp } from "@/lib/prop-status";
import type { PropKind } from "@/lib/prop-kind";
import type { ServerActionResultWithValidation } from "@/lib/server-action-result";
import { resolveCategory, resolveCompetition } from "./names";

/** What a tool hands back: data, plus a one-line summary to sit beside it. */
export type ToolOutcome<T> =
  { ok: true; data: T; summary: string } | { ok: false; error: string };

export type CompetitionResult = {
  id: number;
  name: string;
  is_private: boolean;
  status: CompetitionStatus;
  forecasts_open_date: string | null;
  forecasts_close_date: string | null;
  end_date: string | null;
  your_role: "admin" | "forecaster" | null;
  can_add_props: boolean;
};

export type PropResult = {
  id: number;
  text: string;
  kind: PropKind;
  options: {
    id: number;
    text: string;
    outcome: boolean | null;
    your_probability: number | null;
  }[];
  competition: { id: number; name: string } | null;
  personal: boolean;
  category: { id: number; name: string } | null;
  forecasts_due_date: string | null;
  resolution_due_date: string | null;
  status: "open" | "closed" | "resolved";
  resolution: boolean | null;
};

export type PropDetail = PropResult & {
  notes: string | null;
  your_forecast: number | null;
};

export type SuggestionStatus = "undecided" | "accepted" | "rejected";

export type SuggestionResult = {
  id: number;
  text: string;
  notes: string | null;
  suggested_by: { id: number; name: string; email: string };
  suggested_at: string;
  status: SuggestionStatus;
  decided_at: string | null;
  decided_by: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

const iso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

/** A core failure as agent-facing text, naming each invalid field. */
function describeFailure(
  result: Extract<ServerActionResultWithValidation<never>, { success: false }>,
): string {
  const fields = Object.entries(result.validationErrors ?? {}).flatMap(
    ([field, messages]) => messages.map((message) => `${field}: ${message}`),
  );
  return fields.length > 0 ? fields.join("; ") : result.error;
}

function competitionResult(c: CompetitionWithRole): CompetitionResult {
  return {
    id: c.id,
    name: c.name,
    is_private: c.is_private,
    status: getCompetitionStatusFromObject(c),
    forecasts_open_date: iso(c.forecasts_open_date),
    forecasts_close_date: iso(c.forecasts_close_date),
    end_date: iso(c.end_date),
    your_role: c.role,
    can_add_props: c.can_add_props,
  };
}

type PropRow = Omit<PropWithOptions, "options"> &
  Partial<Pick<PropWithOptions, "options">>;

function propStatus(prop: PropRow): PropResult["status"] {
  const status = getPropStatusFromProp(prop);
  if (status === "open") return "open";
  return status === "unresolved" ? "closed" : "resolved";
}

function propResult(prop: PropRow): PropResult {
  return {
    id: prop.prop_id,
    text: prop.prop_text,
    kind: prop.prop_kind,
    options: (prop.options ?? []).map((o) => ({
      id: o.option_id,
      text: o.text,
      outcome: o.outcome,
      your_probability: o.user_forecast,
    })),
    competition:
      prop.competition_id === null
        ? null
        : { id: prop.competition_id, name: prop.competition_name ?? "" },
    personal: prop.prop_user_id !== null,
    category:
      prop.category_id === null
        ? null
        : { id: prop.category_id, name: prop.category_name ?? "" },
    forecasts_due_date: iso(prop.prop_forecasts_due_date),
    resolution_due_date: iso(prop.prop_resolution_due_date),
    status: propStatus(prop),
    resolution: prop.resolution,
  };
}

function propDetail(
  prop: PropWithOptions & { user_forecast?: number | null },
): PropDetail {
  return {
    ...propResult(prop),
    notes: prop.prop_notes,
    your_forecast: prop.user_forecast ?? null,
  };
}

const noProp = (id: number) => `No prop ${id} (or not one you can see)`;

/** One prop as the caller sees it (member view, with their forecast). */
async function readPropDetail(
  caller: VUser,
  propId: number,
): Promise<{ ok: true; detail: PropDetail } | { ok: false; error: string }> {
  const result = await getProp(caller, propId, {
    view: "member",
    withUserForecast: true,
  });
  if (!result.success) return fail(result.error);
  if (!result.data) return fail(noProp(propId));
  return { ok: true, detail: propDetail(result.data) };
}

export async function listCompetitionsTool(
  caller: VUser,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the tool shape takes {}
  _args: Record<string, never> = {},
): Promise<ToolOutcome<{ competitions: CompetitionResult[] }>> {
  const result = await listCompetitions(caller, { view: "member" });
  if (!result.success) return fail(result.error);
  const competitions = result.data.map(competitionResult);
  return {
    ok: true,
    data: { competitions },
    summary: `${competitions.length} competition(s)`,
  };
}

export async function listCategoriesTool(
  caller: VUser,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the tool shape takes {}
  _args: Record<string, never> = {},
): Promise<ToolOutcome<{ categories: { id: number; name: string }[] }>> {
  const result = await listCategories(caller);
  if (!result.success) return fail(result.error);
  const categories = result.data.map((c) => ({ id: c.id, name: c.name }));
  return {
    ok: true,
    data: { categories },
    summary: `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
  };
}

export async function listPropsTool(
  caller: VUser,
  args: {
    competition?: number | string;
    personal?: boolean;
    status?: "open" | "closed" | "resolved";
    limit?: number;
  },
): Promise<ToolOutcome<{ props: PropResult[]; truncated: boolean }>> {
  if (args.competition !== undefined && args.personal) {
    return fail(
      "Pass either competition or personal: true, not both. Personal props belong to no competition.",
    );
  }
  const limit = Math.min(
    Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );

  let competitionId: number | null | undefined;
  if (args.competition !== undefined) {
    const found = await resolveCompetition(caller, args.competition);
    if (!found.ok) return fail(found.error);
    competitionId = found.competition.id;
  } else if (args.personal) {
    competitionId = null;
  }

  const result = await listProps(caller, {
    competitionId,
    userId: args.personal ? caller.id : undefined,
    view: "member",
  });
  if (!result.success) return fail(result.error);

  const matching = result.data
    .map(propResult)
    .filter((p) => args.status === undefined || p.status === args.status)
    .sort((a, b) => b.id - a.id);
  const props = matching.slice(0, limit);
  const truncated = matching.length > limit;
  return {
    ok: true,
    data: { props, truncated },
    summary: truncated
      ? `${props.length} props (newest first); more exist, narrow the filter or raise limit`
      : `${props.length} prop(s)`,
  };
}

export async function getPropTool(
  caller: VUser,
  args: { prop_id: number },
): Promise<ToolOutcome<PropDetail>> {
  const read = await readPropDetail(caller, args.prop_id);
  if (!read.ok) return fail(read.error);
  return {
    ok: true,
    data: read.detail,
    summary: `Prop ${read.detail.id} (${read.detail.status})`,
  };
}

function parseDate(
  field: string,
  value: string | undefined,
): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, date: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fail(
      `${field}: "${value}" is not a date. Use ISO 8601, e.g. 2027-01-31T23:59:00-05:00.`,
    );
  }
  return { ok: true, date };
}

export async function createPropTool(
  caller: VUser,
  args: {
    text: string;
    kind?: PropKind;
    options?: string[];
    competition?: number | string;
    personal?: boolean;
    category?: number | string;
    forecasts_due_date?: string;
    resolution_due_date?: string;
    notes?: string;
    notify_members?: boolean;
  },
): Promise<ToolOutcome<PropDetail>> {
  const hasCompetition = args.competition !== undefined;
  if (hasCompetition === !!args.personal) {
    return fail(
      "Say where the prop goes: pass either competition (an id or name) or personal: true, not both and not neither.",
    );
  }

  let competition: CompetitionWithRole | null = null;
  if (args.competition !== undefined) {
    const found = await resolveCompetition(caller, args.competition);
    if (!found.ok) return fail(found.error);
    competition = found.competition;
    if (!competition.can_add_props) {
      return fail(
        `You are not allowed to add props to "${competition.name}": ${
          competition.is_private
            ? "only its admins can"
            : "only site admins can add to a public season"
        }. Use list_competitions to see where can_add_props is true, or pass personal: true.`,
      );
    }
  }

  let categoryId: number | null = null;
  if (args.category !== undefined) {
    const found = await resolveCategory(caller, args.category);
    if (!found.ok) return fail(found.error);
    categoryId = found.category.id;
  }

  const forecastsDue = parseDate("forecasts_due_date", args.forecasts_due_date);
  if (!forecastsDue.ok) return fail(forecastsDue.error);
  const resolutionDue = parseDate(
    "resolution_due_date",
    args.resolution_due_date,
  );
  if (!resolutionDue.ok) return fail(resolutionDue.error);

  const prop: NewProp = {
    text: args.text,
    kind: args.kind ?? "binary",
    category_id: categoryId,
    competition_id: competition?.id ?? null,
    user_id: args.personal ? caller.id : null,
    notes: args.notes ?? null,
    forecasts_due_date: forecastsDue.date,
    resolution_due_date: resolutionDue.date,
    created_by_user_id: caller.id,
  };

  const created = await createProp(caller, {
    prop,
    options: args.options,
    notifyMembers: args.notify_members === true,
  });
  if (!created.success) return fail(describeFailure(created));

  const read = await readPropDetail(caller, created.data.propId);
  if (!read.ok) return fail(read.error);
  return {
    ok: true,
    data: read.detail,
    summary: `Created prop ${read.detail.id}`,
  };
}

export async function resolvePropTool(
  caller: VUser,
  args: {
    prop_id: number;
    resolution?: boolean;
    outcomes?: { option_id: number; outcome: boolean }[];
    notes?: string;
    overwrite?: boolean;
  },
): Promise<ToolOutcome<PropDetail>> {
  // Resolve only what the caller can see in the member view, so a site admin
  // cannot reach another user's personal prop through here.
  const before = await readPropDetail(caller, args.prop_id);
  if (!before.ok) return fail(before.error);

  const resolved = await resolveProp(caller, {
    propId: args.prop_id,
    resolution: args.resolution,
    outcomes: args.outcomes?.map((o) => ({
      optionId: o.option_id,
      outcome: o.outcome,
    })),
    notes: args.notes,
    overwrite: args.overwrite,
  });
  if (!resolved.success) {
    return fail(
      resolved.error.includes("already has a resolution")
        ? `${resolved.error}. Pass overwrite: true to replace it.`
        : resolved.error,
    );
  }

  const read = await readPropDetail(caller, args.prop_id);
  if (!read.ok) return fail(read.error);
  return {
    ok: true,
    data: read.detail,
    summary: `Resolved prop ${read.detail.id}`,
  };
}

/**
 * The suggestion queue, for a site admin (the core refuses anyone else, and
 * the server only offers the tool to admins). Newest first; the undecided
 * ones unless asked otherwise, since reviewing them is what the list is for.
 */
export async function listSuggestedPropsTool(
  caller: VUser,
  args: { status?: SuggestionStatus | "all"; limit?: number } = {},
): Promise<
  ToolOutcome<{ suggestions: SuggestionResult[]; truncated: boolean }>
> {
  const result = await listSuggestedProps(caller);
  if (!result.success) return fail(result.error);

  const wanted = args.status ?? "undecided";
  const limit = Math.min(
    Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const matching = result.data
    .map((s): SuggestionResult => ({
      id: s.id,
      text: s.prop_text,
      notes: s.notes,
      suggested_by: { id: s.user_id, name: s.user_name, email: s.user_email },
      suggested_at: s.created_at.toISOString(),
      status: s.status ?? "undecided",
      decided_at: iso(s.decided_at),
      decided_by: s.decided_by_name,
    }))
    .filter((s) => wanted === "all" || s.status === wanted)
    .sort(
      (a, b) => b.suggested_at.localeCompare(a.suggested_at) || b.id - a.id,
    );
  const suggestions = matching.slice(0, limit);

  return {
    ok: true,
    data: { suggestions, truncated: matching.length > suggestions.length },
    summary: `${suggestions.length} ${wanted === "all" ? "" : `${wanted} `}suggestion(s)${matching.length > suggestions.length ? ` of ${matching.length}` : ""}`,
  };
}
