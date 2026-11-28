/**
 * Parses a sample rate string from environment variables into a valid number.
 * Ensures the result is a finite number between 0 and 1.
 *
 * @param value - The string value to parse (typically from process.env)
 * @param fallback - The fallback value if parsing fails or value is invalid
 * @returns A number between 0 and 1, or the fallback value
 */
export function parseSampleRate(
  value: string | undefined,
  fallback: number,
): number {
  const n = value === undefined ? NaN : parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

/**
 * Which Sentry environment an event belongs to, judged from where the app is
 * being served.
 *
 * Staging and production run the same image and report to the same DSN, so
 * without this every event is filed under Sentry's default, "production".
 * The hostname is used because it is the one thing the server and the browser
 * both know at run time: the server from APP_BASE_URL, the browser from the
 * page's own address. (Nothing can be baked in at build time; there is one
 * build for every environment.)
 *
 * An address this does not recognise counts as production, so that a new
 * production hostname is never filed somewhere an alert is not looking.
 *
 * @param urlOrHost - A URL ("https://staging.haruspex.fyi") or a bare hostname
 */
export function sentryEnvironment(urlOrHost: string | undefined): string {
  if (!urlOrHost) return "local";
  let hostname: string;
  try {
    hostname = new URL(
      urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`,
    ).hostname.toLowerCase();
  } catch {
    return "local";
  }
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  ) {
    return "local";
  }
  const labels = hostname.split(".");
  if (labels.includes("preview")) return "preview";
  if (
    labels.some((label) => label === "staging" || label.endsWith("-staging"))
  ) {
    return "staging";
  }
  return "production";
}
