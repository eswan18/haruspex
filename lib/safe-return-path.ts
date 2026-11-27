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
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
