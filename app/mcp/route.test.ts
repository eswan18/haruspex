import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { VUser } from "@/types/db_types";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The real gate by default (for the 401 test); tests that need a signed-in
// caller replace it per test.
vi.mock("@/lib/mcp/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/auth")>();
  return { ...actual, authenticate: vi.fn(actual.authenticate) };
});

// The tools themselves are tested in lib/mcp; here only the wiring is.
vi.mock("@/lib/mcp/tools", () => ({
  listCompetitionsTool: vi.fn(),
  listCategoriesTool: vi.fn(),
  listPropsTool: vi.fn(),
  getPropTool: vi.fn(),
  createPropTool: vi.fn(),
  resolvePropTool: vi.fn(),
}));

import { authenticate } from "@/lib/mcp/auth";
import * as tools from "@/lib/mcp/tools";
import type { PropDetail } from "@/lib/mcp/tools";
import { DELETE, GET, POST } from "./route";

const RESOURCE = "https://haruspex.fyi/mcp";
const METADATA =
  "https://haruspex.fyi/.well-known/oauth-protected-resource/mcp";
const ISSUER = "https://identity.ethanswan.com";

const caller = { id: 7, idp_user_id: "idp-user-1" } as VUser;

function signedIn(scopes: string[]) {
  const authInfo: AuthInfo = {
    token: "test-token",
    clientId: "claude",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    resource: new URL(RESOURCE),
    resourceMetadataUrl: METADATA,
    extra: { caller },
  };
  vi.mocked(authenticate).mockResolvedValue({ caller, authInfo });
}

const prop: PropDetail = {
  id: 42,
  text: "Will it rain?",
  kind: "binary",
  options: [],
  competition: null,
  personal: true,
  category: null,
  forecasts_due_date: null,
  resolution_due_date: null,
  status: "open",
  resolution: null,
  notes: null,
  your_forecast: null,
};

/** Every HTTP response the route gave, newest last. */
let responses: Response[] = [];

async function routeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const handler = { POST, GET, DELETE }[request.method as "POST"];
  const response = handler
    ? await handler(request)
    : new Response(null, { status: 405 });
  responses.push(response.clone());
  return response;
}

async function connect(mode: "modern" | "legacy"): Promise<Client> {
  const client = new Client(
    { name: "route-test", version: "1.0.0" },
    mode === "modern"
      ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      fetch: routeFetch,
      onInsufficientScope: "throw",
    }),
  );
  return client;
}

/** A bare 2025-11-25 JSON-RPC POST, with no initialize first. */
function legacyCall(name: string, args: Record<string, unknown>) {
  return POST(
    new Request(RESOURCE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
}

beforeEach(() => {
  responses = [];
  vi.stubEnv("MCP_RESOURCE_URL", RESOURCE);
  vi.stubEnv("IDP_PUBLIC_URL", ISSUER);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  const actual =
    await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  vi.mocked(authenticate).mockReset();
  vi.mocked(authenticate).mockImplementation(actual.authenticate);
  for (const fn of Object.values(tools)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
});

describe("/mcp without a token", () => {
  it("answers POST with 401 and the sign-in challenge", async () => {
    const res = await POST(
      new Request(RESOURCE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${METADATA}", scope="haruspex:read haruspex:write"`,
    );
  });

  it("answers GET and DELETE with 401 too", async () => {
    for (const handler of [GET, DELETE]) {
      const res = await handler(new Request(RESOURCE));
      expect(res.status).toBe(401);
    }
  });
});

describe.each(["modern", "legacy"] as const)(
  "/mcp with a read-only caller (%s client)",
  (mode) => {
    beforeEach(() => signedIn(["haruspex:read"]));

    it("lists exactly the six tools, reads marked read-only", async () => {
      const client = await connect(mode);
      const { tools: listed } = await client.listTools();
      expect(listed.map((t) => t.name).sort()).toEqual([
        "create_prop",
        "get_prop",
        "list_categories",
        "list_competitions",
        "list_props",
        "resolve_prop",
      ]);
      const readOnly = Object.fromEntries(
        listed.map((t) => [t.name, t.annotations?.readOnlyHint === true]),
      );
      expect(readOnly).toEqual({
        list_competitions: true,
        list_categories: true,
        list_props: true,
        get_prop: true,
        create_prop: false,
        resolve_prop: false,
      });
      const create = listed.find((t) => t.name === "create_prop");
      expect(create?.description).toMatch(/private/i);
      await client.close();
    });

    it("returns list_categories as structured content, called as the caller", async () => {
      vi.mocked(tools.listCategoriesTool).mockResolvedValue({
        ok: true,
        data: { categories: [{ id: 1, name: "Politics" }] },
        summary: "1 category",
      });
      const client = await connect(mode);
      const result = await client.callTool({
        name: "list_categories",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        categories: [{ id: 1, name: "Politics" }],
      });
      expect(result.content).toEqual([{ type: "text", text: "1 category" }]);
      expect(tools.listCategoriesTool).toHaveBeenCalledWith(caller, {});
      await client.close();
    });

    it("turns a tool failure into an isError result", async () => {
      vi.mocked(tools.getPropTool).mockResolvedValue({
        ok: false,
        error: "No prop 9 (or not one you can see)",
      });
      const client = await connect(mode);
      const result = await client.callTool({
        name: "get_prop",
        arguments: { prop_id: 9 },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "No prop 9 (or not one you can see)" },
      ]);
      await client.close();
    });

    it("refuses create_prop with HTTP 403 insufficient_scope for haruspex:write", async () => {
      const client = await connect(mode);
      const call = client.callTool({
        name: "create_prop",
        arguments: { text: "Will it rain?", personal: true },
      });
      await expect(call).rejects.toBeInstanceOf(InsufficientScopeError);
      await expect(call).rejects.toMatchObject({
        requiredScope: expect.stringContaining("haruspex:write"),
      });
      const refused = responses.at(-1)!;
      expect(refused.status).toBe(403);
      const challenge = refused.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toMatch(/scope="[^"]*haruspex:write[^"]*"/);
      expect(challenge).toContain(`resource_metadata="${METADATA}"`);
      expect(tools.createPropTool).not.toHaveBeenCalled();
      await client.close();
    });
  },
);

describe("/mcp, a bare legacy tools/call", () => {
  it("refuses create_prop from a read-only caller with HTTP 403", async () => {
    signedIn(["haruspex:read"]);
    const res = await legacyCall("create_prop", {
      text: "Will it rain?",
      personal: true,
    });
    expect(res.status).toBe(403);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toMatch(/scope="[^"]*haruspex:write[^"]*"/);
    expect(tools.createPropTool).not.toHaveBeenCalled();
  });

  it("refuses a read from a write-only caller with HTTP 403 for haruspex:read", async () => {
    signedIn(["haruspex:write"]);
    const res = await legacyCall("list_categories", {});
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate") ?? "").toMatch(
      /scope="[^"]*haruspex:read[^"]*"/,
    );
  });

  it("lets a write-scoped caller create a prop", async () => {
    signedIn(["haruspex:read", "haruspex:write"]);
    vi.mocked(tools.createPropTool).mockResolvedValue({
      ok: true,
      data: prop,
      summary: "Created prop 42",
    });
    const res = await legacyCall("create_prop", {
      text: "Will it rain?",
      personal: true,
      resolution_due_date: "2027-01-31T23:59:00-05:00",
    });
    expect(res.status).toBe(200);
    expect(tools.createPropTool).toHaveBeenCalledWith(
      caller,
      expect.objectContaining({
        text: "Will it rain?",
        personal: true,
        resolution_due_date: "2027-01-31T23:59:00-05:00",
      }),
    );
  });
});

describe("/mcp input schemas", () => {
  beforeEach(() => signedIn(["haruspex:read", "haruspex:write"]));

  async function call(name: string, args: Record<string, unknown>) {
    const client = await connect("modern");
    try {
      return await client.callTool({ name, arguments: args });
    } catch (e) {
      return { isError: true, thrown: e };
    } finally {
      await client.close();
    }
  }

  it.each([0, 201, 2.5])("rejects list_props limit %s", async (limit) => {
    const result = await call("list_props", { limit });
    expect(result.isError).toBe(true);
    expect(tools.listPropsTool).not.toHaveBeenCalled();
  });

  it("rejects a deadline with no UTC offset", async () => {
    const result = await call("create_prop", {
      text: "Will it rain?",
      personal: true,
      forecasts_due_date: "2027-01-31T23:59:00",
    });
    expect(result.isError).toBe(true);
    expect(tools.createPropTool).not.toHaveBeenCalled();
  });

  it("accepts a competition by name or by id", async () => {
    vi.mocked(tools.listPropsTool).mockResolvedValue({
      ok: true,
      data: { props: [], truncated: false },
      summary: "0 prop(s)",
    });
    await call("list_props", { competition: "2027 Season" });
    await call("list_props", { competition: 3 });
    expect(tools.listPropsTool).toHaveBeenNthCalledWith(1, caller, {
      competition: "2027 Season",
    });
    expect(tools.listPropsTool).toHaveBeenNthCalledWith(2, caller, {
      competition: 3,
    });
  });
});
