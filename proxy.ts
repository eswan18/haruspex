import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { refreshAccessToken } from "@/lib/idp/client";
import { isTokenNearExpiry } from "@/lib/auth/token-refresh";
import { RefreshTokenRejectedError } from "@/lib/idp/errors";
import { logger } from "@/lib/logger";

/**
 * Routes that don't require authentication.
 * All other routes will redirect to /login if no token is present.
 */
const PUBLIC_ROUTES = [
  "/login",
  "/oauth", // OAuth login and callback routes
  "/api/health",
  "/api/me", // Returns null if not logged in, used by client components
];

const REFRESH_BUFFER_SEC = 60;
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

// How long to stop retrying after a refresh fails for a reason that is about
// the IdP rather than the session. Keeping the session alive (rightly) removed
// the thing that used to stop those retries -- the logout -- so this replaces
// it. identity rate-limits 20 requests/min against the *pod* IP that every
// server-to-server call shares, and that one bucket also carries JWKS fetches
// and the login code exchange; unbounded retries would starve both and sign
// people out by a longer road.
const BACKOFF_COOKIE = "refresh_backoff";
const BACKOFF_SEC = 30;

const sharedCookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

/**
 * Routes that render something for signed-out visitors but must NOT be listed
 * as public: a public route skips the refresh below, so a signed-in user whose
 * access token had just expired would be shown the signed-out page instead of
 * being refreshed into their own. These fall through to the landing page only
 * once there is genuinely no session to restore.
 */
function servesAnonymous(pathname: string): boolean {
  return pathname === "/";
}

/**
 * How to answer when the refresh could not be completed for a reason that says
 * nothing about the session. Both auth cookies are left untouched either way --
 * the refresh token is still good, and the session has to survive to retry.
 */
function keepSession(request: NextRequest, pathname: string, token: string) {
  // Refresh runs a full REFRESH_BUFFER_SEC ahead of expiry, so the access
  // token the browser sent is usually still valid. Downstream verifies it and
  // the user sees nothing at all.
  if (!isTokenNearExpiry(token, Date.now(), 0)) {
    return NextResponse.next();
  }
  // Genuinely expired: downstream would resolve no user. Several routes then
  // dereference it (app/competitions/[competitionId]/access.ts), so passing
  // through here renders a crash page rather than a signed-out one. Send them
  // to /login instead -- but WITHOUT clearing the cookies, which is the whole
  // point: the session recovers by itself once the IdP does.
  if (servesAnonymous(pathname)) return NextResponse.next();
  return redirectToLogin(request, pathname);
}

function redirectToLogin(request: NextRequest, pathname: string) {
  // Use configured base URL when behind a reverse proxy, falling back to request origin for local dev.
  const baseUrl = process.env.APP_BASE_URL ?? request.nextUrl.origin;
  const loginUrl = new URL("/login", baseUrl);
  // Preserve the original URL for redirect after login (except for home page)
  if (pathname !== "/") {
    loginUrl.searchParams.set("redirect", encodeURIComponent(pathname));
  }
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;

  // No access token → landing page if the route serves visitors, else login.
  if (!token) {
    if (servesAnonymous(pathname)) return NextResponse.next();
    return redirectToLogin(request, pathname);
  }

  // Access token is still valid → pass through.
  if (!isTokenNearExpiry(token, Date.now(), REFRESH_BUFFER_SEC)) {
    return NextResponse.next();
  }

  // Access token expired, no refresh token → nothing left to restore.
  if (!refreshToken) {
    if (servesAnonymous(pathname)) return NextResponse.next();
    return redirectToLogin(request, pathname);
  }

  // A recent transient failure means the IdP is unwell; don't pile on.
  if (request.cookies.get(BACKOFF_COOKIE)) {
    return keepSession(request, pathname, token);
  }

  // Try to refresh the access token using the refresh token.
  try {
    const tokens = await refreshAccessToken(refreshToken);
    if (!tokens.access_token || !tokens.expires_in) {
      throw new Error("IDP returned invalid token response");
    }
    // Forward the new token to downstream handlers on THIS request — without
    // this, Server Components rendered during this request would read the
    // stale cookie and treat the user as logged out for one render.
    request.cookies.set("token", tokens.access_token);
    const response = NextResponse.next({ request });
    response.cookies.set("token", tokens.access_token, {
      ...sharedCookieOpts,
      maxAge: tokens.expires_in,
    });
    // If the IDP rotated the refresh token, update that cookie too.
    if (tokens.refresh_token) {
      response.cookies.set("refresh_token", tokens.refresh_token, {
        ...sharedCookieOpts,
        maxAge: REFRESH_TOKEN_MAX_AGE,
      });
    }
    return response;
  } catch (err) {
    // Only the IdP answering `invalid_grant` means this session is genuinely
    // over. Every other failure -- the IdP down, a timeout, a bad gateway, a
    // malformed body -- is evidence about the IdP, not about the user, and
    // ending the session over one turns a blip into a simultaneous forced
    // logout for everyone signed in.
    if (!(err instanceof RefreshTokenRejectedError)) {
      logger.warn("Token refresh failed; keeping the session", {
        operation: "proxy.refreshAccessToken",
        error: err instanceof Error ? err.message : String(err),
      });
      const response = keepSession(request, pathname, token);
      response.cookies.set(BACKOFF_COOKIE, "1", {
        ...sharedCookieOpts,
        maxAge: BACKOFF_SEC,
      });
      return response;
    }

    logger.info("Refresh token rejected by the IdP, clearing session", {
      operation: "proxy.refreshAccessToken",
      error: err.message,
    });
    const response = servesAnonymous(pathname)
      ? NextResponse.next()
      : redirectToLogin(request, pathname);
    response.cookies.set("token", "", { ...sharedCookieOpts, maxAge: 0 });
    response.cookies.set("refresh_token", "", {
      ...sharedCookieOpts,
      maxAge: 0,
    });
    response.cookies.set(BACKOFF_COOKIE, "", { ...sharedCookieOpts, maxAge: 0 });
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
