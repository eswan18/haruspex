/**
 * Limits for a reader's prop suggestion, shared by the form and the server
 * action that re-checks it.
 *
 * They live here rather than in `lib/db_actions/suggested-props.ts` because
 * that file is `"use server"`, and such a module may only export async
 * functions.
 */
export const CLAIM_MIN_LENGTH = 8;
export const CLAIM_MAX_LENGTH = 500;
export const NOTES_MAX_LENGTH = 500;

export type SuggestionCheck =
  | { ok: true; prop: string; notes: string | null }
  | { ok: false; field: "prop" | "notes"; error: string };

/**
 * Trim a suggestion and check it against the limits. Blank notes are absent
 * notes, not empty ones.
 */
export function checkSuggestion({
  prop,
  notes,
}: {
  prop: string;
  notes: string | null;
}): SuggestionCheck {
  const claim = prop.trim();
  const trimmedNotes = notes?.trim() || null;

  if (claim.length < CLAIM_MIN_LENGTH) {
    return {
      ok: false,
      field: "prop",
      error: `Say a little more — at least ${CLAIM_MIN_LENGTH} characters`,
    };
  }
  if (claim.length > CLAIM_MAX_LENGTH) {
    return {
      ok: false,
      field: "prop",
      error: `Keep the claim under ${CLAIM_MAX_LENGTH} characters`,
    };
  }
  if (trimmedNotes && trimmedNotes.length > NOTES_MAX_LENGTH) {
    return {
      ok: false,
      field: "notes",
      error: `Keep the notes under ${NOTES_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, prop: claim, notes: trimmedNotes };
}
