import "server-only";

import type { Category, VUser } from "@/types/db_types";
import { listCategories } from "@/lib/core/categories";
import {
  listCompetitions,
  type CompetitionWithRole,
} from "@/lib/core/competitions";

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_CANDIDATES = 10;

/**
 * Finds the one item a caller meant: an id exactly, or a name by
 * case-insensitive exact match. A digit-only string is tried as a name first
 * and then as an id, since a model may pass an id as text. Zero or several
 * matches is an error that names candidates, so the agent can retry.
 */
function pick<T extends { id: number; name: string }>(
  items: T[],
  ref: number | string,
  noun: string,
): Resolved<T> {
  const byId = (id: number) => items.find((item) => item.id === id);
  if (typeof ref === "number") {
    const found = byId(ref);
    return found
      ? { ok: true, value: found }
      : { ok: false, error: noMatch(items, String(ref), noun) };
  }

  const wanted = ref.trim().toLowerCase();
  const named = items.filter((item) => item.name.toLowerCase() === wanted);
  if (named.length === 1) return { ok: true, value: named[0] };
  if (named.length > 1) {
    return {
      ok: false,
      error: `"${ref}" matches several ${noun}s: ${describe(named)} — pass an id.`,
    };
  }
  if (/^\d+$/.test(wanted)) {
    const found = byId(Number(wanted));
    if (found) return { ok: true, value: found };
  }
  return { ok: false, error: noMatch(items, ref, noun) };
}

function describe(items: { id: number; name: string }[]): string {
  const shown = items
    .slice(0, MAX_CANDIDATES)
    .map((item) => `${item.name} (id ${item.id})`)
    .join(", ");
  return items.length > MAX_CANDIDATES ? `${shown}, …` : shown;
}

function noMatch(
  items: { id: number; name: string }[],
  ref: string,
  noun: string,
): string {
  if (items.length === 0) return `No ${noun} "${ref}", and none exist.`;
  return `No ${noun} "${ref}". Did you mean: ${describe(items)}?`;
}

/** A competition the caller can see (member view), by id or name. */
export async function resolveCompetition(
  caller: VUser,
  ref: number | string,
): Promise<
  { ok: true; competition: CompetitionWithRole } | { ok: false; error: string }
> {
  const result = await listCompetitions(caller, { view: "member" });
  if (!result.success) return { ok: false, error: result.error };
  const found = pick(result.data, ref, "competition");
  return found.ok
    ? { ok: true, competition: found.value }
    : { ok: false, error: found.error };
}

/** A category, by id or name. */
export async function resolveCategory(
  caller: VUser,
  ref: number | string,
): Promise<{ ok: true; category: Category } | { ok: false; error: string }> {
  const result = await listCategories(caller);
  if (!result.success) return { ok: false, error: result.error };
  const found = pick(result.data, ref, "category");
  return found.ok
    ? { ok: true, category: found.value }
    : { ok: false, error: found.error };
}
