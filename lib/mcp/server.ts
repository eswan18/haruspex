import "server-only";
import {
  McpServer,
  requireScopes,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { VUser } from "@/types/db_types";
import { PROP_KINDS } from "@/lib/prop-kind";
import { READ_SCOPE, WRITE_SCOPE } from "./config";
import {
  createPropTool,
  getPropTool,
  listCategoriesTool,
  listCompetitionsTool,
  listPropsTool,
  listSuggestedPropsTool,
  resolvePropTool,
  type CompetitionResult,
  type PropDetail,
  type PropResult,
  type SuggestionResult,
  type ToolOutcome,
} from "./tools";

/**
 * The MCP surface: six tools over lib/mcp/tools, built fresh per request for
 * the caller the gate (lib/mcp/auth) already verified.
 *
 * Scope is enforced twice. Each tool's `scopeChallenge` makes the SDK answer
 * HTTP 403 `insufficient_scope` before the tool runs -- the shape that makes
 * Claude ask for more scope -- and the write tools also check the token's
 * scopes themselves, so a gap in the SDK's challenge cannot become a write.
 */

const readScope = requireScopes(READ_SCOPE);
const writeScope = requireScopes(WRITE_SCOPE);

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

// --- shared schemas -------------------------------------------------------

/** An id, or a name matched case-insensitively. */
const idOrName = z.union([z.number().int(), z.string().min(1)]);

/** With an offset: an offset-less time would be read in the server's zone. */
const deadline = z.iso.datetime({ offset: true });

const named = z.object({ id: z.number().int(), name: z.string() });

const propStatus = z.enum(["open", "closed", "resolved", "voided"]);

const propResult = z.object({
  id: z.number().int(),
  text: z.string(),
  kind: z.enum(PROP_KINDS),
  options: z.array(
    z.object({
      id: z.number().int(),
      text: z.string(),
      outcome: z.boolean().nullable(),
      your_probability: z.number().nullable(),
    }),
  ),
  competition: named.nullable(),
  personal: z.boolean(),
  category: named.nullable(),
  forecasts_due_date: z.string().nullable(),
  resolution_due_date: z.string().nullable(),
  status: propStatus,
  resolution: z.boolean().nullable(),
});

const propDetail = propResult.extend({
  notes: z.string().nullable(),
  resolution_notes: z.string().nullable(),
  your_forecast: z.number().nullable(),
});

const competitionResult = z.object({
  id: z.number().int(),
  name: z.string(),
  is_private: z.boolean(),
  status: z.enum([
    "upcoming",
    "forecasts-open",
    "forecasts-closed",
    "ended",
    // A private competition has no dates of its own; its deadlines are per prop.
    "private",
  ]),
  forecasts_open_date: z.string().nullable(),
  forecasts_close_date: z.string().nullable(),
  end_date: z.string().nullable(),
  your_role: z.enum(["admin", "forecaster"]).nullable(),
  can_add_props: z.boolean(),
});

const suggestionStatus = z.enum(["undecided", "accepted", "rejected"]);

const suggestionResult = z.object({
  id: z.number().int(),
  text: z.string(),
  notes: z.string().nullable(),
  suggested_by: z.object({
    id: z.number().int(),
    name: z.string(),
    email: z.string(),
  }),
  suggested_at: z.string(),
  status: suggestionStatus,
  decided_at: z.string().nullable(),
  decided_by: z.string().nullable(),
});

/**
 * The output schemas restate lib/mcp/tools' result types, and the SDK rejects
 * any result that does not match its schema -- so a drift between the two
 * (a competition status the schema does not list) makes the tool fail for
 * every caller. These fail the type check instead.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemasMatchResultTypes: {
  competition: Same<z.infer<typeof competitionResult>, CompetitionResult>;
  prop: Same<z.infer<typeof propResult>, PropResult>;
  detail: Same<z.infer<typeof propDetail>, PropDetail>;
  suggestion: Same<z.infer<typeof suggestionResult>, SuggestionResult>;
} = { competition: true, prop: true, detail: true, suggestion: true };
void schemasMatchResultTypes;

// --- result mapping -------------------------------------------------------

function toResult<T extends Record<string, unknown>>(
  outcome: ToolOutcome<T>,
): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: outcome.error }] };
  }
  // The data goes in the text content too, as JSON: the spec asks servers
  // that return structuredContent to, and some clients (Claude among them)
  // hand the model only the text, so without it the model sees just the
  // summary line.
  return {
    structuredContent: outcome.data,
    content: [
      { type: "text", text: outcome.summary },
      { type: "text", text: JSON.stringify(outcome.data) },
    ],
  };
}

/** The backstop for the write tools' scope challenge. */
function lacksWriteScope(ctx: ServerContext): CallToolResult | null {
  if (ctx.http?.authInfo?.scopes.includes(WRITE_SCOPE)) return null;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `This needs the ${WRITE_SCOPE} scope. Reconnect and grant it.`,
      },
    ],
  };
}

export function buildMcpServer(caller: VUser): McpServer {
  const server = new McpServer({ name: "haruspex", version: "1.0.0" });

  server.registerTool(
    "list_competitions",
    {
      title: "List competitions",
      description:
        "List the forecasting competitions (seasons) you can see, with each one's status, deadlines, your role in it, and whether you can add props to it (can_add_props).",
      inputSchema: z.object({}),
      outputSchema: z.object({ competitions: z.array(competitionResult) }),
      annotations: READ_ONLY,
      scopeChallenge: readScope,
    },
    async () => toResult(await listCompetitionsTool(caller, {})),
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description:
        "List the categories a prop can be filed under, by id and name.",
      inputSchema: z.object({}),
      outputSchema: z.object({ categories: z.array(named) }),
      annotations: READ_ONLY,
      scopeChallenge: readScope,
    },
    async () => toResult(await listCategoriesTool(caller, {})),
  );

  server.registerTool(
    "list_props",
    {
      title: "List props",
      description:
        "List props (forecasting questions) you can see, newest first: those in one competition, or your personal props, or all of them. Filter by status (open for forecasts, closed awaiting resolution, resolved, or voided). truncated is true when more matched than limit (default 50).",
      inputSchema: z.object({
        competition: idOrName
          .optional()
          .describe("A competition id or name. Omit for every competition."),
        personal: z
          .boolean()
          .optional()
          .describe("true for only your personal props. Not with competition."),
        status: propStatus.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      outputSchema: z.object({
        props: z.array(propResult),
        truncated: z.boolean(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readScope,
    },
    async (args) => toResult(await listPropsTool(caller, args)),
  );

  server.registerTool(
    "get_prop",
    {
      title: "Get a prop",
      description:
        "One prop in full: its options, deadlines, status, resolution and resolution notes (how it was settled, or why it was voided), notes, and your own forecast.",
      inputSchema: z.object({ prop_id: z.number().int() }),
      outputSchema: propDetail,
      annotations: READ_ONLY,
      scopeChallenge: readScope,
    },
    async (args) => toResult(await getPropTool(caller, args)),
  );

  server.registerTool(
    "create_prop",
    {
      title: "Create a prop",
      description:
        "Create a prop: in a competition where you can add props (see can_add_props in list_competitions), or a personal prop of your own (personal: true). kind is binary (yes/no, the default), one_of (exactly one option comes true) or any_of (any number can); the choice kinds need options. Deadlines are ISO 8601 with a UTC offset (e.g. 2027-01-31T23:59:00-05:00). A prop in a private competition needs both forecasts_due_date and resolution_due_date; a public competition's props follow the competition's own dates and need a category. Text is at least 8 characters. notify_members emails the competition's members about the new prop.",
      inputSchema: z.object({
        text: z.string().min(1),
        kind: z.enum(PROP_KINDS).optional(),
        options: z.array(z.string().min(1)).optional(),
        competition: idOrName.optional(),
        personal: z.boolean().optional(),
        category: idOrName.optional(),
        forecasts_due_date: deadline.optional(),
        resolution_due_date: deadline.optional(),
        notes: z.string().optional(),
        notify_members: z.boolean().optional(),
      }),
      outputSchema: propDetail,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      scopeChallenge: writeScope,
    },
    async (args, ctx) =>
      lacksWriteScope(ctx) ?? toResult(await createPropTool(caller, args)),
  );

  server.registerTool(
    "resolve_prop",
    {
      title: "Resolve a prop",
      description:
        "Record how a prop turned out: resolution (true/false) for a binary prop, or outcomes (one per option) for a choice prop. Pass voided: true instead, with neither, when the prop's own terms void it (a condition it depended on did not hold) or it cannot be answered; say why in notes. A voided prop is scored for nobody. A prop that is already resolved or voided is left alone unless overwrite is true.",
      inputSchema: z.object({
        prop_id: z.number().int(),
        resolution: z.boolean().optional(),
        outcomes: z
          .array(
            z.object({ option_id: z.number().int(), outcome: z.boolean() }),
          )
          .optional(),
        voided: z.boolean().optional(),
        notes: z.string().optional(),
        overwrite: z.boolean().optional(),
      }),
      outputSchema: propDetail,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      scopeChallenge: writeScope,
    },
    async (args, ctx) =>
      lacksWriteScope(ctx) ?? toResult(await resolvePropTool(caller, args)),
  );

  // Site admins only: everyone else's agent never sees the tool, and the core
  // refuses them anyway.
  if (caller.is_admin) {
    server.registerTool(
      "list_suggested_props",
      {
        title: "List suggested props",
        description:
          "Site admins only. List props readers have suggested, newest first, with who suggested each and any notes on how to settle it. By default only the undecided ones (the review queue); pass status to see accepted, rejected, or all. truncated is true when more matched than limit (default 50).",
        inputSchema: z.object({
          status: z
            .enum(["undecided", "accepted", "rejected", "all"])
            .optional()
            .describe("Which suggestions to list. Default: undecided."),
          limit: z.number().int().min(1).max(200).optional(),
        }),
        outputSchema: z.object({
          suggestions: z.array(suggestionResult),
          truncated: z.boolean(),
        }),
        annotations: READ_ONLY,
        scopeChallenge: readScope,
      },
      async (args) => toResult(await listSuggestedPropsTool(caller, args)),
    );
  }

  return server;
}
