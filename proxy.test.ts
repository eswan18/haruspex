import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { RefreshTokenRejectedError } from "@/lib/idp/errors";

const { mockRefreshAccessToken } = vi.hoisted(() => ({
  mockRefreshAccessToken: vi.fn(),
}));
vi.mock("@/lib/idp/client", () => ({
  refreshAccessToken: mockRefreshAccessToken,
}));


const FRESH_JWT = (() => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString(
    "base64url",
  );
  return `${header}.${body}.sig`;
})();

const EXPIRED_JWT = (() => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp: 1_000_000_000 })).toString(
    "base64url",
  );
  return `${header}.${body}.sig`;
})();

const NEAR_EXPIRY_JWT = (() => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 }),
  ).toString("base64url");
  return `${header}.${body}.sig`;
})();

function makeRequest(path: string, cookieHeader = ""): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

afterEach(() => mockRefreshAccessToken.mockReset());

describe("proxy: public routes", () => {

  it("passes /login through without touching the token", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/login"));
    expect(res.status).toBe(200);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("passes /oauth/callback through", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/oauth/callback"));
    expect(res.status).toBe(200);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });
});

describe("proxy: protected routes with no token", () => {

  it("redirects to /login when no token cookie exists", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/forecasts"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("serves the home page to visitors instead of redirecting", async () => {
    // "/" is the signed-out landing page, so an anonymous visitor is let
    // through rather than bounced to /login.
    const { proxy } = await import("./proxy");
    const res = await proxy(makeRequest("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("preserves the original path in the redirect query string", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/forecasts"));
    const url = new URL(res.headers.get("location") ?? "");
    const redirect = url.searchParams.get("redirect") ?? "";
    // proxy.ts double-encodes (encodeURIComponent + searchParams.set).
    expect(decodeURIComponent(redirect)).toBe("/forecasts");
  });
});

describe("proxy: protected routes with fresh token", () => {

  it("passes the request through without calling refresh", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/forecasts", `token=${FRESH_JWT}`));
    expect(res.status).toBe(200);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(res.cookies.get("token")).toBeUndefined();
  });
});

describe("proxy: protected routes with expired token", () => {

  it("redirects to /login when no refresh_token cookie exists", async () => {
    const { proxy } = await import("./proxy");
  const res = await proxy(makeRequest("/forecasts", `token=${EXPIRED_JWT}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("sets a new token cookie when refresh succeeds", async () => {
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 3600,
    });

    const { proxy } = await import("./proxy");
  const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
      ),
    );

    expect(mockRefreshAccessToken).toHaveBeenCalledWith("refresh-xyz");
    expect(res.status).toBe(200);
    const tokenCookie = res.cookies.get("token");
    expect(tokenCookie?.value).toBe("new-access");
    expect(tokenCookie?.maxAge).toBe(3600);
    // Cookie security attributes — protect against accidental regressions.
    expect(tokenCookie?.httpOnly).toBe(true);
    expect(tokenCookie?.sameSite).toBe("lax");
    expect(tokenCookie?.path).toBe("/");
    expect(res.cookies.get("refresh_token")).toBeUndefined();
  });

  it("forwards the new token to downstream handlers on the same request", async () => {
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 3600,
    });

    const { proxy } = await import("./proxy");
    const req = makeRequest(
      "/forecasts",
      `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
    );
    await proxy(req);

    // Server components rendered on THIS request should see the new token,
    // not the stale one the browser sent.
    expect(req.cookies.get("token")?.value).toBe("new-access");
  });

  it("keeps the session when the refresh response is malformed", async () => {
    // A 200 with no access_token is a bug at the IdP, not proof that this
    // user's grant is gone -- so the session survives to retry.
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "",
      token_type: "Bearer",
      expires_in: 3600,
    });

    const { proxy } = await import("./proxy");
    const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
      ),
    );

    // Expired token, so it redirects rather than rendering a userless page --
    // but neither auth cookie is cleared.
    expect(res.status).toBe(307);
    expect(res.cookies.get("token")).toBeUndefined();
    expect(res.cookies.get("refresh_token")).toBeUndefined();
  });

  it("updates both cookies when refresh response rotates the refresh_token", async () => {
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "rotated-refresh",
    });

    const { proxy } = await import("./proxy");
  const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.cookies.get("token")?.value).toBe("new-access");
    const refreshCookie = res.cookies.get("refresh_token");
    expect(refreshCookie?.value).toBe("rotated-refresh");
    expect(refreshCookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("redirects to /login and clears both cookies when the IdP rejects the grant", async () => {
    mockRefreshAccessToken.mockRejectedValue(
      new RefreshTokenRejectedError("Refresh token rejected: invalid_grant"),
    );

    const { proxy } = await import("./proxy");
  const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
      ),
    );

    expect(mockRefreshAccessToken).toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    const tokenCookie = res.cookies.get("token");
    expect(tokenCookie?.value).toBe("");
    expect(tokenCookie?.maxAge).toBe(0);
    // Stale refresh_token must also be cleared, otherwise every subsequent
    // navigation triggers the same failing refresh call.
    const refreshCookie = res.cookies.get("refresh_token");
    expect(refreshCookie?.value).toBe("");
    expect(refreshCookie?.maxAge).toBe(0);
  });
});

describe("proxy: a refresh failure that is not the IdP rejecting the grant", () => {
  // Before this, ANY thrown error cleared both cookies. A single 502 from the
  // IdP therefore logged out every signed-in user at once, and each of them
  // had to sign in again despite holding a perfectly good refresh token. Only
  // a deliberate refusal from the IdP is evidence that a session is over.

  const transient = [
    ["the IdP is down", new Error("Failed to refresh token: 503 unavailable")],
    ["the request times out", new Error("fetch failed")],
    ["something throws a non-Error", "boom"],
  ] as const;

  it.each(transient)(
    "keeps both cookies and passes through when %s and the token is still valid",
    async (_label, thrown) => {
      mockRefreshAccessToken.mockRejectedValue(thrown);

      const { proxy } = await import("./proxy");
      const res = await proxy(
        makeRequest(
          "/forecasts",
          `token=${NEAR_EXPIRY_JWT}; refresh_token=refresh-xyz`,
        ),
      );

      // Inside the refresh buffer the token still verifies downstream, so the
      // user notices nothing at all.
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(res.cookies.get("token")).toBeUndefined();
      expect(res.cookies.get("refresh_token")).toBeUndefined();
    },
  );

  it.each(transient)(
    "redirects WITHOUT clearing cookies when %s and the token has expired",
    async (_label, thrown) => {
      mockRefreshAccessToken.mockRejectedValue(thrown);

      const { proxy } = await import("./proxy");
      const res = await proxy(
        makeRequest(
          "/forecasts",
          `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`,
        ),
      );

      // Passing through with a truly expired token resolves no user, and
      // routes like app/competitions/[competitionId]/access.ts dereference it
      // -- so this must redirect rather than render a crash page.
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
      // The point of the whole change: the session is NOT destroyed, so it
      // recovers by itself once the IdP does.
      expect(res.cookies.get("token")).toBeUndefined();
      expect(res.cookies.get("refresh_token")).toBeUndefined();
    },
  );

  it("sets a short backoff cookie so the retries do not pile up", async () => {
    mockRefreshAccessToken.mockRejectedValue(new Error("IdP unreachable"));

    const { proxy } = await import("./proxy");
    const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${NEAR_EXPIRY_JWT}; refresh_token=refresh-xyz`,
      ),
    );

    const backoff = res.cookies.get("refresh_backoff");
    expect(backoff?.value).toBe("1");
    expect(backoff?.maxAge).toBe(30);
    expect(backoff?.httpOnly).toBe(true);
  });

  it("does not call the IdP again while the backoff cookie is set", async () => {
    const { proxy } = await import("./proxy");
    const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${NEAR_EXPIRY_JWT}; refresh_token=refresh-xyz; refresh_backoff=1`,
      ),
    );

    // identity rate-limits 20 req/min on an IP every server-to-server call
    // shares, and that bucket also carries JWKS and the login code exchange.
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.cookies.get("refresh_token")).toBeUndefined();
  });

  it("does not extend its own backoff while skipping", async () => {
    const { proxy } = await import("./proxy");
    const res = await proxy(
      makeRequest(
        "/forecasts",
        `token=${NEAR_EXPIRY_JWT}; refresh_token=refresh-xyz; refresh_backoff=1`,
      ),
    );

    // Re-setting it on every skipped request would hold the backoff open for
    // as long as the user keeps browsing, long after the IdP recovered.
    expect(res.cookies.get("refresh_backoff")).toBeUndefined();
  });

  it("still lets the landing page render for a visitor", async () => {
    mockRefreshAccessToken.mockRejectedValue(new Error("IdP unreachable"));

    const { proxy } = await import("./proxy");
    const res = await proxy(
      makeRequest("/", `token=${EXPIRED_JWT}; refresh_token=refresh-xyz`),
    );

    expect(res.status).toBe(200);
    expect(res.cookies.get("refresh_token")).toBeUndefined();
  });
});
