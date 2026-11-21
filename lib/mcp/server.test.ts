import { afterEach, describe, expect, it, vi } from "vitest";
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
import { callTool } from "../../tests/helpers/mcpCall";

const caller = { id: 7 } as VUser;

afterEach(() => {
  for (const fn of Object.values(tools)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
});

function callWithScopes(
  name: string,
  args: Record<string, unknown>,
  scopes: string[],
) {
  return callTool(buildMcpServer(caller), caller, name, args, scopes);
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
