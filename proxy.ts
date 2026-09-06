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
      // The refresh runs a full REFRESH_BUFFER_SEC ahead of expiry, so the
      // access token the browser sent is usually still valid and the user
      // notices nothing. If it has expired, this one request renders
      // signed-out -- but both cookies survive, so the next request retries.
      return NextResponse.next();
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
