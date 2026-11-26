import fs from "node:fs";

import { test, expect } from "./support/fixtures";
import { APP_HOST, IDP_URL, STATE } from "./support/harness";

test.describe("signed out", () => {
  test("SURPRISE: / stays at / and shows the landing page, not a redirect to /login", async ({
    page,
  }) => {
    await page.goto("/");
    // proxy.ts servesAnonymous("/"): visitors get SignedOutLanding in place.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("link", { name: "Sign in to forecast" }),
    ).toBeVisible();
  });

  test("/login renders the sign-in sheet", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
  });

  test("a page behind login redirects to /login with the way back", async ({
    page,
  }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?redirect=%252Faccount$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("GET /oauth/login redirects to the IdP with a PKCE S256 challenge", async ({
    request,
  }) => {
    const response = await request.get("/oauth/login", { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    const location = new URL(response.headers()["location"]);
    expect(location.origin).toBe(IDP_URL);
    expect(location.pathname).toBe("/oauth/authorize");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("SURPRISE: rejects a token with the wrong audience by treating it as signed out, not by redirecting", async ({
    page,
    context,
  }) => {
    const token = fs.readFileSync(STATE.wrongAudienceToken, "utf8");
    // A well-formed token, correctly signed by the IdP the app trusts, for
    // another app's audience. Without the audience check the app would sign
    // this browser in as the seeded reader (reader.e2e.ts shows what that
    // looks like with the right audience).
    await context.addCookies([
      {
        name: "token",
        value: token,
        domain: APP_HOST,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    // proxy.ts only checks that a token exists and has not expired; the page
    // is what refuses it, so there is no redirect to /login.
    await page.goto("/account");
    await expect(page.getByText("You are not signed in.")).toBeVisible();
    await expect(page.getByText("E2E Reader")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // "/" shows the landing page, not the reader's dashboard.
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "Sign in to forecast" }),
    ).toBeVisible();
    await expect(page.getByText("Public competitions")).toHaveCount(0);
  });

  test("SURPRISE: /help is served to signed-out visitors", async ({ page }) => {
    await page.goto("/help");
    // Not in PUBLIC_ROUTES, but servesAnonymous() lets it through.
    await expect(page).toHaveURL(/\/help$/);
    await expect(
      page.getByRole("heading", { name: "Help", level: 1 }),
    ).toBeVisible();
  });
});
