// `import type`, so this module never pulls a "use server" file (and through
// it lib/database) into a unit test -- the import is erased at build.
import type { CompetitionRole } from "@/lib/db_actions/competition-members";

/**
 * Who may add a prop to a competition.
 *
 * The two halves ask different questions because the two kinds of competition
 * are governed differently. A private competition is its members' business, so
 * the power belongs to its own admins and running the site does not confer it.
 * A public season has no membership at all -- a trigger rejects rows in
 * competition_members for one -- so its role is always null, and the only
 * meaningful authority is the site admin who curates it.
 *
 * Kept in one place because the new-prop route and the open-props page both
 * need the same answer, and they had drifted into two copies of it.
 */
export function canCreateProps({
  isPrivate,
  role,
  isSiteAdmin,
}: {
  isPrivate: boolean;
  /** Membership role, which only a private competition has. */
  role: CompetitionRole | null;
  isSiteAdmin: boolean;
}): boolean {
  return isPrivate ? role === "admin" : isSiteAdmin;
}

/**
 * Who may resolve a prop (and undo a resolution): its owner, if it is a
 * personal prop; an admin of its competition; or a site admin, anywhere.
 *
 * The site-admin half differs from `canCreateProps` on purpose. It matches the
 * `manage_resolutions` policy, which admits a site admin everywhere, and the
 * prop page, which has always offered them the button. The prop pages and
 * resolveProp both ask this, so the button and the action cannot disagree.
 */
export function canResolveProp({
  userId,
  ownerId,
  role,
  isSiteAdmin,
}: {
  userId: number;
  /** The prop's `user_id`: set for a personal prop, null otherwise. */
  ownerId: number | null;
  /** Membership role in the prop's competition, if it has one. */
  role: CompetitionRole | null;
  isSiteAdmin: boolean;
}): boolean {
  return (
    isSiteAdmin || role === "admin" || (ownerId !== null && ownerId === userId)
  );
}
