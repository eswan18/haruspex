import { mcpConfig, SCOPES } from "@/lib/mcp/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RFC 9728 protected resource metadata for /mcp: where an MCP client learns
 * that identity issues the tokens /mcp accepts.
 *
 * Built by hand rather than with the SDK's buildOAuthProtectedResourceMetadata,
 * which throws on a plain-http issuer anywhere but localhost and omits
 * bearer_methods_supported. `resource` and the issuer are passed through
 * exactly as configured: the token's `aud` and `iss` are compared with them as
 * strings, so normalising either (a trailing slash) would break sign-in.
 */
export async function GET() {
  const config = mcpConfig();
  if (!config) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Haruspex",
  });
}
