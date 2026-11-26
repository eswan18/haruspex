import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/idp/client", () => ({
  getAuthorizationUrl: vi.fn(),
  generateRandomString: vi.fn(),
  generateCodeChallenge: vi.fn(),
}));

const store = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => store) }));

import * as idp from "@/lib/idp/client";
import { GET } from "./route";

const IDP_URL = "https://idp.test/authorize?x=1";

function cookieCall(name: string) {
  return store.set.mock.calls.find((c) => c[0] === name);
}

describe("GET /oauth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(idp.generateRandomString).mockImplementation((n = 32) => `rand${n}`);
    vi.mocked(idp.generateCodeChallenge).mockResolvedValue("challenge-abc");
    vi.mocked(idp.getAuthorizationUrl).mockReturnValue(IDP_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores state, verifier and return URL in short-lived httpOnly cookies and redirects to the IdP", async () => {
    const res = await GET(
      new NextRequest("https://haruspex.test/oauth/login?returnUrl=/competitions/3"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(IDP_URL);

    const opts = {
      httpOnly: true,
      secure: false,
      maxAge: 600,
      sameSite: "lax",
      path: "/",
    };
    expect(store.set).toHaveBeenCalledTimes(3);
    expect(cookieCall("oauth_state")).toEqual(["oauth_state", "rand32", opts]);
    expect(cookieCall("oauth_code_verifier")).toEqual([
      "oauth_code_verifier",
      "rand64",
      opts,
    ]);
    expect(cookieCall("oauth_return_url")).toEqual([
      "oauth_return_url",
      "/competitions/3",
      opts,
    ]);

    expect(idp.generateCodeChallenge).toHaveBeenCalledWith("rand64");
    expect(idp.getAuthorizationUrl).toHaveBeenCalledWith(
      "rand32",
      "challenge-abc",
      "https://haruspex.test/oauth/callback",
    );
  });

  it("marks cookies secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await GET(new NextRequest("https://haruspex.test/oauth/login"));
    for (const name of ["oauth_state", "oauth_code_verifier", "oauth_return_url"]) {
      expect(cookieCall(name)?.[2]).toMatchObject({ secure: true });
    }
  });

  it("defaults returnUrl to /", async () => {
    await GET(new NextRequest("https://haruspex.test/oauth/login"));
    expect(cookieCall("oauth_return_url")?.[1]).toBe("/");
  });

  it("uses APP_BASE_URL for redirect_uri when set", async () => {
    vi.stubEnv("APP_BASE_URL", "https://public.example");
    await GET(new NextRequest("http://localhost:3000/oauth/login"));
    expect(vi.mocked(idp.getAuthorizationUrl).mock.calls[0][2]).toBe(
      "https://public.example/oauth/callback",
    );
  });

  it("uses the request origin for redirect_uri when APP_BASE_URL is unset", async () => {
    vi.stubEnv("APP_BASE_URL", undefined);
    await GET(new NextRequest("http://localhost:3000/oauth/login"));
    expect(vi.mocked(idp.getAuthorizationUrl).mock.calls[0][2]).toBe(
      "http://localhost:3000/oauth/callback",
    );
  });

  it("redirects to /login?error=Failed+to+start+login when the code challenge fails", async () => {
    vi.mocked(idp.generateCodeChallenge).mockRejectedValue(new Error("boom"));
    const res = await GET(new NextRequest("https://haruspex.test/oauth/login"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://haruspex.test/login?error=Failed+to+start+login",
    );
    expect(store.set).not.toHaveBeenCalled();
    expect(idp.getAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("builds the failure redirect from the request origin when APP_BASE_URL is unset", async () => {
    vi.stubEnv("APP_BASE_URL", undefined);
    vi.mocked(idp.generateCodeChallenge).mockRejectedValue(new Error("boom"));
    const res = await GET(new NextRequest("http://localhost:3000/oauth/login"));
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=Failed+to+start+login",
    );
  });
});
