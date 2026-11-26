import { defineConfig, devices } from "@playwright/test";

import { APP_URL } from "./e2e/support/harness";

/**
 * Browser smoke checks against the production build (`npm run build` first).
 * Global setup starts Postgres, a stub IdP and the app; see e2e/global-setup.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // One app and one database for the whole run: checks that write (forecast,
  // resolve) must not race the checks that read what they change.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The forecast and resolve checks mutate seeded data once per run, so a retry
  // would run against already-changed data and fail for the wrong reason.
  retries: 0,
  reporter: "list",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
