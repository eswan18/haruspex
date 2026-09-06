import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to allow importing in tests
vi.mock("server-only", () => ({}));

// Mock jose to avoid issues with crypto in tests
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  base64url: { encode: vi.fn() },
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

    it.each([
      ["a 503 with an HTML body", 503, "<html>502 Bad Gateway</html>"],
      ["a 500 with an empty body", 500, ""],
      [
        "a 400 that is some other OAuth error",
        400,
        JSON.stringify({ error: "invalid_client" }),
      ],
      ["a 429 from a rate limiter", 429, "Rate limit exceeded."],
    ])("does not report %s as a rejected grant", async (_l, status, body) => {
      respondWith(status, body);
      const { refreshAccessToken } = await import("./client");
      const { RefreshTokenRejectedError } = await import("./errors");

      const err = await refreshAccessToken("good-token").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
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
});
