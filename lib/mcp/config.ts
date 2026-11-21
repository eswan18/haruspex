import "server-only";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";

export const READ_SCOPE = "haruspex:read";
export const WRITE_SCOPE = "haruspex:write";
export const SCOPES = [READ_SCOPE, WRITE_SCOPE] as const;

export interface McpConfig {
  /** This server's MCP URL, exactly as configured: the token `aud` and the PRM `resource`. */
  resource: string;
  /** identity's issuer, exactly as it appears in `iss`. */
  issuer: string;
  /** The RFC 9728 protected resource metadata URL for `resource`. */
  metadataUrl: string;
}

/**
 * From MCP_RESOURCE_URL and IDP_PUBLIC_URL; null if either is unset, in which
 * case /mcp refuses every request (it fails closed).
 */
export function mcpConfig(): McpConfig | null {
  const resource = process.env.MCP_RESOURCE_URL?.trim();
  const issuer = process.env.IDP_PUBLIC_URL?.trim();
  if (!resource || !issuer) return null;
  return {
    resource,
    issuer,
    metadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(resource)),
  };
}
