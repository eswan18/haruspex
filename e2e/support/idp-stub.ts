/**
 * A stand-in for the identity IdP: just enough for the app to verify the
 * session tokens this suite mints.
 *
 * The app fetches the signing keys from `${IDP_BASE_URL}/.well-known/jwks.json`
 * and checks `iss` against `IDP_PUBLIC_URL` and `aud` against `IDP_AUDIENCE`
 * (lib/idp/client.ts), so with both URLs pointed here a minted token is
 * verified exactly as one from identity would be. No test-only path in the app.
 */
import http from "node:http";

import * as jose from "jose";

import { LOOPBACK } from "./harness";

/** The haruspex client's audience in identity, and the app's `IDP_AUDIENCE`. */
export const AUDIENCE = "ethanswan:haruspex";

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

export async function startIdpStub(port: number): Promise<IdpStub> {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
  const jwks = {
    keys: [
      { ...(await jose.exportJWK(publicKey)), kid: KEY_ID, alg: "ES256", use: "sig" },
    ],
  };
  // The loopback address rather than localhost, so the app's server-side
  // fetch of the keys cannot wander off to ::1 and find nothing there.
  const url = `http://${LOOPBACK}:${port}`;

  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", url);
    if (request.method === "GET" && pathname === "/.well-known/jwks.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(jwks));
    } else if (request.method === "GET" && pathname === "/oauth/authorize") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("IdP stub: authorize");
    } else {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
    }
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
    mintToken({ sub, email, username, aud = AUDIENCE }) {
      return new jose.SignJWT({ email, ...(username ? { username } : {}) })
        .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
        .setIssuer(url)
        .setSubject(sub)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // The app's keep-alive connections would otherwise hold close() open.
        server.closeAllConnections();
      });
    },
  };
}
