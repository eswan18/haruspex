/**
 * The rules for an admin's announcement, shared by the form and the server
 * action that re-checks it.
 *
 * Pure, and outside `lib/db_actions/admin-announcement.ts`, for the same
 * reason as `lib/manual-email.ts`: a `"use server"` module may only export
 * async functions.
 */
import { BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH } from "@/lib/manual-email";

export { BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH };
export const BUTTON_LABEL_MAX_LENGTH = 60;
export const BUTTON_LINK_MAX_LENGTH = 2_000;

export interface AnnouncementInput {
  subject: string;
  body: string;
  buttonLabel?: string;
  buttonLink?: string;
}

export interface Announcement {
  subject: string;
  body: string;
  /** Absent when the admin added no button. */
  button?: { label: string; url: string };
}

/**
 * Turns what the admin typed into the absolute URL a button points at, or
 * null if it cannot be one.
 *
 * A path is the usual case (`/props/suggest`) and is resolved against the
 * app's own address, so the same text works on staging and prod. A full URL
 * must be https: this goes out to everyone at once, and a link that does not
 * work is worse than no button.
 */
export function resolveButtonLink(
  link: string,
  baseUrl: string,
): string | null {
  // "//host" is a path to a browser but another site to a mail client.
  if (link.startsWith("/") && !link.startsWith("//")) {
    return `${baseUrl.replace(/\/+$/, "")}${link}`;
  }
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Checks an announcement and trims it, or says what is wrong with it.
 *
 * The button is both halves or neither: a label with nowhere to go, or a link
 * with nothing to click, is a mistake rather than a choice.
 */
export function validateAnnouncement(
  input: AnnouncementInput,
  baseUrl: string,
): { ok: true; announcement: Announcement } | { ok: false; error: string } {
  const subject = input.subject.trim();
  const body = input.body.trim();
  const label = input.buttonLabel?.trim() ?? "";
  const link = input.buttonLink?.trim() ?? "";

  if (!subject || !body) {
    return { ok: false, error: "Subject and body are both required" };
  }
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer`,
    };
  }
  if (body.length > BODY_MAX_LENGTH) {
    return {
      ok: false,
      error: `Body must be ${BODY_MAX_LENGTH} characters or fewer`,
    };
  }

  if (!label && !link) return { ok: true, announcement: { subject, body } };

  if (!label || !link) {
    return {
      ok: false,
      error: "A button needs both a label and a link, or neither",
    };
  }
  if (label.length > BUTTON_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      error: `Button label must be ${BUTTON_LABEL_MAX_LENGTH} characters or fewer`,
    };
  }
  if (link.length > BUTTON_LINK_MAX_LENGTH) {
    return {
      ok: false,
      error: `Button link must be ${BUTTON_LINK_MAX_LENGTH} characters or fewer`,
    };
  }
  const url = resolveButtonLink(link, baseUrl);
  if (!url) {
    return {
      ok: false,
      error: "Button link must be a path like /props/suggest or an https:// URL",
    };
  }
  return { ok: true, announcement: { subject, body, button: { label, url } } };
}
