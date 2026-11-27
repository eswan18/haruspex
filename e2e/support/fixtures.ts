/**
 * `test` and `expect` for every smoke spec. Import these, not
 * `@playwright/test`'s: this `page` fails the test after it finishes if the
 * page threw an uncaught error or the server answered any request with a 5xx,
 * even when the check itself passed.
 */
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  // Playwright calls this argument `use`; named otherwise here because the
  // React hooks lint rule takes any call to `use` for React's hook.
  page: async ({ page }, provide) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => {
      problems.push(`uncaught error in the page: ${error.message}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 500) {
        problems.push(
          `${response.status()} for ${response.request().method()} ${response.url()}`,
        );
      }
    });

    await provide(page);

    expect(problems, "page errors and 5xx responses").toEqual([]);
  },
});

export { expect };
