import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock cookies - supports different values for different cookie names
const mockCookies: Record<string, { value: string } | undefined> = {};
const mockCookieGet = vi.fn((name: string) => mockCookies[name]);
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: mockCookieGet,
  }),
}));

// Set JWT_SECRET for impersonation token tests
process.env.JWT_SECRET = "test-secret-key-for-testing";

// Helper to create a valid impersonation token
function createTestImpersonationToken(
  userId: number,
  adminId: number,
  timestamp: number = Date.now(),
): string {
  const data = `${userId}:${adminId}:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET!)
    .update(data)
    .digest("hex");
  return `${data}:${signature}`;
}

// Mock database - support both executeTakeFirst and executeTakeFirstOrThrow
const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockWhere = vi.fn(() => ({
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  executeTakeFirst: mockExecuteTakeFirst,
}));
const mockSelectAll = vi.fn(() => ({ where: mockWhere }));
const mockSelectFrom = vi.fn(() => ({ selectAll: mockSelectAll }));

vi.mock("@/lib/database", () => ({
  db: {
    selectFrom: mockSelectFrom,
  },
}));

// Mock IDP client
const mockValidateIDPToken = vi.fn();
vi.mock("@/lib/idp/client", () => ({
  validateIDPToken: mockValidateIDPToken,
}));

// Mock the active-day recorder: it writes through the database helpers, and
// what matters here is only whether, and for whom, it is called.
const mockRecordActiveDay = vi.fn();
vi.mock("@/lib/active-days", () => ({
  recordActiveDay: mockRecordActiveDay,
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("getUserFromCookies - IDP Token Support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear mock cookies
    Object.keys(mockCookies).forEach((key) => delete mockCookies[key]);
  });

  describe("when no token cookie exists", () => {
    it("should return null", async () => {
      // mockCookies is empty by default

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toBeNull();
    });
  });

  describe("with IDP token", () => {
    it("should return user when IDP token is valid", async () => {
      const mockUser = {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        username: "testuser",
        idp_user_id: "idp-uuid-123",
        is_admin: false,
        deactivated_at: null,
        login_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCookies["token"] = { value: "idp-access-token" };
      mockValidateIDPToken.mockResolvedValue({
        sub: "idp-uuid-123",
        username: "testuser",
        email: "test@example.com",
        email_verified: true,
      });
      mockExecuteTakeFirstOrThrow.mockResolvedValue(mockUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(mockValidateIDPToken).toHaveBeenCalledWith("idp-access-token");
      expect(result).toEqual(mockUser);
      expect(mockRecordActiveDay).toHaveBeenCalledWith(1);
    });

    it("should return null for deactivated user with IDP token", async () => {
      const mockUser = {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        username: "testuser",
        idp_user_id: "idp-uuid-123",
        is_admin: false,
        deactivated_at: new Date(), // Deactivated!
        login_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCookies["token"] = { value: "idp-access-token" };
      mockValidateIDPToken.mockResolvedValue({
        sub: "idp-uuid-123",
        username: "testuser",
        email: "test@example.com",
        email_verified: true,
      });
      mockExecuteTakeFirstOrThrow.mockResolvedValue(mockUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toBeNull();
    });

    it("should return null when IDP token validation fails", async () => {
      mockCookies["token"] = { value: "invalid-token" };
      mockValidateIDPToken.mockRejectedValue(new Error("Token expired"));

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toBeNull();
    });
  });

  describe("getUserFromToken", () => {
    it("should work with IDP token", async () => {
      const mockUser = {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        username: "testuser",
        idp_user_id: "idp-uuid-123",
        is_admin: false,
        deactivated_at: null,
        login_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockValidateIDPToken.mockResolvedValue({
        sub: "idp-uuid-123",
        username: "testuser",
        email: "test@example.com",
        email_verified: true,
      });
      mockExecuteTakeFirstOrThrow.mockResolvedValue(mockUser);

      const { getUserFromToken } = await import("./get-user");
      const result = await getUserFromToken("idp-access-token");

      expect(result).toEqual(mockUser);
    });

    it("should return null when token validation fails", async () => {
      mockValidateIDPToken.mockRejectedValue(new Error("Invalid token"));

      const { getUserFromToken } = await import("./get-user");
      const result = await getUserFromToken("invalid-token");

      expect(result).toBeNull();
    });
  });

  describe("impersonation", () => {
    const adminUser = {
      id: 1,
      name: "Admin User",
      email: "admin@example.com",
      username: "admin",
      idp_user_id: "admin-idp-uuid",
      is_admin: true,
      deactivated_at: null,
      login_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const targetUser = {
      id: 2,
      name: "Target User",
      email: "target@example.com",
      username: "target",
      idp_user_id: "target-idp-uuid",
      is_admin: false,
      deactivated_at: null,
      login_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    it("should return impersonated user when admin has valid impersonation cookie", async () => {
      // Set up admin token and impersonation cookie
      mockCookies["token"] = { value: "admin-idp-token" };
      mockCookies["impersonate"] = {
        value: createTestImpersonationToken(2, 1),
      };

      mockValidateIDPToken.mockResolvedValue({
        sub: "admin-idp-uuid",
        username: "admin",
        email: "admin@example.com",
        email_verified: true,
      });

      // First call returns admin user (for OAuth validation)
      // Second call returns target user (for impersonation lookup)
      mockExecuteTakeFirstOrThrow.mockResolvedValue(adminUser);
      mockExecuteTakeFirst.mockResolvedValue(targetUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toEqual(targetUser);
      // An admin looking around as someone is not that person using the site.
      expect(mockRecordActiveDay).not.toHaveBeenCalled();
    });

    it("should return real user when impersonation token is invalid", async () => {
      mockCookies["token"] = { value: "admin-idp-token" };
      mockCookies["impersonate"] = { value: "invalid:token:format" };

      mockValidateIDPToken.mockResolvedValue({
        sub: "admin-idp-uuid",
        username: "admin",
        email: "admin@example.com",
        email_verified: true,
      });

      mockExecuteTakeFirstOrThrow.mockResolvedValue(adminUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toEqual(adminUser);
    });

    it("should return real user when impersonation token has wrong admin ID", async () => {
      // Create token with different admin ID (999) than the logged in admin (1)
      mockCookies["token"] = { value: "admin-idp-token" };
      mockCookies["impersonate"] = {
        value: createTestImpersonationToken(2, 999),
      };

      mockValidateIDPToken.mockResolvedValue({
        sub: "admin-idp-uuid",
        username: "admin",
        email: "admin@example.com",
        email_verified: true,
      });

      mockExecuteTakeFirstOrThrow.mockResolvedValue(adminUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toEqual(adminUser);
    });

    it("should return real user when impersonation token is expired", async () => {
      // Create token with timestamp from 2 hours ago (exceeds 1 hour expiry)
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      mockCookies["token"] = { value: "admin-idp-token" };
      mockCookies["impersonate"] = {
        value: createTestImpersonationToken(2, 1, twoHoursAgo),
      };

      mockValidateIDPToken.mockResolvedValue({
        sub: "admin-idp-uuid",
        username: "admin",
        email: "admin@example.com",
        email_verified: true,
      });

      mockExecuteTakeFirstOrThrow.mockResolvedValue(adminUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toEqual(adminUser);
    });

    it("should ignore impersonation cookie for non-admin users", async () => {
      const regularUser = { ...adminUser, is_admin: false };

      mockCookies["token"] = { value: "user-idp-token" };
      mockCookies["impersonate"] = {
        value: createTestImpersonationToken(2, 1),
      };

      mockValidateIDPToken.mockResolvedValue({
        sub: "admin-idp-uuid",
        username: "admin",
        email: "admin@example.com",
        email_verified: true,
      });

      mockExecuteTakeFirstOrThrow.mockResolvedValue(regularUser);

      const { getUserFromCookies } = await import("./get-user");
      const result = await getUserFromCookies();

      expect(result).toEqual(regularUser);
    });
  });
});
