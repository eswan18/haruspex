/**
 * Which of the agent's pull requests must be read before they merge.
 *
 * The agent may change any application source. What it may not have is a
 * change to who can do what merged with nobody having read it. The factory
 * asks this module before merging, and merges only if the answer is "no
 * reason to wait". Labels cannot override it.
 *
 * Three tests, any one of which is enough:
 *
 *   1. The path is on the list below: the code whose whole job is sign-in,
 *      sessions, tokens or row-level security.
 *   2. The file is reachable from outside: anything under app/, where every
 *      file is a page, a layout, a route handler or something they render on
 *      the server, and any server action wherever it lives. This one is a
 *      rule about where a file is, not what it looks like, because Next has
 *      many file names that serve requests and will grow more.
 *   3. The file's text makes an authorization decision, judged by the names
 *      such code uses here. Authorization is spread over some fifty files, so
 *      no list of paths could keep up. The text is read both before and
 *      after the change, because the dangerous edit is the one that removes
 *      the check.
 *
 * What this is not: a wall. The third test reads text for familiar names, and
 * code written to avoid those names on purpose could get past it. The walls
 * are elsewhere: the guard's limits on what the agent may touch at all, the
 * checks, and production moving only when the owner promotes. This decides
 * which changes the owner reads before they reach staging, and errs toward
 * reading.
 *
 * Pure functions; merge-review.ts fetches the files and calls them. Extend
 * the list and the markers when the codebase grows a new way to say "is this
 * person allowed".
 */

/** A trailing slash means everything under that directory. */
export const SENSITIVE_PATHS = [
  // The gate every request passes: who needs to be signed in for what.
  "proxy.ts",
  // Signing in and out, sessions, impersonation, token validation.
  "app/oauth/",
  "app/login/",
  "lib/auth/",
  "lib/idp/",
  "lib/get-user.ts",
  "lib/safe-return-path.ts",
  // Row-level security and the connection it is applied on.
  "lib/db-helpers.ts",
  "lib/database.ts",
  "lib/database-factory.ts",
  "lib/prop-write-access.ts",
  "lib/server-action-helpers.ts",
  // Who may see a competition, and the admin area.
  "app/competitions/[competitionId]/access.ts",
  "app/admin/",
  // The agent-facing API and its token gate.
  "app/mcp/",
  "app/.well-known/",
  "lib/mcp/",
  // Links that act for a reader without a session.
  "app/api/unsubscribe/",
  "app/unsubscribe/",
  "lib/notifications/unsubscribe-token.ts",
];

/**
 * A listed name also covers the other files an import of it could resolve
 * to. `lib/auth/` is shadowed by a new `lib/auth.ts`, and `lib/get-user.ts`
 * by `lib/get-user.tsx` or `lib/get-user/index.ts`; a rule that matched only
 * the listed spelling would let either one replace the real module unread.
 */
function onList(path: string): boolean {
  return SENSITIVE_PATHS.some((entry) => {
    const stem = entry.endsWith("/")
      ? entry.slice(0, -1)
      : entry.replace(/\.[^./]+$/, "");
    return (
      path === stem || path.startsWith(`${stem}/`) || path.startsWith(`${stem}.`)
    );
  });
}

/**
 * Everything in the routing tree. Stylesheets are let through: they hold no
 * logic and are most of what a visual change touches there.
 */
function isRouted(path: string): boolean {
  return path.startsWith("app/") && !path.endsWith(".css");
}

/**
 * How the listed modules under lib/ are spelled when another file refers to
 * them: the path after "lib", so "@/lib/auth", "../auth" and
 * "@/lib/auth/token-refresh" all count. Built from SENSITIVE_PATHS so the
 * two cannot drift apart. "access" is the per-competition access module,
 * which its neighbours import as "./access".
 */
const ACCESS_MODULES = [
  ...SENSITIVE_PATHS.filter((entry) => entry.startsWith("lib/")).map((entry) =>
    entry
      .slice("lib/".length)
      .replace(/\/$/, "")
      .replace(/\.[^./]+$/, ""),
  ),
  "access",
];

const ACCESS_MODULE_IN_A_STRING = new RegExp(
  "[\"'`][^\"'`\\n]*/(?:" +
    ACCESS_MODULES.map((name) => name.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")).join("|") +
    ")(?:\\.[cm]?[jt]sx?)?(?:/[^\"'`\\n]*)?[\"'`]",
);

/**
 * The names authorization goes by in this codebase. Matched as whole words,
 * case-sensitively, so that ordinary words (a button's `role`, a `session`
 * of play) do not count.
 */
const AUTH_MARKERS: [RegExp, string][] = [
  [/["']use server["']/, "a server action"],
  [/\bis_admin\b|\bisAdmin\b/, "an admin check"],
  [/\bgetUserFromCookies\b|\bgetCurrentUser\w*\b/, "reads who is signed in"],
  [/\bwithRLS\b/, "row-level security"],
  [/\bcanCreateProps\b|\bcanEdit\w*\b|\bcanManage\w*\b|\bcanView\w*\b/, "a permission check"],
  [
    /\bcompetition_members\b|\bMemberRole\b|\brole\s*[!=]==?|\.includes\(\s*\w*\.?role\b|\broles?\.includes\(/,
    "a membership role",
  ],
  // Anything that names an access-control module is making use of it. The
  // module's path is looked for in any string, not in any particular import
  // syntax: `from`, `import()`, `require()`, a bare `import "x"` and whatever
  // comes next all have to spell the path somewhere.
  [ACCESS_MODULE_IN_A_STRING, "names an access-control module"],
  // An import whose target is not a plain string cannot be read at all, and
  // nor can a string that spells its contents with escapes. Ordinary
  // application code here needs none of these, so their mere presence is
  // enough to want a reader.
  [
    /\bimport\s*\(\s*(?!["'][^"'`$\\\n]*["']\s*\))|\bimport\.meta\b|\b(?:require|createRequire|eval|Function|globalThis|Reflect|Proxy)\b|\bmodule\s*[.[]|\\(?:x[0-9a-fA-F]|u[0-9a-fA-F{])/,
    "loads code in a way that cannot be checked",
  ],
  // A query written here is one that row-level security has to be right for.
  [
    /\.(?:selectFrom|insertInto|updateTable|deleteFrom|mergeInto|replaceInto)\(|\.execute(?:TakeFirst(?:OrThrow)?|Query)?\(|\bsql\b|["'`]kysely\b/,
    "queries the database",
  ],
  [/\bUNAUTHORIZED\b|\bFORBIDDEN\b/, "refuses unauthorized callers"],
  [/[Ii]mpersonat/, "impersonation"],
  [/\bcookies\s*\(|\bheaders\s*\(\s*\)|["'`]authorization["'`]/i, "reads credentials"],
  [/\bJWT_SECRET\b|\bjwtVerify\b|\bSignJWT\b|\bvalidateIDPToken\b|["'`]jose\b/, "tokens"],
  [/\bdeactivated_at\b/, "account deactivation"],
];

/** What the text has to do with authorization, or null if nothing. */
export function authorizationIn(text: string): string | null {
  for (const [pattern, meaning] of AUTH_MARKERS) {
    if (pattern.test(text)) return meaning;
  }
  return null;
}

export interface ChangedSource {
  path: string;
  /** The old name, when the file was renamed. */
  previousPath?: string;
  /** The file's text before and after; null where it did not exist. */
  base: string | null;
  head: string | null;
}

/**
 * Why a pull request must be read before merging: one line per file that
 * gives a reason. Empty means nothing in it calls for a reader.
 */
export function reviewReasons(files: ChangedSource[]): string[] {
  const reasons: string[] = [];
  for (const file of files) {
    const paths = [file.path, file.previousPath].filter(
      (path): path is string => path !== undefined,
    );
    const listed = paths.find(onList);
    if (listed !== undefined) {
      reasons.push(`${listed}: sign-in, session, token or access code`);
      continue;
    }
    const routed = paths.find(isRouted);
    if (routed !== undefined) {
      reasons.push(`${routed}: a page, layout or endpoint`);
      continue;
    }
    const meaning =
      (file.base !== null ? authorizationIn(file.base) : null) ??
      (file.head !== null ? authorizationIn(file.head) : null);
    if (meaning !== null) {
      reasons.push(`${file.path}: ${meaning}`);
    }
  }
  return reasons;
}
