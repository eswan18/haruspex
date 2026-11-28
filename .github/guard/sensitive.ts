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
 *   2. The file is an endpoint: a route handler or a server action, which
 *      anyone can call and which must do its own checking.
 *   3. The file's text makes an authorization decision, judged by the names
 *      such code uses here. Authorization is spread over some fifty files, so
 *      no list of paths could keep up. The text is read both before and
 *      after the change, because the dangerous edit is the one that removes
 *      the check.
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

/** Route handlers: public HTTP endpoints, whatever they are for. */
function isRouteHandler(path: string): boolean {
  return /^app\/(.*\/)?route\.[^/]+$/.test(path);
}

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
  // Anything that imports the access-control modules is making use of them,
  // by whatever name. Covers "@/lib/auth", relative paths and subpaths.
  [
    /from\s+["'][^"']*\/(?:database|database-factory|db-helpers|auth|get-user|idp|prop-write-access|server-action-helpers|safe-return-path)(?:\/[^"']*)?["']/,
    "imports access-control code",
  ],
  [/\bimport\(\s*["'][^"']*\/(?:database|db-helpers|auth|get-user|idp)\b/, "imports access-control code"],
  // A query written here is one that row-level security has to be right for.
  [
    /\.(?:selectFrom|insertInto|updateTable|deleteFrom|mergeInto)\(|\bsql`|\bfrom\s+["']kysely["']/,
    "queries the database",
  ],
  [/\bUNAUTHORIZED\b|\bFORBIDDEN\b/, "refuses unauthorized callers"],
  [/[Ii]mpersonat/, "impersonation"],
  [/\bcookies\(\)|\bheaders\(\)\.get\(["']authorization/i, "reads credentials"],
  [/\bJWT_SECRET\b|\bjwtVerify\b|\bSignJWT\b|\bvalidateIDPToken\b/, "tokens"],
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
    const route = paths.find(isRouteHandler);
    if (route !== undefined) {
      reasons.push(`${route}: a public endpoint`);
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
