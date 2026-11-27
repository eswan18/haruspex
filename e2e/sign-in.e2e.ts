import type { APIRequestContext } from "@playwright/test";

import { test, expect } from "./support/fixtures";
import { APP_URL, IDP_URL } from "./support/harness";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  NEWCOMER,
  NEWCOMER_NAME,
  REDIRECT_URI,
  type TokenRequest,
} from "./support/idp-stub";

// Every other spec injects a session cookie. This one signs in the way a
// person does, through the app's real OAuth routes and the stub IdP, as
// someone the app has never seen.

async function tokenRequests(
  request: APIRequestContext,
): Promise<TokenRequest[]> {
  const response = await request.get(`${IDP_URL}/_stub/token-requests`);
  expect(response.status()).toBe(200);
  return (await response.json()) as TokenRequest[];
}

test("signing in through the IdP creates the new user and signs them in", async ({
  page,
  request,
}) => {
  const navigations: string[] = [];
  page.on("request", (sent) => {
    if (sent.isNavigationRequest()) {
      const { origin, pathname } = new URL(sent.url());
      navigations.push(`${origin}${pathname}`);
    }
  });

  // Signed out, a page behind login sends the browser to the sign-in sheet.
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();

  // The stub approves at once; the callback creates the user, signs the
  // browser in and sends it back to the page it asked for.
  await expect(page.getByText(NEWCOMER.email)).toBeVisible();
  await expect(page).toHaveURL(`${APP_URL}/account`);
  // Named from the IdP's profile, so this account was made by this sign-in:
  // the seed has no one by that name.
  await expect(page.getByText(NEWCOMER_NAME).first()).toBeVisible();
  const authorize = navigations.indexOf(`${IDP_URL}/oauth/authorize`);
  expect(authorize, navigations.join("\n")).toBeGreaterThanOrEqual(0);
  expect(
    navigations.indexOf(`${APP_URL}/oauth/callback`),
    navigations.join("\n"),
  ).toBeGreaterThan(authorize);

  // The app traded its code with the verifier behind the challenge it sent.
  const issued = (await tokenRequests(request)).filter(
    (sent) => sent.outcome === "issued",
  );
  expect(issued).toEqual([
    { grant_type: "authorization_code", pkce: "verified", outcome: "issued" },
  ]);
});

test("the stub IdP refuses a code traded with the wrong PKCE verifier", async ({
  request,
}) => {
  // What makes "verified" above mean something: the stub does check.
  const verifier = "a".repeat(64);
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const authorize = await request.get(`${IDP_URL}/oauth/authorize`, {
    params: {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
    },
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const code = new URL(authorize.headers()["location"]).searchParams.get(
    "code",
  );
  expect(code).toBeTruthy();

  const before = (await tokenRequests(request)).length;
  const token = await request.post(`${IDP_URL}/oauth/token`, {
    form: {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: "b".repeat(64),
    },
  });
  expect(token.status()).toBe(400);
  expect(await token.json()).toEqual({ error: "invalid_grant" });
  expect((await tokenRequests(request)).slice(before)).toEqual([
    {
      grant_type: "authorization_code",
      pkce: "mismatch",
      outcome: "invalid_grant",
    },
  ]);
});
