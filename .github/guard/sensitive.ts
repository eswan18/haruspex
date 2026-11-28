/**
 * Paths where a mistake is a security problem, not just a bug: who is signed
 * in, what they may see, and the tokens that say so.
 *
 * The agent may still change these. What it may not have is such a change
 * merged with nobody having read it: the factory never merges a pull request
 * that touches one, whatever its labels say. Pure functions;
 * sensitive-paths.ts is the command-line wrapper.
 *
 * Add to the list when a new file takes on one of those jobs.
 */

/** A trailing slash means everything under that directory. */
export const SENSITIVE_PATHS = [
  // The gate every request passes: who needs to be signed in for what.
  "proxy.ts",
  // Signing in and out, sessions, impersonation, token refresh.
  "app/oauth/",
  "app/login/",
  "lib/auth/",
  "lib/get-user.ts",
  "lib/idp/",
  "lib/safe-return-path.ts",
  // Row-level security and the connection it is applied on.
  "lib/db-helpers.ts",
  "lib/database.ts",
  "lib/database-factory.ts",
  "lib/prop-write-access.ts",
  // The agent-facing API's own token gate.
  "app/mcp/",
  "app/.well-known/",
  "lib/mcp/auth.ts",
  // Links that act for a reader without a session.
  "app/api/unsubscribe/",
  "app/unsubscribe/",
  "lib/notifications/unsubscribe-token.ts",
];

function matches(path: string, entry: string): boolean {
  return entry.endsWith("/") ? path.startsWith(entry) : path === entry;
}

/**
 * The sensitive paths among those a pull request touches, in the order
 * given, without repeats. A test beside sensitive code counts as sensitive
 * too: it lives under the same directory, and it is what pins that code.
 */
export function sensitiveAmong(paths: string[]): string[] {
  const found = paths.filter((path) =>
    SENSITIVE_PATHS.some((entry) => matches(path, entry)),
  );
  return [...new Set(found)];
}
