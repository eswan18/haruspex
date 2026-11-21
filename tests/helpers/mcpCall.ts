import { vi } from "vitest";
import {
  InMemoryTransport,
  type AuthInfo,
  type JSONRPCMessage,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { VUser } from "@/types/db_types";

/** What a client receives from `tools/call`. */
export interface ToolCallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}

/**
 * Calls one tool on `server` the way a client would: initialize, then
 * `tools/call`, over an in-memory transport carrying `authInfo` for `caller`.
 *
 * The transport has no scope-challenge support, so only a tool's own scope
 * check stands between a read-only token and a write. The SDK still validates
 * the result against the tool's output schema, so a result that does not
 * match its schema comes back as an error here, as it would to a client.
 */
export async function callTool(
  server: McpServer,
  caller: VUser,
  name: string,
  args: Record<string, unknown>,
  scopes: string[],
): Promise<ToolCallResult | undefined> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const received: JSONRPCMessage[] = [];
  client.onmessage = (message) => received.push(message);
  await server.connect(serverSide);
  await client.start();

  const authInfo: AuthInfo = {
    token: "t",
    clientId: "claude",
    scopes,
    extra: { caller },
  };
  const reply = (id: number) =>
    vi.waitFor(() => {
      const found = received.find((m) => "id" in m && m.id === id);
      if (!found) throw new Error(`no reply to ${id}`);
      return found as { result?: ToolCallResult };
    });

  await client.send(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    },
    { authInfo },
  );
  await reply(1);
  await client.send(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { authInfo },
  );
  await client.send(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { authInfo },
  );
  const { result } = await reply(2);
  await server.close();
  return result;
}
