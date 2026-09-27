import "server-only";
import crypto from "node:crypto";

import {
  isOptionalNotification,
  type OptionalNotificationType,
} from "@/lib/notifications/types";

/**
 * The credential in an unsubscribe link.
 *
 * `userId:type:hmac`, the same shape as the impersonation token in
 * `lib/get-user.ts` and verified the same way, because the alternative — a row
 * in the database per link — buys nothing: the link has to work from an email
 * years later, with no session, and a signature already proves who asked.
 *
 * Deliberately no expiry. A reader who finds an old email should still be able
 * to get out of it; rotating `JWT_SECRET` is what invalidates every link at
 * once, and that is the right blunt instrument.
 *
 * What it can do is bounded: turn ONE notification off (or back on) for ONE
 * reader. It carries no session, grants nothing else, and names no other
 * reader — so a leaked link costs that reader one setting they can put back
 * with one press.
 */

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

export function signUnsubscribeToken(
  userId: number,
  type: OptionalNotificationType,
): string {
  const data = `${userId}:${type}`;
  return `${data}:${sign(data)}`;
}

/** The reader and notification a token names, or null if it proves nothing. */
export function verifyUnsubscribeToken(
  token: string,
): { userId: number; type: OptionalNotificationType } | null {
  const parts = token.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [userIdStr, type, signature] = parts;
  const userId = parseInt(userIdStr!, 10);
  if (isNaN(userId)) {
    return null;
  }

  // Checked before the signature and again by the caller's own registry read:
  // a type with no off switch has nothing for this link to do, and a validly
  // signed one would otherwise write a row nothing reads.
  if (!isOptionalNotification(type!)) {
    return null;
  }

  const expected = sign(`${userId}:${type}`);
  const given = Buffer.from(signature!, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (given.length !== wanted.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(given, wanted)) {
    return null;
  }

  return { userId, type };
}

/**
 * The two links an unsubscribe token makes, for one reader and one type.
 *
 * They differ because their callers differ. `page` is what a person clicks in
 * the footer, and it only asks — a visible link gets followed by scanners and
 * prefetchers, so it must not act. `post` is what a mail client's own
 * unsubscribe button POSTs to (RFC 8058), and acting is exactly its job.
 */
export function unsubscribeLinks(
  userId: number,
  type: OptionalNotificationType,
): { page: string; post: string } {
  const token = encodeURIComponent(signUnsubscribeToken(userId, type));
  const base = process.env.APP_BASE_URL;
  return {
    page: `${base}/unsubscribe?t=${token}`,
    post: `${base}/api/unsubscribe?t=${token}`,
  };
}
