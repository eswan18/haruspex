import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/idp/client", () => ({
  exchangeCodeForTokens: vi.fn(),
  validateIDPToken: vi.fn(),
  fetchUserInfo: vi.fn(),
  buildNameFromUserInfo: vi.fn(),
}));

vi.mock("@/lib/db_actions/identity-login-flag", () => ({
  getUserByIdpUserId: vi.fn(),
  createUserFromIdp: vi.fn(),
  syncUserFromIdp: vi.fn(),
}));

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));

import * as idp from "@/lib/idp/client";
import * as users from "@/lib/db_actions/identity-login-flag";
import { GET } from "./route";

const BASE = "https://haruspex.test";

function callback(query: string) {
  return GET(new NextRequest(`${BASE}/oauth/callback?${query}`));
}

function setCookies(c: Record<string, string>) {
  for (const [k, v] of Object.entries(c)) jar.values.set(k, v);
}

/** Cookies a normal login would have left behind. */
function validCookies(extra: Record<string, string> = {}) {
  setCookies({
    oauth_state: "st",
    oauth_code_verifier: "ver",
    oauth_return_url: "/competitions/3",
    ...extra,
  });
}

function location(res: Response) {
  return res.headers.get("location");
}

function setNames() {
  return jar.set.mock.calls.map((c) => c[0]);
}

function expectRedirectWithoutSession(res: Response, target: string) {
  expect(res.status).toBe(307);
  expect(location(res)).toBe(`${BASE}${target}`);
  expect(setNames()).not.toContain("token");
  expect(setNames()).not.toContain("refresh_token");
}

const claims = {
  sub: "idp-1",
  email: "pat.smith@example.com",
  username: "patty",
};

const dbUser = { id: 42, deactivated_at: null };

describe("GET /oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jar.values.clear();
    jar.get.mockImplementation((name: string) => {
      const value = jar.values.get(name);
      return value === undefined ? undefined : { name, value };
    });
    vi.stubEnv("APP_BASE_URL", BASE);
    vi.stubEnv("NODE_ENV", "test");

    vi.mocked(idp.exchangeCodeForTokens).mockResolvedValue({
      access_token: "access-1",
      token_type: "Bearer",
      expires_in: 900,
    } as never);
    vi.mocked(idp.validateIDPToken).mockResolvedValue(claims as never);
    vi.mocked(idp.fetchUserInfo).mockResolvedValue({
      picture: "https://img.test/p.png",
    } as never);
    vi.mocked(idp.buildNameFromUserInfo).mockReturnValue("Pat Smith");
    vi.mocked(users.getUserByIdpUserId).mockResolvedValue(dbUser as never);
    vi.mocked(users.createUserFromIdp).mockResolvedValue(dbUser as never);
    vi.mocked(users.syncUserFromIdp).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("rejections before token exchange", () => {
    it("redirects IdP errors using error_description", async () => {
      validCookies();
      const res = await callback("error=access_denied&error_description=Nope");
      expectRedirectWithoutSession(res, "/login?error=Nope");
      expect(idp.exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it("falls back to the error code when there is no description", async () => {
      const res = await callback("error=access_denied");
      expectRedirectWithoutSession(res, "/login?error=access_denied");
    });

    it("rejects a missing code", async () => {
      validCookies();
      const res = await callback("state=st");
      expectRedirectWithoutSession(res, "/login?error=Missing+authorization+code");
    });

    it("rejects a missing state", async () => {
      validCookies();
      const res = await callback("code=c1");
      expectRedirectWithoutSession(res, "/login?error=Missing+authorization+code");
    });

    it("rejects a state that differs from the cookie", async () => {
      validCookies();
      const res = await callback("code=c1&state=other");
      expectRedirectWithoutSession(res, "/login?error=Invalid+state");
      expect(idp.exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it("rejects when there is no state cookie", async () => {
      setCookies({ oauth_code_verifier: "ver" });
      const res = await callback("code=c1&state=st");
      expectRedirectWithoutSession(res, "/login?error=Invalid+state");
    });

    it("rejects when there is no verifier cookie", async () => {
      setCookies({ oauth_state: "st" });
      const res = await callback("code=c1&state=st");
      expectRedirectWithoutSession(res, "/login?error=Missing+code+verifier");
      expect(idp.exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it("builds redirects from the request origin when APP_BASE_URL is unset", async () => {
      vi.stubEnv("APP_BASE_URL", undefined);
      const res = await GET(
        new NextRequest("http://localhost:3000/oauth/callback?error=x&error_description=Nope"),
      );
      expect(location(res)).toBe("http://localhost:3000/login?error=Nope");
    });
  });

  describe("successful sign-in", () => {
    it("creates a new user, sets the session cookie, clears oauth cookies and redirects to the return URL", async () => {
      validCookies();
      vi.mocked(users.getUserByIdpUserId).mockResolvedValue(null as never);

      const res = await callback("code=c1&state=st");

      expect(res.status).toBe(307);
      expect(location(res)).toBe(`${BASE}/competitions/3`);

      expect(idp.exchangeCodeForTokens).toHaveBeenCalledWith(
        "c1",
        "ver",
        `${BASE}/oauth/callback`,
      );
      expect(idp.validateIDPToken).toHaveBeenCalledWith("access-1");
      expect(idp.fetchUserInfo).toHaveBeenCalledWith("access-1");
      expect(users.getUserByIdpUserId).toHaveBeenCalledWith("idp-1");
      expect(users.createUserFromIdp).toHaveBeenCalledWith({
        idpUserId: "idp-1",
        email: "pat.smith@example.com",
        name: "Pat Smith",
        username: "patty",
        pictureUrl: "https://img.test/p.png",
      });
      expect(users.syncUserFromIdp).not.toHaveBeenCalled();

      expect(jar.set).toHaveBeenCalledWith("token", "access-1", {
        httpOnly: true,
        secure: false,
        maxAge: 900,
        sameSite: "lax",
        path: "/",
      });
      expect(jar.delete.mock.calls.map((c) => c[0]).sort()).toEqual([
        "oauth_code_verifier",
        "oauth_return_url",
        "oauth_state",
      ]);
    });

    it("marks the session cookie secure in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      validCookies();
      await callback("code=c1&state=st");
      expect(jar.set.mock.calls.find((c) => c[0] === "token")?.[2]).toMatchObject({
        secure: true,
      });
    });

    it("defaults the return URL to / when the cookie is absent", async () => {
      setCookies({ oauth_state: "st", oauth_code_verifier: "ver" });
      const res = await callback("code=c1&state=st");
      expect(location(res)).toBe(`${BASE}/`);
    });

    describe("new-user name fallback", () => {
      beforeEach(() => {
        validCookies();
        vi.mocked(users.getUserByIdpUserId).mockResolvedValue(null as never);
      });

      it("uses the user info name first", async () => {
        await callback("code=c1&state=st");
        expect(vi.mocked(users.createUserFromIdp).mock.calls[0][0].name).toBe("Pat Smith");
      });

      it("falls back to claims.username", async () => {
        vi.mocked(idp.buildNameFromUserInfo).mockReturnValue(null);
        await callback("code=c1&state=st");
        expect(vi.mocked(users.createUserFromIdp).mock.calls[0][0].name).toBe("patty");
      });

      it("falls back to the email prefix, with username and picture null", async () => {
        vi.mocked(idp.buildNameFromUserInfo).mockReturnValue(null);
        vi.mocked(idp.validateIDPToken).mockResolvedValue({
          sub: "idp-1",
          email: "pat.smith@example.com",
        } as never);
        vi.mocked(idp.fetchUserInfo).mockResolvedValue({} as never);
        await callback("code=c1&state=st");
        expect(users.createUserFromIdp).toHaveBeenCalledWith({
          idpUserId: "idp-1",
          email: "pat.smith@example.com",
          name: "pat.smith",
          username: null,
          pictureUrl: null,
        });
      });
    });

    it("syncs an existing user without creating one", async () => {
      validCookies();
      const res = await callback("code=c1&state=st");

      expect(users.syncUserFromIdp).toHaveBeenCalledWith(42, {
        email: "pat.smith@example.com",
        username: "patty",
        name: "Pat Smith",
        pictureUrl: "https://img.test/p.png",
      });
      expect(users.createUserFromIdp).not.toHaveBeenCalled();
      expect(location(res)).toBe(`${BASE}/competitions/3`);
      expect(setNames()).toContain("token");
    });

    it("sets refresh_token (30 days) only when the IdP returns one", async () => {
      validCookies();
      vi.mocked(idp.exchangeCodeForTokens).mockResolvedValue({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 900,
      } as never);
      await callback("code=c1&state=st");
      expect(jar.set).toHaveBeenCalledWith("refresh_token", "refresh-1", {
        httpOnly: true,
        secure: false,
        maxAge: 30 * 24 * 60 * 60,
        sameSite: "lax",
        path: "/",
      });
    });

    it("does not set refresh_token when the IdP returns none", async () => {
      validCookies();
      await callback("code=c1&state=st");
      expect(setNames()).toEqual(["token"]);
    });
  });

  describe("failures after token exchange", () => {
    it("rejects a deactivated user with no session cookies and keeps oauth cookies", async () => {
      validCookies();
      vi.mocked(idp.exchangeCodeForTokens).mockResolvedValue({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 900,
      } as never);
      vi.mocked(users.getUserByIdpUserId).mockResolvedValue({
        id: 42,
        deactivated_at: new Date("2026-01-01"),
      } as never);

      const res = await callback("code=c1&state=st");

      expectRedirectWithoutSession(res, "/login?error=Account+is+deactivated");
      expect(jar.set).not.toHaveBeenCalled();
      // Pinned: the handler still syncs a deactivated user's profile before the check.
      expect(users.syncUserFromIdp).toHaveBeenCalledWith(42, expect.any(Object));
    });

    it("rejects when createUserFromIdp returns null", async () => {
      validCookies();
      vi.mocked(users.getUserByIdpUserId).mockResolvedValue(null as never);
      vi.mocked(users.createUserFromIdp).mockResolvedValue(null as never);
      const res = await callback("code=c1&state=st");
      expectRedirectWithoutSession(res, "/login?error=Failed+to+create+user");
    });

    it("rejects when exchangeCodeForTokens throws", async () => {
      validCookies();
      vi.mocked(idp.exchangeCodeForTokens).mockRejectedValue(new Error("bad code"));
      const res = await callback("code=c1&state=st");
      expectRedirectWithoutSession(res, "/login?error=Authentication+failed");
      expect(idp.validateIDPToken).not.toHaveBeenCalled();
    });

    it("rejects when validateIDPToken throws", async () => {
      validCookies();
      vi.mocked(idp.validateIDPToken).mockRejectedValue(new Error("bad jwt"));
      const res = await callback("code=c1&state=st");
      expectRedirectWithoutSession(res, "/login?error=Authentication+failed");
      expect(users.getUserByIdpUserId).not.toHaveBeenCalled();
    });
  });

  describe("stored return URL", () => {
    async function withReturnUrl(value: string) {
      validCookies({ oauth_return_url: value });
      return callback("code=c1&state=st");
    }

    it("SURPRISE: an absolute return URL is followed to the other origin (open redirect)", async () => {
      const res = await withReturnUrl("https://evil.example/");
      expect(res.status).toBe(307);
      expect(location(res)).toBe("https://evil.example/");
      expect(setNames()).toContain("token");
    });

    it("SURPRISE: a protocol-relative return URL is followed to the other origin (open redirect)", async () => {
      const res = await withReturnUrl("//evil.example/");
      expect(res.status).toBe(307);
      expect(location(res)).toBe("https://evil.example/");
      expect(setNames()).toContain("token");
    });

    it("keeps a plain relative path on the app origin", async () => {
      const res = await withReturnUrl("/competitions/3");
      expect(location(res)).toBe(`${BASE}/competitions/3`);
    });
  });
});
