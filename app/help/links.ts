/**
 * The MCP endpoint the help page prints, read from this deployment's
 * environment so staging's page shows staging's URL.
 *
 * It is MCP_RESOURCE_URL, which is also the audience identity mints the
 * tokens for, so it is exactly the URL that works; failing that, the site's
 * own `/mcp`. Null when neither is configured, and the page then says the
 * assistant setup is unavailable.
 */
export function helpLinks(): { mcpUrl: string | null } {
  const resource = process.env.MCP_RESOURCE_URL?.trim();
  const base = process.env.APP_BASE_URL?.trim();
  return {
    mcpUrl: resource || (base ? `${base.replace(/\/+$/, "")}/mcp` : null),
  };
}
