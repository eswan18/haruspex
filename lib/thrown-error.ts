/**
 * What to tell a reader when a server action throws instead of returning a
 * result.
 *
 * The one throw worth translating is a stale page: every deploy gives server
 * actions new IDs, so a page loaded before the rollout calls an ID the new
 * pods do not have, and Next throws "Server Action ... was not found on the
 * server". Nothing is wrong with what the reader typed; the page is just old.
 */
export const STALE_PAGE_MESSAGE =
  "Haruspex was updated while this page was open. Copy anything you want to keep, reload the page, and try again.";

/**
 * What proxy.ts answers a server action with once the session is gone, as a
 * 401 text/plain body. Next hands that body to the caller as a thrown Error's
 * message, which is how a form recognises it.
 */
export const SIGNED_OUT_MESSAGE =
  "You've been signed out. Sign in again to send this.";

export function isSignedOutError(err: unknown): boolean {
  return err instanceof Error && err.message === SIGNED_OUT_MESSAGE;
}

export function describeThrownError(
  err: unknown,
  fallback = "Something went wrong.",
): string {
  if (!(err instanceof Error)) return fallback;
  if (/Server Action .* was not found on the server/.test(err.message)) {
    return STALE_PAGE_MESSAGE;
  }
  return err.message;
}
