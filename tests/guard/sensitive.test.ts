import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SENSITIVE_PATHS,
  authorizationIn,
  reviewReasons,
  type ChangedSource,
} from "../../.github/guard/sensitive";

const PLAIN = "export const double = (n: number) => n * 2;\n";
const changed = (path: string, over: Partial<ChangedSource> = {}): ChangedSource => ({
  path,
  base: PLAIN,
  head: PLAIN,
  ...over,
});
const waits = (file: ChangedSource) => reviewReasons([file]).length > 0;

describe("reviewReasons: listed paths", () => {
  it.each([
    "proxy.ts",
    "app/oauth/callback/route.ts",
    "app/login/page.tsx",
    "lib/auth/impersonation.ts",
    "lib/auth/new-thing.test.ts",
    "lib/idp/client.ts",
    "lib/get-user.ts",
    "lib/db-helpers.ts",
    "lib/database.ts",
    "lib/safe-return-path.ts",
    "lib/prop-write-access.ts",
    "app/competitions/[competitionId]/access.ts",
    "app/admin/users/page.tsx",
    "app/mcp/route.ts",
    "app/.well-known/oauth-protected-resource/mcp/route.ts",
    "lib/mcp/tools.ts",
    "app/api/unsubscribe/route.ts",
    "lib/notifications/unsubscribe-token.ts",
  ])("%s waits for a reader", (path) => {
    expect(waits(changed(path))).toBe(true);
  });

  // An import of a listed module could resolve to any of these instead.
  it.each([
    "lib/auth.ts",
    "lib/auth.tsx",
    "lib/idp.ts",
    "lib/get-user.tsx",
    "lib/get-user/index.ts",
    "lib/db-helpers/index.ts",
    "proxy.tsx",
    "proxy/index.ts",
    "app/admin.tsx",
  ])("%s, which would shadow a listed module, waits too", (path) => {
    expect(waits(changed(path, { base: null }))).toBe(true);
  });

  it("looks at a renamed file's old name as well", () => {
    expect(
      waits(changed("lib/helpers/thing.ts", { previousPath: "lib/auth/logout.ts" })),
    ).toBe(true);
  });
});

describe("reviewReasons: endpoints", () => {
  it.each([
    "app/api/health/route.ts",
    "app/route.ts",
    "app/x/[id]/route.tsx",
    "app/account/page.tsx",
    "app/competitions/layout.tsx",
    "app/competitions/[competitionId]/standings/standings-table.tsx",
    "app/not-found.tsx",
    "app/error.tsx",
    "app/sitemap.ts",
    "app/robots.ts",
    "app/opengraph-image.tsx",
    "app/some/new/template.tsx",
    "app/some/default.tsx",
  ])("%s waits, being in the routing tree", (path) => {
    expect(reviewReasons([changed(path)])).toEqual([
      `${path}: a page, layout or endpoint`,
    ]);
  });

  it("lets a stylesheet in the routing tree through", () => {
    expect(reviewReasons([changed("app/globals.css")])).toEqual([]);
  });

  it("looks at where a file was moved from", () => {
    expect(
      waits(changed("components/moved.tsx", { previousPath: "app/x/page.tsx" })),
    ).toBe(true);
  });

  it("treats a server action as an endpoint", () => {
    expect(
      waits(changed("lib/things.ts", { head: '"use server";\nexport async function f() {}\n' })),
    ).toBe(true);
  });
});

describe("reviewReasons: what the file says", () => {
  it.each([
    "if (!user.is_admin) return error('no', ERROR_CODES.UNAUTHORIZED);",
    "const user = await getUserFromCookies();",
    "return withRLS(userId, async (trx) => trx.selectFrom('props').execute());",
    "const role = await getCurrentUserRole(competition.id);",
    "if (!canCreateProps(user, competition)) return;",
    "if (member.role === 'admin') {}",
    "const token = (await cookies()).get('session');",
    "await jwtVerify(token, key);",
    "if (user.deactivated_at) return;",
    "startImpersonation(target.id);",
    "return error('no', ERROR_CODES.UNAUTHORIZED);",
    "return new Response(null, { status: 403, statusText: FORBIDDEN });",
    "const h = (await headers()).get('x-forwarded-for');",
    'import { SignJWT } from "jose";',
    "if (member.role  ===  'admin') {}",
    "if (member.role\n  !== 'admin') {}",
    "if (member.role == 'admin') {}",
    "if (['admin'].includes(member.role)) {}",
    "if (allowed.includes(role)) {}",
    "if (roles.includes('admin')) {}",
    'import { db } from "@/lib/database";',
    "import { withTransaction } from '../db-helpers';",
    'import { something } from "@/lib/auth";',
    'import { refresh } from "@/lib/auth/token-refresh";',
    'import type { User } from "@/lib/get-user";',
    'const m = await import("@/lib/database");',
    "const rows = await db.selectFrom('props').selectAll().execute();",
    "await trx.deleteFrom('forecasts').where('id', '=', id).execute();",
    'import { sql } from "kysely";',
    'import x from"@/lib/auth";',
    'import "@/lib/database";',
    'const a = require("@/lib/get-user");',
    'const b = await import(`@/lib/idp/client`);',
    'export * from "../auth/index.ts";',
    'import { t } from "@/lib/mcp/tools";',
    'import { v } from "@/lib/notifications/unsubscribe-token";',
    'import { canSee } from "./access";',
    "const m = await import(pathFromSomewhere);",
    'const n = await import("@/lib/" + name);',
    "const req = require(name);",
    'const m = await import("@/lib/\\x61uth");',
    'const m2 = await import("@/lib/\\u0061uth");',
    'const r = createRequire(import.meta.url);',
    "const r2 = module.require('x');",
    "const r3 = module['require']('x');",
    "const f = new Function('return 1');",
    "const g = globalThis['ev' + 'al'];",
    "const u = import.meta.url;",
    "const q = sql<number>`select 1`;",
    "const r = sql.raw(text);",
    'import { Kysely } from "kysely/helpers/postgres";',
    "const rows = await query.execute();",
    "const one = await query.executeTakeFirstOrThrow();",
  ])("waits when the text is: %s", (line) => {
    expect(waits(changed("lib/anything.ts", { head: `${PLAIN}${line}\n` }))).toBe(true);
  });

  it("waits when the change removes the check", () => {
    const before = `${PLAIN}if (!user.is_admin) throw new Error("no");\n`;
    expect(waits(changed("components/panel.tsx", { base: before, head: PLAIN }))).toBe(true);
  });

  it("waits when the file is deleted and used to hold a check", () => {
    expect(
      waits(changed("lib/gate.ts", { base: "export const x = withRLS;", head: null })),
    ).toBe(true);
  });

  it.each([
    '<button role="button">Go</button>',
    "const session = startPlaySession();",
    "// administrators are described on the help page",
    "const isAdministrative = true;",
    "export const roles = ['forecaster'];",
    'import { Button } from "@/components/ui/button";',
    'import { formatDate } from "@/lib/time-utils";',
    'import type { Prop } from "@/types/db_types";',
    'import { authors } from "@/lib/authors";',
    "const from = selection.from;",
    'const Chart = dynamic(() => import("@/components/chart"));',
    'const label = "authors/of/the/week";',
    'import { cn } from "@/lib/utils";',
    'const href = "/competitions/" + id;',
    "const C: React.FunctionComponent = () => null;",
    "const modules = ['a', 'b'];",
    'const label = "Line one\\nLine two";',
  ])("does not wait for ordinary text: %s", (line) => {
    expect(authorizationIn(line)).toBeNull();
  });
});

describe("reviewReasons: ordinary changes", () => {
  it.each([
    "lib/prop-status.ts",
    "components/competition-view/build-view-data.ts",
    "components/ui/button.tsx",
    "hooks/use-thing.ts",
    "types/db_types.ts",
    "app/globals.css",
    "lib/authors.ts",
    "lib/proxy-ish.ts",
  ])("%s does not wait", (path) => {
    expect(reviewReasons([changed(path)])).toEqual([]);
  });

  it("gives one reason per file that has one, and none for the rest", () => {
    expect(
      reviewReasons([
        changed("lib/a.ts"),
        changed("proxy.ts"),
        changed("app/api/x/route.ts"),
        changed("lib/b.ts", { head: "withRLS(1, f)" }),
      ]),
    ).toEqual([
      "proxy.ts: sign-in, session, token or access code",
      "app/api/x/route.ts: a page, layout or endpoint",
      "lib/b.ts: row-level security",
    ]);
  });

  it("is empty for no files", () => {
    expect(reviewReasons([])).toEqual([]);
  });
});

describe("SENSITIVE_PATHS", () => {
  // A renamed or deleted file would otherwise leave an entry guarding nothing.
  it.each(SENSITIVE_PATHS)("%s exists in the repository", (entry) => {
    expect(existsSync(entry)).toBe(true);
  });
});
