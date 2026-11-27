import { test, expect } from "./support/fixtures";
import { STATE, readSeed } from "./support/harness";

test.use({ storageState: STATE.admin });

const seed = readSeed();

test.describe("admin", () => {
  test("/admin renders the admin index", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Admin", level: 1 }),
    ).toBeVisible();
  });

  test("/admin/users lists both seeded users", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText(seed.user.email)).toBeVisible();
    await expect(page.getByText(seed.admin.email)).toBeVisible();
  });

  test("resolving a prop as true marks it resolved and lists it under resolved", async ({
    page,
  }) => {
    const base = `/competitions/${seed.resolveCompetition.id}`;
    const propUrl = `${base}/props/${seed.resolvableProp.id}`;

    await page.goto(propUrl);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Open/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resolve proposition" });
    await dialog.getByRole("radio", { name: "True" }).check();
    await dialog.getByRole("button", { name: /^Resolve/ }).click();

    await expect(page.getByText("Resolved · Yes")).toBeVisible();

    await page.goto(`${base}/props/resolved`);
    await expect(page.getByText(seed.resolvableProp.text)).toBeVisible();
  });
});
