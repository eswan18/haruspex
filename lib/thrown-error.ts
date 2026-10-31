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
