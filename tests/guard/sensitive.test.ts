import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SENSITIVE_PATHS,
  sensitiveAmong,
} from "../../.github/guard/sensitive";

describe("sensitiveAmong", () => {
  it.each([
    "proxy.ts",
    "app/oauth/callback/route.ts",
    "app/oauth/login/route.test.ts",
    "app/login/page.tsx",
    "lib/auth/impersonation.ts",
    "lib/auth/new-thing.test.ts",
    "lib/idp/client.ts",
    "lib/get-user.ts",
    "lib/db-helpers.ts",
    "lib/database.ts",
    "lib/safe-return-path.ts",
    "lib/prop-write-access.ts",
    "app/mcp/route.ts",
    "app/.well-known/oauth-protected-resource/mcp/route.ts",
    "lib/mcp/auth.ts",
    "app/api/unsubscribe/route.ts",
    "lib/notifications/unsubscribe-token.ts",
  ])("counts %s as sensitive", (path) => {
    expect(sensitiveAmong([path])).toEqual([path]);
  });

  it.each([
    "lib/prop-status.ts",
    "components/competition-view/build-view-data.ts",
    "app/competitions/page.tsx",
    "lib/mcp/tools.ts",
    "lib/db_actions/competitions.ts",
    "lib/auth-helpers-elsewhere.ts",
    "lib/proxy.ts",
    "proxy.ts.bak",
    "app/oauthish/page.tsx",
    "lib/database.test.ts",
  ])("does not count %s", (path) => {
    expect(sensitiveAmong([path])).toEqual([]);
  });

  it("returns only the sensitive ones, once each, in order", () => {
    expect(
      sensitiveAmong([
        "lib/a.ts",
        "proxy.ts",
        "lib/auth/logout.ts",
        "proxy.ts",
        "app/page.tsx",
      ]),
    ).toEqual(["proxy.ts", "lib/auth/logout.ts"]);
  });

  it("is empty for no paths", () => {
    expect(sensitiveAmong([])).toEqual([]);
  });
});

describe("SENSITIVE_PATHS", () => {
  // A renamed or deleted file would otherwise leave an entry guarding nothing.
  it.each(SENSITIVE_PATHS)("%s exists in the repository", (entry) => {
    expect(existsSync(entry)).toBe(true);
  });
});
