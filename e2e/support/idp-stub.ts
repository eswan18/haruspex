/**
 * A stand-in for the identity IdP. A test double, nothing more: it signs in
 * one made-up person without asking, keeps everything in memory, and dies
 * with the run.
 *
 * It serves what the app calls (lib/idp/client.ts), at the same paths:
 *
 * - `GET /.well-known/jwks.json`: the keys the app verifies session tokens
 *   with. It checks `iss` against `IDP_PUBLIC_URL` and `aud` against
 *   `IDP_AUDIENCE`, so with both URLs pointed here a token minted below is
 *   verified exactly as one from identity would be. No test-only path in the
 *   app.
 * - `GET /oauth/authorize`: checks the request as identity does (client,
 *   redirect URI, a PKCE S256 challenge), then at once sends the browser back
 *   to the app with a one-time code, signed in as `NEWCOMER`.
 * - `POST /oauth/token` (`grant_type=authorization_code`): trades that code
 *   for tokens, and refuses it unless the `code_verifier` hashes to the
 *   challenge the authorize request carried.
 * - `GET /oauth/userinfo`: the profile behind an access token it issued.
 *
 * And one thing identity has not: `GET /_stub/token-requests`, what the token
 * endpoint was asked and what it made of the PKCE verifier, so a spec can see
 * the check happened.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";

import * as jose from "jose";

import { APP_URL, LOOPBACK } from "./harness";

/** The haruspex client's audience in identity, and the app's `IDP_AUDIENCE`. */
export const AUDIENCE = "ethanswan:haruspex";
/** The app's `IDP_CLIENT_ID` and `IDP_CLIENT_SECRET`. */
export const CLIENT_ID = "e2e";
export const CLIENT_SECRET = "e2e";
/** Where the app asks to be sent back to; identity holds it per client. */
export const REDIRECT_URI = `${APP_URL}/oauth/callback`;

/**
 * Who the authorize step signs in: a person the seed never created, so the
 * app meets them for the first time. The app names a new user from
 * userinfo's `given_name` and `family_name`.
 */
export const NEWCOMER = {
  email: "newcomer@example.com",
  username: "e2e-newcomer",
  given_name: "E2E",
  family_name: "Newcomer",
} as const;
export const NEWCOMER_NAME = `${NEWCOMER.given_name} ${NEWCOMER.family_name}`;

/** One call to the token endpoint, as `/_stub/token-requests` lists it. */
export interface TokenRequest {
  grant_type: string | null;
  /** How the `code_verifier` compared with the code's `code_challenge`. */
  pkce: "verified" | "mismatch" | "missing" | "not checked";
  /** "issued", or the OAuth error the stub answered with. */
  outcome: string;
}

const KEY_ID = "e2e";

export interface IdpStub {
  url: string;
  mintToken(claims: {
    sub: string;
    email: string;
    username?: string;
    aud?: string;
  }): Promise<string>;
  stop(): Promise<void>;
}

/** What an authorization code stands for until it is traded in. */
interface Grant {
  challenge: string;
  redirectUri: string;
  sub: string;
}

/** base64url(SHA-256(verifier)): RFC 7636's S256. */
function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function send(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  headers: http.OutgoingHttpHeaders = {},
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type":
      typeof body === "string" ? "text/plain" : "application/json",
    ...headers,
  });
  response.end(text);
}

async function readForm(
  request: http.IncomingMessage,
): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function startIdpStub(port: number): Promise<IdpStub> {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
  const jwks = {
    keys: [
      {
        ...(await jose.exportJWK(publicKey)),
        kid: KEY_ID,
        alg: "ES256",
        use: "sig",
      },
    ],
  };
  // The loopback address rather than localhost, so the app's server-side
  // fetch of the keys cannot wander off to ::1 and find nothing there.
  const url = `http://${LOOPBACK}:${port}`;

  const mintToken: IdpStub["mintToken"] = ({
    sub,
    email,
    username,
    aud = AUDIENCE,
  }) =>
    new jose.SignJWT({ email, ...(username ? { username } : {}) })
      .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
      .setIssuer(url)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

  // A fresh subject every run, so the app has never seen this person.
  const newcomer = { sub: randomUUID(), ...NEWCOMER };
  const grants = new Map<string, Grant>();
  const tokenRequests: TokenRequest[] = [];

  const authorize = (query: URLSearchParams, response: http.ServerResponse) => {
    const refuse = (why: string) => send(response, 400, `IdP stub: ${why}`);
    if (query.get("response_type") !== "code") {
      return refuse("response_type must be code");
    }
    if (query.get("client_id") !== CLIENT_ID) return refuse("unknown client");
    const redirectUri = query.get("redirect_uri");
    if (redirectUri !== REDIRECT_URI) {
      return refuse(`redirect_uri is not registered: ${redirectUri}`);
    }
    const challenge = query.get("code_challenge");
    if (!challenge || query.get("code_challenge_method") !== "S256") {
      return refuse("Code challenge and code challenge method are required");
    }
    const code = randomBytes(16).toString("hex");
    grants.set(code, { challenge, redirectUri, sub: newcomer.sub });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    const state = query.get("state");
    if (state !== null) back.searchParams.set("state", state);
    send(response, 302, "", { location: back.toString() });
  };

  const token = async (form: URLSearchParams): Promise<[number, unknown]> => {
    const entry: TokenRequest = {
      grant_type: form.get("grant_type"),
      pkce: "not checked",
      outcome: "",
    };
    tokenRequests.push(entry);
    const refuse = (error: string): [number, unknown] => {
      entry.outcome = error;
      return [error === "invalid_client" ? 401 : 400, { error }];
    };
    if (
      form.get("client_id") !== CLIENT_ID ||
      form.get("client_secret") !== CLIENT_SECRET
    ) {
      return refuse("invalid_client");
    }
    if (entry.grant_type !== "authorization_code") {
      return refuse("unsupported_grant_type");
    }
    const code = form.get("code") ?? "";
    const grant = grants.get(code);
    grants.delete(code); // One try per code, right or wrong.
    if (!grant || form.get("redirect_uri") !== grant.redirectUri) {
      return refuse("invalid_grant");
    }
    const verifier = form.get("code_verifier");
    if (!verifier) {
      entry.pkce = "missing";
      return refuse("invalid_grant");
    }
    if (s256(verifier) !== grant.challenge) {
      entry.pkce = "mismatch";
      return refuse("invalid_grant");
    }
    entry.pkce = "verified";
    entry.outcome = "issued";
    return [
      200,
      {
        access_token: await mintToken({
          sub: grant.sub,
          email: newcomer.email,
          username: newcomer.username,
        }),
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: randomBytes(16).toString("hex"),
        scope: "openid profile email",
      },
    ];
  };

  const userinfo = async (authorization: string | undefined) => {
    const bearer = authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return null;
    try {
      const { payload } = await jose.jwtVerify(bearer, publicKey, {
        issuer: url,
      });
      return payload.sub === newcomer.sub
        ? { ...newcomer, email_verified: true }
        : null;
    } catch {
      return null;
    }
  };

  const server = http.createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? "/", url);
    const route = `${request.method} ${pathname}`;
    const handle = async () => {
      switch (route) {
        case "GET /.well-known/jwks.json":
          return send(response, 200, jwks);
        case "GET /oauth/authorize":
          return authorize(searchParams, response);
        case "POST /oauth/token": {
          const [status, body] = await token(await readForm(request));
          return send(response, status, body);
        }
        case "GET /oauth/userinfo": {
          const profile = await userinfo(request.headers.authorization);
          return profile
            ? send(response, 200, profile)
            : send(response, 401, { error: "invalid_token" });
        }
        case "GET /_stub/token-requests":
          return send(response, 200, tokenRequests);
        default:
          return send(response, 404, "Not found");
      }
    };
    handle().catch((error: unknown) => {
      send(response, 500, `IdP stub: ${String(error)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    url,
    mintToken,
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // The app's keep-alive connections would otherwise hold close() open.
        server.closeAllConnections();
      });
    },
  };
}
