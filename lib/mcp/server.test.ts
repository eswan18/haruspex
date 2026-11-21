import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryTransport,
  type AuthInfo,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import type { VUser } from "@/types/db_types";

vi.mock("@/lib/mcp/tools", () => ({
  listCompetitionsTool: vi.fn(),
  listCategoriesTool: vi.fn(),
  listPropsTool: vi.fn(),
  getPropTool: vi.fn(),
  createPropTool: vi.fn(),
  resolvePropTool: vi.fn(),
}));

import * as tools from "./tools";
import { buildMcpServer } from "./server";

const caller = { id: 7 } as VUser;

afterEach(() => {
  for (const fn of Object.values(tools)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
});

/**
 * Calls a tool over a transport with no scope-challenge support, so only the
 * tool's own scope check stands between a read-only token and the write.
 */
async function callWithScopes(
  name: string,
  args: Record<string, unknown>,
  scopes: string[],
) {
  const server = buildMcpServer(caller);
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
      return found as { result?: Record<string, unknown> };
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

describe("buildMcpServer write-scope backstop", () => {
  it("refuses create_prop without haruspex:write even when no challenge ran", async () => {
    const result = await callWithScopes(
      "create_prop",
      { text: "Will it rain?", personal: true },
      ["haruspex:read"],
    );
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain("haruspex:write");
    expect(tools.createPropTool).not.toHaveBeenCalled();
  });

  it("refuses resolve_prop without haruspex:write", async () => {
    const result = await callWithScopes(
      "resolve_prop",
      { prop_id: 1, resolution: true },
      ["haruspex:read"],
    );
    expect(result?.isError).toBe(true);
    expect(tools.resolvePropTool).not.toHaveBeenCalled();
  });

  it("runs create_prop when the token has haruspex:write", async () => {
    vi.mocked(tools.createPropTool).mockResolvedValue({
      ok: false,
      error: "text: Proposition text must be at least 8 characters long",
    });
    const result = await callWithScopes(
      "create_prop",
      { text: "Short", personal: true },
      ["haruspex:write"],
    );
    expect(tools.createPropTool).toHaveBeenCalledWith(caller, {
      text: "Short",
      personal: true,
    });
    expect(result?.isError).toBe(true);
    expect(result?.content).toEqual([
      {
        type: "text",
        text: "text: Proposition text must be at least 8 characters long",
      },
    ]);
  });
});
