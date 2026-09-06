import "server-only";
import * as jose from "jose";

import { RefreshTokenRejectedError } from "./errors";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// IDP_BASE_URL: server-to-server calls (internal K8s URL in cluster).
// IDP_PUBLIC_URL: browser-facing redirects and JWT issuer validation (external URL, provided at runtime via the IDP_PUBLIC_URL env var).
const IDP_BASE_URL = requiredEnv("IDP_BASE_URL");
const IDP_PUBLIC_URL = requiredEnv("IDP_PUBLIC_URL");
const IDP_CLIENT_ID = process.env.IDP_CLIENT_ID || "";
const IDP_CLIENT_SECRET = process.env.IDP_CLIENT_SECRET || "";

// Types
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface IDPClaims {
  sub: string; // User UUID
  username: string;
  email: string;
  email_verified: boolean;
  scope?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export interface UserInfoResponse {
  sub: string;
  username?: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  picture?: string; // Avatar URL
}

/**
 * Generate the OAuth authorization URL for initiating the login flow.
 * Uses PKCE for security.
 */
export function getAuthorizationUrl(
  state: string,
  codeChallenge: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: IDP_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${IDP_PUBLIC_URL}/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await fetch(`${IDP_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: IDP_CLIENT_ID,
      client_secret: IDP_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  return response.json();
}

/** How long to wait on the IdP before giving up on a refresh. */
const REFRESH_TIMEOUT_MS = 3000;

/**
 * The OAuth2 error codes that do not mean "this grant is finished"
 * (RFC 6749 §5.2).
 */
const RETRYABLE_OAUTH_ERRORS = new Set([
  "server_error",
  "temporarily_unavailable",
  // Not retryable so much as not the user's problem: `invalid_client` means
  // OUR client id or secret is wrong. Ending everyone's session would not fix
  // the config, and they could not sign back in anyway -- so keep the grant,
  // which is still good the moment the credentials are corrected.
  "invalid_client",
]);

/**
 * True when an error response is the IdP deliberately refusing this grant.
 *
 * The test is inverted on purpose. Enumerating the terminal codes instead --
 * asking "is it `invalid_grant`?" -- decays every time identity grows a code:
 * `invalid_scope` (a refresh token carrying admin scopes, oauth.go) is already
 * such a case, and it explicitly does NOT consume the token, so treating it as
 * retryable pins that user in a loop they cannot leave without clearing
 * cookies by hand. A structured OAuth error body is the IdP having reached a
 * decision, and every decision but the two retryable codes is permanent for
 * this token.
 *
 * A body we cannot parse is NOT terminal: an unreadable response means the IdP
 * or something in front of it is broken, which is the opposite of a decision.
 */
function isTerminalGrantError(body: string): boolean {
  try {
    const code = JSON.parse(body)?.error;
    return typeof code === "string" && !RETRYABLE_OAUTH_ERRORS.has(code);
  } catch {
    return false;
  }
}

/**
 * Refresh an access token using a refresh token.
 *
 * Throws {@link RefreshTokenRejectedError} only when the IdP has decided the
 * grant is finished. Every other failure -- a 5xx, a timeout, a gateway error,
 * a 429 -- throws a plain Error, because the caller must be able to tell "this
 * session is over" apart from "the IdP is briefly unwell" and must not end a
 * session over the latter.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const response = await fetch(`${IDP_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: IDP_CLIENT_ID,
      client_secret: IDP_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response.text();
    if (isTerminalGrantError(error)) {
      throw new RefreshTokenRejectedError(`Refresh token rejected: ${error}`);
    }
    throw new Error(`Failed to refresh token: ${error}`);
  }

  return response.json();
}

// JWKS cache
let jwksCache: jose.JWTVerifyGetKey | null = null;
let jwksCacheExpiry: number = 0;

/**
 * Get the JWKS for validating IDP tokens.
 * Caches the JWKS for 1 hour.
 */
async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  // Return cached JWKS if still valid
  if (jwksCache && Date.now() < jwksCacheExpiry) {
    return jwksCache;
  }

  const jwksUrl = new URL("/.well-known/jwks.json", IDP_BASE_URL);
  jwksCache = jose.createRemoteJWKSet(jwksUrl);
  jwksCacheExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

  return jwksCache;
}

/**
 * Validate an IDP access token and return its claims.
 *
 * NOTE: This validates the token signature locally using JWKS.
 * It does NOT check if the token has been revoked on the IDP.
 * For high-security scenarios, consider using the /oauth/introspect endpoint
 * to verify the token is still active. This adds network latency but catches
 * revoked tokens.
 */
export async function validateIDPToken(token: string): Promise<IDPClaims> {
  const jwks = await getJWKS();

  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: IDP_PUBLIC_URL,
    // We don't strictly validate audience since it varies by client
  });

  return {
    sub: payload.sub as string,
    username: payload.username as string,
    email: payload.email as string,
    email_verified: payload.email_verified as boolean,
    scope: payload.scope as string | undefined,
    iss: payload.iss as string,
    aud: payload.aud as string,
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}

/**
 * Fetch user info from the IDP's /oauth/userinfo endpoint.
 * This returns profile information including the avatar URL.
 */
export async function fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
  const response = await fetch(`${IDP_BASE_URL}/oauth/userinfo`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user info: ${error}`);
  }

  return response.json();
}

/**
 * Generate a cryptographically secure random string for PKCE and state.
 */
export function generateRandomString(length: number = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Generate a PKCE code challenge from a code verifier.
 * Uses SHA-256 as required by the IDP.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return jose.base64url.encode(new Uint8Array(hash));
}

/**
 * Construct a full name from given_name and family_name fields.
 * Returns null if neither field is provided or if they contain only whitespace.
 */
export function buildNameFromUserInfo(userInfo: UserInfoResponse): string | null {
  const parts = [userInfo.given_name, userInfo.family_name]
    .map((n) => n?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
