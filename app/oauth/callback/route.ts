import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCodeForTokens,
  validateIDPToken,
  fetchUserInfo,
  buildNameFromUserInfo,
} from "@/lib/idp/client";
import {
  getUserByIdpUserId,
  createUserFromIdp,
  syncUserFromIdp,
} from "@/lib/db_actions/identity-login-flag";
import { logger } from "@/lib/logger";
import { safeReturnPath } from "@/lib/safe-return-path";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  // Use configured base URL when behind a reverse proxy, falling back to request origin for local dev.
  const baseUrl = process.env.APP_BASE_URL ?? request.nextUrl.origin;

  // Handle OAuth errors
  if (error) {
    logger.error("OAuth error from IDP", new Error(errorDescription || error), {
      error,
      errorDescription,
    });
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(errorDescription || error)}`,
        baseUrl,
      ),
    );
  }

  if (!code || !state) {
    logger.error("Missing code or state in OAuth callback");
    return NextResponse.redirect(
      new URL("/login?error=Missing+authorization+code", baseUrl),
    );
  }

  // Get stored PKCE values and return URL from cookies
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value;
  const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;
  // Checked again here: the cookie is client-held, so it is not trusted either.
  const returnUrl = safeReturnPath(
    cookieStore.get("oauth_return_url")?.value,
    baseUrl,
  );

  // Validate state to prevent CSRF attacks
  if (!storedState || state !== storedState) {
    logger.error("OAuth state mismatch", undefined, {
      receivedState: state,
      storedState: storedState ? "[present]" : "[missing]",
    });
    return NextResponse.redirect(
      new URL("/login?error=Invalid+state", baseUrl),
    );
  }

  if (!codeVerifier) {
    logger.error("Missing code verifier in OAuth callback");
    return NextResponse.redirect(
      new URL("/login?error=Missing+code+verifier", baseUrl),
    );
  }

  try {
    // Determine the redirect URI (must match what was used in the authorization request)
    const redirectUri = `${baseUrl}/oauth/callback`;

    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);

    // Validate the access token and extract claims
    const claims = await validateIDPToken(tokens.access_token);

    // Fetch user info to get profile data including avatar
    const userInfo = await fetchUserInfo(tokens.access_token);

    let user = await getUserByIdpUserId(claims.sub);

    // Construct name from userInfo (given_name + family_name)
    const nameFromIdp = buildNameFromUserInfo(userInfo);

    if (!user) {
      // First login via IDP - create user record
      // Use name from IDP if available, else fallback to username or email prefix
      const name = nameFromIdp || claims.username || claims.email.split("@")[0];
      user = await createUserFromIdp({
        idpUserId: claims.sub,
        email: claims.email,
        name,
        username: claims.username || null,
        pictureUrl: userInfo.picture || null,
      });

      if (!user) {
        logger.error("Failed to create user from IDP", undefined, {
          idpUserId: claims.sub,
          email: claims.email,
        });
        return NextResponse.redirect(
          new URL("/login?error=Failed+to+create+user", baseUrl),
        );
      }

      logger.info("Created new user from IDP login", {
        userId: user.id,
        idpUserId: claims.sub,
        email: claims.email,
      });
    } else {
      // Existing user - sync email, username, name, and picture from IDP
      await syncUserFromIdp(user.id, {
        email: claims.email,
        username: claims.username || null,
        name: nameFromIdp,
        pictureUrl: userInfo.picture || null,
      });
    }

    // Check if user is deactivated
    if (user.deactivated_at) {
      logger.warn("Deactivated user attempted IDP login", {
        userId: user.id,
        idpUserId: claims.sub,
      });
      return NextResponse.redirect(
        new URL("/login?error=Account+is+deactivated", baseUrl),
      );
    }

    // Store the IDP access token in the session cookie
    // Note: We're using the same cookie name "token" for simplicity
    cookieStore.set("token", tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: tokens.expires_in, // Use token expiry from IDP
      sameSite: "lax",
      path: "/",
    });

    // Store refresh token separately (if provided)
    if (tokens.refresh_token) {
      cookieStore.set("refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60, // 30 days (IDP refresh token lifetime)
        sameSite: "lax",
        path: "/",
      });
    }

    // Clear the OAuth state cookies
    cookieStore.delete("oauth_state");
    cookieStore.delete("oauth_code_verifier");
    cookieStore.delete("oauth_return_url");

    logger.info("Successful IDP login", {
      userId: user.id,
      idpUserId: claims.sub,
      username: claims.username,
    });

    return NextResponse.redirect(new URL(returnUrl, baseUrl));
  } catch (err) {
    logger.error("OAuth callback error", err as Error, {
      code: code ? "[present]" : "[missing]",
    });
    return NextResponse.redirect(
      new URL("/login?error=Authentication+failed", baseUrl),
    );
  }
}
