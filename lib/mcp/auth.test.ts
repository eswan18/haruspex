import { beforeAll, describe, expect, it, vi } from "vitest";
import * as jose from "jose";
import type { VUser } from "@/types/db_types";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  authenticate,
  InvalidTokenError,
  verifyAccessToken,
  type VerifiedToken,
} from "./auth";
import { mcpConfig, type McpConfig } from "./config";

const config: McpConfig = {
  resource: "https://haruspex.fyi/mcp",
  issuer: "https://identity.ethanswan.com",
  metadataUrl: "https://haruspex.fyi/.well-known/oauth-protected-resource/mcp",
};

const METADATA = config.metadataUrl;

let privateKey: CryptoKey;
let keys: jose.JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await jose.generateKeyPair("ES256");
  privateKey = pair.privateKey;
  const jwk = await jose.exportJWK(pair.publicKey);
  keys = jose.createLocalJWKSet({
    keys: [{ ...jwk, kid: "test-key", alg: "ES256" }],
  });
});

interface TokenOptions {
  typ?: string | null;
  claims?: Record<string, unknown>;
  omit?: string[];
  expiresIn?: number; // seconds from now; negative is expired
}

async function makeToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: config.issuer,
    aud: config.resource,
    sub: "idp-user-1",
    client_id: "claude",
    scope: "haruspex:read haruspex:write",
    iat: now,
    exp: now + (options.expiresIn ?? 300),
    ...options.claims,
  };
  for (const name of options.omit ?? []) delete claims[name];
  const header: jose.JWTHeaderParameters = { alg: "ES256", kid: "test-key" };
  const typ = options.typ === undefined ? "at+jwt" : options.typ;
  if (typ !== null) header.typ = typ;
  return new jose.SignJWT(claims).setProtectedHeader(header).sign(privateKey);
}

function user(overrides: Partial<VUser> = {}): VUser {
  return {
    id: 7,
    idp_user_id: "idp-user-1",
    deactivated_at: null,
    ...overrides,
  } as VUser;
}

function bearer(token: string): Request {
  return new Request("https://haruspex.fyi/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("verifyAccessToken", () => {
  it("accepts identity's access token for this resource", async () => {
    const token = await makeToken();
    const verified: VerifiedToken = await verifyAccessToken(
      token,
      config,
      keys,
    );
    expect(verified.sub).toBe("idp-user-1");
    expect(verified.clientId).toBe("claude");
    expect(verified.scopes).toEqual(["haruspex:read", "haruspex:write"]);
    expect(typeof verified.expiresAt).toBe("number");
  });

  it("accepts typ application/at+jwt in any case", async () => {
    const token = await makeToken({ typ: "Application/AT+JWT" });
    await expect(verifyAccessToken(token, config, keys)).resolves.toBeTruthy();
  });

  it("accepts aud as an array containing the resource", async () => {
    const token = await makeToken({
      claims: { aud: ["https://other.example/mcp", config.resource] },
    });
    await expect(verifyAccessToken(token, config, keys)).resolves.toBeTruthy();
  });

  it("rejects a token for another resource", async () => {
    const token = await makeToken({
      claims: { aud: "https://sensibility.money/mcp" },
    });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects a token from another issuer", async () => {
    const token = await makeToken({
      claims: { iss: "https://evil.example" },
    });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects a token with no typ (an ID token)", async () => {
    const token = await makeToken({ typ: null });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects typ JWT", async () => {
    const token = await makeToken({ typ: "JWT" });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await makeToken({ expiresIn: -600 });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects a token with no client_id", async () => {
    const token = await makeToken({ omit: ["client_id"] });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects a token with no exp", async () => {
    const token = await makeToken({ omit: ["exp"] });
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects an HS256-signed token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({
      iss: config.issuer,
      aud: config.resource,
      sub: "idp-user-1",
      client_id: "claude",
      scope: "haruspex:read",
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt", kid: "test-key" })
      .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-len"));
    await expect(verifyAccessToken(token, config, keys)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("rejects something that is not a JWT", async () => {
    await expect(
      verifyAccessToken("not-a-jwt", config, keys),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("authenticate", () => {
  const found = (u: VUser | undefined) => vi.fn(async () => u);

  it("refuses with 503 when MCP is not configured", async () => {
    const response = await authenticate(bearer("anything"), {
      config: null,
      keys,
      findUser: found(user()),
    });
    expect(response).toBeInstanceOf(Response);
    const res = response as Response;
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not configured/i);
  });

  it("asks for sign-in with 401 when there is no bearer token", async () => {
    const response = await authenticate(
      new Request("https://haruspex.fyi/mcp", { method: "POST" }),
      { config, keys, findUser: found(user()) },
    );
    const res = response as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${METADATA}", scope="haruspex:read haruspex:write"`,
    );
  });

  it("treats a non-Bearer Authorization header as no token", async () => {
    const response = await authenticate(
      new Request("https://haruspex.fyi/mcp", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }),
      { config, keys, findUser: found(user()) },
    );
    const res = response as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).not.toMatch(/error=/);
  });

  it("refuses a bad token with 401 invalid_token, without echoing it", async () => {
    const token = await makeToken({
      claims: { aud: "https://sensibility.money/mcp" },
    });
    const response = await authenticate(bearer(token), {
      config,
      keys,
      findUser: found(user()),
    });
    const res = response as Response;
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${METADATA}"`);
    expect(challenge).not.toContain(token);
    expect(await res.text()).not.toContain(token);
  });

  it("refuses with 403 insufficient_scope when the token has neither scope", async () => {
    const token = await makeToken({ claims: { scope: "openid profile" } });
    const response = await authenticate(bearer(token), {
      config,
      keys,
      findUser: found(user()),
    });
    const res = response as Response;
    expect(res.status).toBe(403);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="haruspex:read"');
    expect(challenge).toContain(`resource_metadata="${METADATA}"`);
  });

  it("refuses an unknown sub with 403 and says where to sign in", async () => {
    vi.stubEnv("APP_BASE_URL", "https://haruspex.fyi");
    try {
      const token = await makeToken();
      const response = await authenticate(bearer(token), {
        config,
        keys,
        findUser: found(undefined),
      });
      const res = response as Response;
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(
        "No haruspex account for this sign-in yet. Sign in at https://haruspex.fyi once, then reconnect.",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the request origin when APP_BASE_URL is unset", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    try {
      const token = await makeToken();
      const response = await authenticate(
        new Request("https://staging.haruspex.fyi/mcp", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        { config, keys, findUser: found(undefined) },
      );
      const res = response as Response;
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(
        "Sign in at https://staging.haruspex.fyi once",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a deactivated user with 403", async () => {
    const token = await makeToken();
    const response = await authenticate(bearer(token), {
      config,
      keys,
      findUser: found(user({ deactivated_at: new Date() })),
    });
    expect((response as Response).status).toBe(403);
  });

  it("returns the caller and the SDK's AuthInfo for a good token", async () => {
    const token = await makeToken({ claims: { scope: "haruspex:read" } });
    const caller = user();
    const findUser = found(caller);
    const result = await authenticate(bearer(token), {
      config,
      keys,
      findUser,
    });
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(findUser).toHaveBeenCalledWith("idp-user-1");
    expect(result.caller).toBe(caller);
    expect(result.authInfo.token).toBe(token);
    expect(result.authInfo.clientId).toBe("claude");
    expect(result.authInfo.scopes).toEqual(["haruspex:read"]);
    expect(typeof result.authInfo.expiresAt).toBe("number");
    expect(result.authInfo.resource?.href).toBe(config.resource);
    expect(result.authInfo.resourceMetadataUrl).toBe(METADATA);
    expect(result.authInfo.extra).toEqual({ caller });
  });
});

describe("mcpConfig", () => {
  it("is null unless both MCP_RESOURCE_URL and IDP_PUBLIC_URL are set", () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    vi.stubEnv("IDP_PUBLIC_URL", config.issuer);
    try {
      expect(mcpConfig()).toBeNull();
      vi.stubEnv("MCP_RESOURCE_URL", config.resource);
      vi.stubEnv("IDP_PUBLIC_URL", "");
      expect(mcpConfig()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("puts the metadata URL under the well-known prefix", () => {
    vi.stubEnv("MCP_RESOURCE_URL", config.resource);
    vi.stubEnv("IDP_PUBLIC_URL", config.issuer);
    try {
      expect(mcpConfig()).toEqual(config);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
