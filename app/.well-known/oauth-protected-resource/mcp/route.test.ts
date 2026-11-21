import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /.well-known/oauth-protected-resource/mcp", () => {
  it("describes the MCP resource, naming identity as its authorization server", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "https://haruspex.fyi/mcp");
    vi.stubEnv("IDP_PUBLIC_URL", "https://identity.ethanswan.com");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      resource: "https://haruspex.fyi/mcp",
      authorization_servers: ["https://identity.ethanswan.com"],
      scopes_supported: ["haruspex:read", "haruspex:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Haruspex",
    });
  });

  it("keeps the issuer exactly as configured, with no trailing slash", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "http://localhost:3000/mcp");
    vi.stubEnv("IDP_PUBLIC_URL", "http://localhost:8080");

    const body = await (await GET()).json();

    expect(body.resource).toBe("http://localhost:3000/mcp");
    expect(body.authorization_servers).toEqual(["http://localhost:8080"]);
  });

  it("is 404 when MCP is not configured", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    vi.stubEnv("IDP_PUBLIC_URL", "https://identity.ethanswan.com");

    const res = await GET();

    expect(res.status).toBe(404);
  });
});
