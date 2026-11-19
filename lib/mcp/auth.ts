import "server-only";
import * as jose from "jose";
import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";

import type { VUser } from "@/types/db_types";
import { logger } from "@/lib/logger";
import { mcpConfig, READ_SCOPE, SCOPES, type McpConfig } from "./config";

/**
 * The gate in front of /mcp: it decides who a request is from identity's
 * OAuth access token, and refuses as HTTP before the MCP SDK sees anything.
 *
 * Claude starts sign-in only on a real 401 (a tool error inside a 200 never
 * prompts it), and asks for more scope only on a 403 with
 * `error="insufficient_scope"`, so those two are the only shapes that
 * trigger anything client-side:
 *
 * - no bearer token: 401 pointing at the protected resource metadata;
 * - a token that fails {@link verifyAccessToken}: 401 `invalid_token`;
 * - a token with neither haruspex scope: 403 `insufficient_scope`;
 * - a `sub` with no haruspex user, or a deactivated one: 403. Users are never
 *   created here -- the browser sign-in does that.
 *
 * MCP calls do not impersonate and do not record an active day.
 */

const SCOPE_TEXT = SCOPES.join(" ");

/** The bearer token is not one this server accepts. The message is for logs. */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export interface VerifiedToken {
  sub: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

/**
 * The token's identity, if it is identity's RFC 9068 access token for this
 * resource: ES256 from identity's JWKS, header `typ` `at+jwt` (jose compares
 * it case-insensitively and treats `at+jwt` and `application/at+jwt` as the
 * same), `iss` exactly the issuer, `aud` containing the resource exactly, and
 * `exp`, `iat`, `sub` and `client_id` present.
 *
 * Throws {@link InvalidTokenError} otherwise.
 */
export async function verifyAccessToken(
  token: string,
  config: McpConfig,
  keys: jose.JWTVerifyGetKey,
): Promise<VerifiedToken> {
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["ES256"],
      typ: "at+jwt",
      requiredClaims: ["exp", "iat", "sub", "client_id"],
    }));
  } catch (e) {
    if (e instanceof jose.errors.JOSEError) {
      throw new InvalidTokenError(`${e.code}: ${e.message}`);
    }
    throw e;
  }
  const { sub, client_id: clientId, scope, exp } = payload;
  if (typeof sub !== "string" || !sub) {
    throw new InvalidTokenError("sub is missing");
  }
  if (typeof clientId !== "string" || !clientId) {
    throw new InvalidTokenError("client_id is missing");
  }
  return {
    sub,
    clientId,
    scopes: typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [],
    expiresAt: exp as number,
  };
}

/** The haruspex user for an identity subject, or undefined. */
export async function findUserBySub(sub: string): Promise<VUser | undefined> {
  // Imported here so this module loads without DATABASE_URL (unit tests).
  const { db } = await import("@/lib/database");
  return db
    .selectFrom("v_users")
    .selectAll()
    .where("idp_user_id", "=", sub)
    .executeTakeFirst();
}

async function defaultKeys(): Promise<jose.JWTVerifyGetKey> {
  // Imported here: lib/idp/client requires IDP_* env at import time.
  const { getJWKS } = await import("@/lib/idp/client");
  return getJWKS();
}

export interface AuthenticateDeps {
  config?: McpConfig | null;
  keys?: jose.JWTVerifyGetKey;
  findUser?: (sub: string) => Promise<VUser | undefined>;
}

export type Authenticated = { caller: VUser; authInfo: AuthInfo };

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function refuse(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status });
}

/**
 * Who this /mcp request is from, or the Response refusing it.
 */
export async function authenticate(
  request: Request,
  deps: AuthenticateDeps = {},
): Promise<Authenticated | Response> {
  const config = deps.config === undefined ? mcpConfig() : deps.config;
  if (!config) {
    return refuse(503, "unavailable", "MCP is not configured here");
  }

  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { error: "invalid_token", error_description: "Sign in required" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${config.metadataUrl}", scope="${SCOPE_TEXT}"`,
        },
      },
    );
  }

  let verified: VerifiedToken;
  try {
    verified = await verifyAccessToken(
      token,
      config,
      deps.keys ?? (await defaultKeys()),
    );
  } catch (e) {
    if (!(e instanceof InvalidTokenError)) throw e;
    logger.info("MCP token refused", { reason: e.message });
    return bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InvalidToken, "Token not accepted"),
      { requiredScopes: [...SCOPES], resourceMetadataUrl: config.metadataUrl },
    );
  }

  if (!SCOPES.some((s) => verified.scopes.includes(s))) {
    return bearerAuthChallengeResponse(
      new OAuthError(
        OAuthErrorCode.InsufficientScope,
        `This needs ${SCOPES.join(" or ")}`,
      ),
      { requiredScopes: [READ_SCOPE], resourceMetadataUrl: config.metadataUrl },
    );
  }

  const caller = await (deps.findUser ?? findUserBySub)(verified.sub);
  if (!caller) {
    const base = process.env.APP_BASE_URL || new URL(request.url).origin;
    logger.warn("MCP caller has no haruspex account", {
      idpUserId: verified.sub,
      clientId: verified.clientId,
    });
    return refuse(
      403,
      "access_denied",
      `No haruspex account for this sign-in yet. Sign in at ${base} once, then reconnect.`,
    );
  }
  if (caller.deactivated_at) {
    logger.warn("Deactivated user attempted MCP access", {
      userId: caller.id,
      idpUserId: verified.sub,
    });
    return refuse(
      403,
      "access_denied",
      "This haruspex account is deactivated.",
    );
  }

  return {
    caller,
    authInfo: {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt,
      resource: new URL(config.resource),
      resourceMetadataUrl: config.metadataUrl,
      extra: { caller },
    },
  };
}
