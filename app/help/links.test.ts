import { afterEach, describe, expect, it, vi } from "vitest";

import { helpLinks } from "./links";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("helpLinks", () => {
  it("uses the configured MCP URL, and identity's connected-apps page", () => {
    vi.stubEnv("MCP_RESOURCE_URL", "https://haruspex.fyi/mcp");
    vi.stubEnv("APP_BASE_URL", "https://haruspex.fyi");
    vi.stubEnv("IDP_PUBLIC_URL", "https://identity.ethanswan.com/");
    expect(helpLinks()).toEqual({
      mcpUrl: "https://haruspex.fyi/mcp",
      connectedAppsUrl: "https://identity.ethanswan.com/oauth/connected-apps",
    });
  });

  it("derives the MCP URL from the site's base URL when it is not set", () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    vi.stubEnv("APP_BASE_URL", "https://staging.haruspex.fyi/");
    vi.stubEnv("IDP_PUBLIC_URL", "");
    expect(helpLinks()).toEqual({
      mcpUrl: "https://staging.haruspex.fyi/mcp",
      connectedAppsUrl: null,
    });
  });

  it("has no MCP URL to print when neither is set", () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("IDP_PUBLIC_URL", "");
    expect(helpLinks().mcpUrl).toBeNull();
  });
});
