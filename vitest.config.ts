import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./"),
      // The real package throws outside a React Server Components build;
      // under test there is no client/server split to guard.
      "server-only": path.resolve(
        dirname,
        "./tests/helpers/server-only-stub.ts",
      ),
    },
  },
  test: {
    name: "unit",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/stories/**",
      // Playwright's smoke suite, run by `npm run test:e2e`.
      "**/e2e/**",
      // Git worktrees live here and are full second checkouts of this repo,
      // so every test file in them would be collected twice.
      "**/.claude/worktrees/**",
    ],
    environment: "node",
    globals: true,
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 60000, // 60 seconds for testcontainer startup
    hookTimeout: 300000, // 5 minutes for setup/teardown hooks
    fileParallelism: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        ".next/",
        "stories/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/mockData.ts",
        "components/ui/**", // Exclude UI components from coverage as they're tested in Storybook
      ],
    },
  },
});
