import { withRLS } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";
import { setPreference } from "@/lib/notifications/preferences";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

/**
 * Acting on an unsubscribe link.
 *
 * POST only, and that is the point: link scanners, prefetchers and some mail
 * clients fetch every URL in a message, so a GET that changed a setting would
 * unsubscribe readers who never clicked. The GET lives at `/unsubscribe` and
 * only asks.
 *
 * Two callers arrive here. A mail client's one-click unsubscribe (RFC 8058)
 * POSTs the fixed body `List-Unsubscribe=One-Click` and wants a bare 200. The
 * confirm page's form POSTs `enabled`, and wants to be sent back to a page
 * that says what happened.
 *
 * No CSRF token, deliberately: the signed token in the URL *is* the
 * credential, so a forged cross-site POST would already have to know it, and
 * knowing it is the whole permission. Nothing here reads a cookie.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    logger.warn("Rejected an unsubscribe token", {
      // Never the token itself: it is a credential, and logs travel.
      tokenLength: token.length,
    });
    return new Response("This unsubscribe link is not valid.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const enabled = await readEnabled(request, url);
  const { userId, type } = verified;

  try {
    await withRLS(userId, (trx) => setPreference(trx, userId, type, enabled));
  } catch (err) {
    logger.error("Failed to act on an unsubscribe link", err as Error, {
      userId,
      type,
      enabled,
    });
    return new Response("Something went wrong. Please try again.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  logger.info("Notification preference set from an unsubscribe link", {
    userId,
    type,
    enabled,
  });

  if (wantsHtml(request)) {
    const base = process.env.APP_BASE_URL ?? url.origin;
    const done = enabled ? "on" : "off";
    return Response.redirect(
      `${base}/unsubscribe?t=${encodeURIComponent(token)}&done=${done}`,
      // 303: the browser must follow with GET, not repeat the POST.
      303,
    );
  }

  return new Response(
    enabled ? "Turned back on." : "Unsubscribed. You will not get these again.",
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

/**
 * Whether the reader wants this on, defaulting to off.
 *
 * Off is the default because a one-click unsubscribe says nothing but
 * `List-Unsubscribe=One-Click`: the request itself is the whole intent. Only
 * the page's undo asks for `true`.
 */
async function readEnabled(request: Request, url: URL): Promise<boolean> {
  const fromQuery = url.searchParams.get("enabled");
  if (fromQuery !== null) {
    return fromQuery === "true";
  }
  try {
    const form = await request.formData();
    return form.get("enabled") === "true";
  } catch {
    // No body, or not a form: an unsubscribe either way.
    return false;
  }
}

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}
