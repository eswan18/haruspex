/**
 * Reduce a post-login return URL to a path on this site.
 *
 * The return URL comes from a query parameter, so it is attacker-controlled:
 * a link to `/login?redirect=https://evil.example` must not send a freshly
 * signed-in user off-site. Anything that does not resolve to `baseUrl`'s
 * origin becomes "/".
 *
 * The check parses the URL instead of testing for a leading "/", because
 * browsers treat `//host`, `/\host` and `/<tab>/host` as other sites.
 */
export function safeReturnPath(
  returnUrl: string | null | undefined,
  baseUrl: string,
): string {
  if (!returnUrl) return "/";

  try {
    const base = new URL(baseUrl);
    const target = new URL(returnUrl, base);
    if (target.origin !== base.origin) return "/";

    // Check the string that will be used, not only the parsed input: a path
    // like "/.//evil.example" normalises to "//evil.example", which is
    // same-origin here but another site once it is resolved again.
    const path = `${target.pathname}${target.search}${target.hash}`;
    if (new URL(path, base).origin !== base.origin) return "/";
    return path;
  } catch {
    return "/";
  }
}
