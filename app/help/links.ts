/**
 * The two addresses the help page prints, read from this deployment's
 * environment so staging's page shows staging's URLs.
 *
 * `mcpUrl` is the MCP endpoint a reader pastes into Claude: MCP_RESOURCE_URL,
 * which is also the audience identity mints the tokens for, so it is exactly
 * the URL that works; failing that, the site's own `/mcp`. Null when neither
 * is configured, and the page then says the assistant setup is unavailable.
 *
 * `connectedAppsUrl` is identity's page for disconnecting an app (revoking
 * its tokens and forgetting the consent). Null without IDP_PUBLIC_URL.
 */
export function helpLinks(): {
  mcpUrl: string | null;
  connectedAppsUrl: string | null;
} {
  const trimSlash = (url: string) => url.replace(/\/+$/, "");
  const resource = process.env.MCP_RESOURCE_URL?.trim();
  const base = process.env.APP_BASE_URL?.trim();
  const idp = process.env.IDP_PUBLIC_URL?.trim();
  return {
    mcpUrl: resource || (base ? `${trimSlash(base)}/mcp` : null),
    connectedAppsUrl: idp ? `${trimSlash(idp)}/oauth/connected-apps` : null,
  };
}
