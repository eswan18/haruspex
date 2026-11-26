import { test, expect } from "./support/fixtures";
import { STATE, readSeed } from "./support/harness";

test.use({ storageState: STATE.user });

const seed = readSeed();
const competitionUrl = `/competitions/${seed.competition.id}`;

test.describe("reader", () => {
  test("/ shows the dashboard with the seeded competition", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Public competitions")).toBeVisible();
    await expect(
      page.getByText(seed.competition.name, { exact: true }),
    ).toBeVisible();
  });

  test("SURPRISE: the competition page counts the resolved prop among 'All 2 open'", async ({
    page,
  }) => {
    await page.goto(competitionUrl);
    await expect(
      page.getByRole("heading", { name: seed.competition.name }),
    ).toBeVisible();
    // 2 props, one of them resolved, and the overview calls both "open": open
    // means the competition still takes forecasts, not "unresolved". The
    // resolved prop's text is not on this page, so its count is what is pinned.
    await expect(page.getByRole("link", { name: /All 2 open/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Resolved/ })).toBeVisible();
  });

  test("the open props list, unfiltered, lists both props", async ({
    page,
  }) => {
    await page.goto(`${competitionUrl}/props/open`);
    // The default cut is "To do", which drops what the reader has forecast
    // (the forecast check below moves the open prop out of it), so ask for All.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText(seed.openProp.text)).toBeVisible();
    await expect(page.getByText(seed.resolvedProp.text)).toBeVisible();
  });

  test("resolved props lists the resolved prop and not the open one", async ({
    page,
  }) => {
    await page.goto(`${competitionUrl}/props/resolved`);
    await expect(page.getByText(seed.resolvedProp.text)).toBeVisible();
    // The list is streamed: the open prop's absence only means something once
    // the resolved prop, which is on the same page, has rendered.
    await expect(page.getByText(seed.openProp.text)).toHaveCount(0);
  });

  test("forecasting an open prop at 70% survives a reload", async ({
    page,
  }) => {
    await page.goto(`${competitionUrl}/props/${seed.openProp.id}`);
    await expect(page.getByText("Not set")).toBeVisible();

    await page.getByRole("button", { name: "—" }).click();
    await page
      .getByRole("textbox", { name: "Your forecast, percent" })
      .fill("70");
    await page
      .getByRole("textbox", { name: "Your forecast, percent" })
      .press("Enter");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Forecast recorded", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "70%" })).toBeVisible();
    await expect(
      page.getByText("Your forecast", { exact: true }).first(),
    ).toBeVisible();
  });

  test("standings rank the reader with their score", async ({ page }) => {
    await page.goto(`/competitions/${seed.standingsCompetition.id}/standings`);
    await expect(page.getByText("0.040").first()).toBeVisible();
    await expect(page.getByText(/of 1 ·/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /E2E Reader/ }),
    ).toBeVisible();
  });

  test("/account shows the reader's name", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByText("E2E Reader").first()).toBeVisible();
    await expect(page.getByText("reader@example.com")).toBeVisible();
  });

  test("/help renders", async ({ page }) => {
    await page.goto("/help");
    await expect(page).toHaveURL(/\/help$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Help" }),
    ).toBeVisible();
  });

  test("/admin refuses a non-admin with a No access page", async ({ page }) => {
    await page.goto("/admin");
    // Not a redirect: the admin layout renders InaccessiblePage in place.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByText("Only admins can see this page."),
    ).toBeVisible();
    await expect(page.getByText("No access")).toBeVisible();
  });
});
