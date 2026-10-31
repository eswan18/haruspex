"use server";

import { cookies } from "next/headers";
import crypto from "crypto";
import { db } from "@/lib/database";
import { VUser } from "@/types/db_types";
import { validateIDPToken } from "@/lib/idp/client";
import { logger } from "@/lib/logger";
import { recordActiveDay } from "@/lib/active-days";

const IMPERSONATION_COOKIE = "impersonate";
const IMPERSONATION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Verify and parse a signed impersonation token.
 * Returns null if invalid or expired.
 */
function verifyImpersonationToken(
  token: string,
): { userId: number; adminId: number } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }

  const parts = token.split(":");
  if (parts.length !== 4) {
    return null;
  }

  const [userIdStr, adminIdStr, timestampStr, signature] = parts;
  const userId = parseInt(userIdStr, 10);
  const adminId = parseInt(adminIdStr, 10);
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(userId) || isNaN(adminId) || isNaN(timestamp)) {
    return null;
  }

  // Check expiry
  if (Date.now() - timestamp > IMPERSONATION_EXPIRY_MS) {
    return null;
  }

  // Verify signature using timing-safe comparison
  const data = `${userId}:${adminId}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "hex");

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  return { userId, adminId };
}

/**
 * Get the current user from cookies.
 * Validates the IDP access token and looks up the user.
 * Supports admin impersonation via signed cookie.
 */
export async function getUserFromCookies(): Promise<VUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) {
    return null;
  }

  // Get the real user from OAuth token
  const realUser = await getUserFromIDPToken(token);
  if (!realUser) {
    return null;
  }

  // Check for impersonation (admin only)
  const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (impersonationToken && realUser.is_admin) {
    const impersonation = verifyImpersonationToken(impersonationToken);

    if (impersonation && impersonation.adminId === realUser.id) {
      // Valid impersonation - fetch the impersonated user
      const impersonatedUser = await db
        .selectFrom("v_users")
        .selectAll()
        .where("id", "=", impersonation.userId)
        .executeTakeFirst();

      if (impersonatedUser && !impersonatedUser.deactivated_at) {
        logger.debug("Admin impersonating user", {
          adminId: realUser.id,
          impersonatedUserId: impersonatedUser.id,
        });
        return impersonatedUser;
      }
    }
  }

  // Only here, past the impersonation branch: an admin browsing as someone
  // else must not mark that person as having used the site.
  void recordActiveDay(realUser.id);
  return realUser;
}

/**
 * Get the real user (ignoring impersonation).
 * Used internally for checking admin status during impersonation.
 */
export async function getRealUserFromCookies(): Promise<VUser | null> {
  const token = (await cookies()).get("token")?.value;
  if (!token) {
    return null;
  }
  return getUserFromIDPToken(token);
}

/**
 * Check if the current session is impersonating another user.
 * Returns the admin user if impersonating, null otherwise.
 */
export async function getImpersonatingAdmin(): Promise<VUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) {
    return null;
  }

  const realUser = await getUserFromIDPToken(token);
  if (!realUser || !realUser.is_admin) {
    return null;
  }

  const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!impersonationToken) {
    return null;
  }

  const impersonation = verifyImpersonationToken(impersonationToken);
  if (impersonation && impersonation.adminId === realUser.id) {
    return realUser;
  }

  return null;
}

/**
 * Get user from an IDP access token.
 * These tokens are JWTs signed by the IDP with ES256.
 */
async function getUserFromIDPToken(token: string): Promise<VUser | null> {
  try {
    const claims = await validateIDPToken(token);

    const user = await db
      .selectFrom("v_users")
      .selectAll()
      .where("idp_user_id", "=", claims.sub)
      .executeTakeFirstOrThrow();

    // Check if user is deactivated
    if (user.deactivated_at) {
      logger.warn("Deactivated user attempted access via IDP", {
        userId: user.id,
        idpUserId: claims.sub,
      });
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

/**
 * Get user from a token string.
 */
export async function getUserFromToken(token: string): Promise<VUser | null> {
  return getUserFromIDPToken(token);
}
