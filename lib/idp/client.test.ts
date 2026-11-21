import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to allow importing in tests
vi.mock("server-only", () => ({}));

// Mock jose to avoid issues with crypto in tests
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  base64url: { encode: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("IDP Client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("IDP_BASE_URL", "https://identity.example.com");
    vi.stubEnv("IDP_PUBLIC_URL", "https://identity.example.com");
  });

  describe("buildNameFromUserInfo", () => {
    it("should return full name when both given_name and family_name are provided", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: "John",
        family_name: "Doe",
      });

      expect(result).toBe("John Doe");
    });

    it("should return given_name only when family_name is missing", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: "John",
      });

      expect(result).toBe("John");
    });

    it("should return family_name only when given_name is missing", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        family_name: "Doe",
      });

      expect(result).toBe("Doe");
    });

    it("should return null when neither given_name nor family_name are provided", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
      });

      expect(result).toBeNull();
    });

    it("should return null when given_name and family_name are empty strings", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: "",
        family_name: "",
      });

      expect(result).toBeNull();
    });

    it("should handle undefined values correctly", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: undefined,
        family_name: undefined,
      });

      expect(result).toBeNull();
    });

    it("should return null when names contain only whitespace", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: "   ",
        family_name: "  ",
      });

      expect(result).toBeNull();
    });

    it("should trim whitespace from names", async () => {
      const { buildNameFromUserInfo } = await import("./client");

      const result = buildNameFromUserInfo({
        sub: "user-123",
        given_name: "  John  ",
        family_name: "  Doe  ",
      });

      expect(result).toBe("John Doe");
    });
  });
  describe("refreshAccessToken", () => {
    // The distinction this suite pins down is the whole point: the caller
    // ends the user's session for RefreshTokenRejectedError and for nothing
    // else, so anything mis-classified here logs people out on an IdP blip.
    function respondWith(status: number, body: string) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body,
          json: async () => JSON.parse(body),
        }),
      );
    }

    it("throws RefreshTokenRejectedError when the IdP says invalid_grant", async () => {
      respondWith(
        400,
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        }),
      );
      const { refreshAccessToken } = await import("./client");
      const { RefreshTokenRejectedError } = await import("./errors");

      await expect(refreshAccessToken("dead-token")).rejects.toBeInstanceOf(
        RefreshTokenRejectedError,
      );
    });

    // Every row below is a response identity's token endpoint can actually
    // return for a refresh_token grant (pkg/httpserver/oauth.go), rather than
    // a shape invented here -- this is the seam where a wrong call logs a real
    // user out, or strands one in a loop they cannot escape.
    it.each([
      ["token row missing or already revoked", 400, "invalid_grant"],
      ["refresh token older than 30 days", 400, "invalid_grant"],
      ["token issued to a different client", 400, "invalid_grant"],
      ["user deactivated in the IdP", 400, "invalid_grant"],
      // Refuses the grant WITHOUT consuming the token, so it repeats forever:
      // classifying it as retryable pins that user in an inescapable loop.
      ["legacy token carrying admin scopes", 400, "invalid_scope"],
      ["refresh_token field missing", 400, "invalid_request"],
    ])("ends the session for %s", async (_l, status, code) => {
      respondWith(status, JSON.stringify({ error: code }));
      const { refreshAccessToken } = await import("./client");
      const { RefreshTokenRejectedError } = await import("./errors");

      const err = await refreshAccessToken("t").catch((e) => e);
      expect(err).toBeInstanceOf(RefreshTokenRejectedError);
    });

    it.each([
      ["a DB error inside the IdP", 400, JSON.stringify({ error: "server_error" })],
      ["our own client credentials being wrong", 401, JSON.stringify({ error: "invalid_client" })],
      ["the rate limiter (plain text, not JSON)", 429, "Rate limit exceeded. Please try again later."],
      ["a chi Recoverer panic with an empty body", 500, ""],
      ["a gateway HTML error page", 502, "<html>502 Bad Gateway</html>"],
      ["a chi Timeout with an empty body", 504, ""],
    ])("keeps the session for %s", async (_l, status, body) => {
      respondWith(status, body);
      const { refreshAccessToken } = await import("./client");
      const { RefreshTokenRejectedError } = await import("./errors");

      const err = await refreshAccessToken("t").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RefreshTokenRejectedError);
    });

    it.each([
      ["null", "null"],
      ["a bare JSON string", '"invalid_grant"'],
      ["an array", "[]"],
      ["a number", "7"],
    ])("does not end the session for %s as a body", async (_l, body) => {
      respondWith(400, body);
      const { refreshAccessToken } = await import("./client");
      const { RefreshTokenRejectedError } = await import("./errors");

      const err = await refreshAccessToken("t").catch((e) => e);
      expect(err).not.toBeInstanceOf(RefreshTokenRejectedError);
    });

    it("returns the token response on success", async () => {
      respondWith(
        200,
        JSON.stringify({
          access_token: "a",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      const { refreshAccessToken } = await import("./client");

      await expect(refreshAccessToken("good-token")).resolves.toMatchObject({
        access_token: "a",
      });
    });
  });

  describe("validateIDPToken", () => {
    // identity mints the web login's tokens for the haruspex client's default
    // resource. Any other aud is a token for some other app (another service's
    // MCP connector, identity's own admin API, ...) that must not become a
    // haruspex session.
    const WEB_AUD = "ethanswan:haruspex";
    const TOKEN = "header.payload.signature";

    async function verifyingWith(aud: unknown) {
      const jose = await import("jose");
      vi.mocked(jose.jwtVerify).mockResolvedValue({
        payload: {
          sub: "user-123",
          username: "u",
          email: "u@example.com",
          email_verified: true,
          iss: "https://identity.example.com",
          aud,
          exp: 2_000_000_000,
          iat: 1_000_000_000,
        },
        protectedHeader: { alg: "ES256" },
      } as never);
      return import("./client");
    }

    it("accepts a token minted for the web client", async () => {
      vi.stubEnv("IDP_AUDIENCE", WEB_AUD);
      const { validateIDPToken } = await verifyingWith(WEB_AUD);
      await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
        sub: "user-123",
      });
    });

    it("accepts it inside an aud array", async () => {
      vi.stubEnv("IDP_AUDIENCE", ` ${WEB_AUD} `);
      const { validateIDPToken } = await verifyingWith(["other", WEB_AUD]);
      await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
        sub: "user-123",
      });
    });

    it("rejects another app's token", async () => {
      vi.stubEnv("IDP_AUDIENCE", WEB_AUD);
      const { validateIDPToken } = await verifyingWith(
        "https://sensibility.money/mcp",
      );
      await expect(validateIDPToken(TOKEN)).rejects.toThrow(/audience/);
    });

    it("rejects a token for identity itself", async () => {
      vi.stubEnv("IDP_AUDIENCE", WEB_AUD);
      const { validateIDPToken } = await verifyingWith(
        "https://identity.example.com",
      );
      await expect(validateIDPToken(TOKEN)).rejects.toThrow(/audience/);
    });

    it("rejects a token with no aud", async () => {
      vi.stubEnv("IDP_AUDIENCE", WEB_AUD);
      const { validateIDPToken } = await verifyingWith(undefined);
      await expect(validateIDPToken(TOKEN)).rejects.toThrow(/audience/);
    });

    it("logs the refusal without the token", async () => {
      vi.stubEnv("IDP_AUDIENCE", WEB_AUD);
      const { validateIDPToken } = await verifyingWith("someone-else");
      const { logger } = await import("@/lib/logger");
      vi.mocked(logger.warn).mockClear();
      await validateIDPToken(TOKEN).catch(() => {});
      expect(logger.warn).toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
        TOKEN,
      );
    });

    it("leaves the audience unchecked when IDP_AUDIENCE is unset", async () => {
      vi.stubEnv("IDP_AUDIENCE", "");
      const { validateIDPToken } = await verifyingWith("anything");
      await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
        sub: "user-123",
      });
    });

    describe("MCP access tokens", () => {
      // An MCP access token (aud = MCP_RESOURCE_URL) must never stand in for
      // a web session cookie, even where IDP_AUDIENCE is not set: it may be
      // read-only, and may be held by a third-party client.
      const MCP_URL = "https://haruspex.fyi/mcp";

      beforeEach(() => {
        vi.stubEnv("IDP_AUDIENCE", "");
      });

      it("rejects a token whose aud is the MCP resource", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", MCP_URL);
        const { validateIDPToken } = await verifyingWith(MCP_URL);
        await expect(validateIDPToken(TOKEN)).rejects.toThrow(/MCP/);
      });

      it("rejects a token whose aud array contains the MCP resource", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", ` ${MCP_URL} `);
        const { validateIDPToken } = await verifyingWith([
          "haruspex-web",
          MCP_URL,
        ]);
        await expect(validateIDPToken(TOKEN)).rejects.toThrow(/MCP/);
      });

      it("logs the rejection without the token", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", MCP_URL);
        const { validateIDPToken } = await verifyingWith(MCP_URL);
        const { logger } = await import("@/lib/logger");
        vi.mocked(logger.warn).mockClear();
        await validateIDPToken(TOKEN).catch(() => {});
        expect(logger.warn).toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
          TOKEN,
        );
      });

      it("accepts a token with some other aud", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", MCP_URL);
        const { validateIDPToken } = await verifyingWith("haruspex-web");
        await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
          sub: "user-123",
        });
      });

      it("does not match the MCP resource as a substring", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", MCP_URL);
        const { validateIDPToken } = await verifyingWith(`${MCP_URL}/extra`);
        await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
          sub: "user-123",
        });
      });

      it("accepts an MCP-aud token unchanged when MCP_RESOURCE_URL is unset", async () => {
        vi.stubEnv("MCP_RESOURCE_URL", "");
        const { validateIDPToken } = await verifyingWith(MCP_URL);
        await expect(validateIDPToken(TOKEN)).resolves.toMatchObject({
          sub: "user-123",
        });
      });
    });
  });
});
