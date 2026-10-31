import {
  error,
  ERROR_CODES,
  type ServerActionResult,
} from "@/lib/server-action-result";

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

/**
 * A request that never got an answer: the connection dropped, the device went
 * offline, or the page was leaving. Each browser words it its own way, and
 * all of them throw a TypeError.
 */
export const NETWORK_MESSAGE =
  "Couldn't reach Haruspex. Check your connection and try again.";

const NETWORK_FAILURES = new Set([
  "Load failed", // Safari
  "Failed to fetch", // Chrome
  "NetworkError when attempting to fetch resource.", // Firefox
]);

function isNetworkError(err: Error): boolean {
  return err instanceof TypeError && NETWORK_FAILURES.has(err.message);
}

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
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  return err.message;
}

/**
 * Calls a server action and always resolves, with a failed result in place of
 * a throw.
 *
 * Server actions return results rather than throw, but the call itself can
 * still throw before one comes back: the proxy's signed-out 401, a dropped
 * connection, a page older than the deploy. For a call a component makes on
 * its own (loading data in an effect or a transition) nothing else catches
 * that: it surfaces as an unhandled rejection (Sentry HARUSPEX-APP-B6 and B9,
 * from the navbar) or, inside a transition, as the error boundary. Wrapped,
 * it arrives at the caller's existing `if (!result.success)` branch instead.
 *
 * Forms go through `useServerAction`, which handles this itself.
 */
export async function settleAction<T>(
  call: () => Promise<ServerActionResult<T>>,
): Promise<ServerActionResult<T>> {
  try {
    return await call();
  } catch (err) {
    return error(describeThrownError(err), ERROR_CODES.UNKNOWN_ERROR);
  }
}
