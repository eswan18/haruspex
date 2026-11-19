import {
  createMcpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";

import type { VUser } from "@/types/db_types";
import { logger } from "@/lib/logger";
import { authenticate } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The MCP endpoint. Every request passes the bearer-token gate first; the SDK
 * only ever sees verified callers. Both protocol eras are served: 2026-07-28
 * requests natively, 2025-era ones statelessly (`legacy: "stateless"`), since
 * clients still send either.
 *
 * No session cookie, no impersonation, no active-day record: an MCP call is
 * the token's own user acting through a client.
 */

function callerFor(ctx: McpRequestContext): VUser {
  const caller = ctx.authInfo?.extra?.caller as VUser | undefined;
  // Unreachable behind the gate, which always sets it.
  if (!caller)
    throw new Error("MCP request reached the server unauthenticated");
  return caller;
}

const handler = createMcpHandler((ctx) => buildMcpServer(callerFor(ctx)), {
  legacy: "stateless",
  onerror: (error) => logger.error("MCP request failed", error),
});

async function serve(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  return handler.fetch(request, { authInfo: auth.authInfo });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
