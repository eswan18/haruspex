"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerAction } from "@/hooks/use-server-action";
import {
  removeCompetitionMember,
  updateMemberRole,
  type CompetitionMemberRow,
  type CompetitionRole,
} from "@/lib/db_actions/competition-members";

export const membersCss = `
/* Name over email, and the exception marked. A portrait square was tried and
   cut: it was the only filled surface in the app, it degraded to a grey box
   with an initial for anyone the IdP has no picture for, and in a pool of six
   people it told the reader nothing they did not already know from the name. */
.hxp .roster {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6rem 2rem;
  gap: 0 1rem;
  align-items: baseline;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .roster .who { min-width: 0; }
.hxp .roster .who .nm { font-size: 0.9375rem; }
.hxp .roster .who .em {
  display: block;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-top: 0.125rem;
}
/* The reader's own row is marked once. The standings bolds the name and reds
   the figure; there is no figure here, so the name carries both and no tag is
   needed on top of it. */
.hxp .roster.mine .nm { font-weight: 700; color: var(--red-text); }

/* Four rows in five say "forecaster". Print marks the exception and leaves the
   rule silent, so only an admin prints — in the same muted mono caps as every
   other small label, with no second weight doing the work of a word. */
.hxp .roster .role {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.hxp .roster .menu {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 1rem;
  line-height: 1;
  color: var(--ink-faint);
  background: none;
  border: 0;
  padding: 0.125rem 0.375rem;
  cursor: pointer;
  justify-self: end;
}
.hxp .roster .menu:hover:not(:disabled) { color: var(--red-text); }
.hxp .roster .menu:disabled { cursor: default; opacity: 0.5; }
/* the trigger keeps focus when its menu closes; the UA ring is blue */
.hxp .roster .menu:focus-visible {
  outline: 2px solid var(--red-text);
  outline-offset: 1px;
}

/* The roster's own column head, kept with the roster so any surface that
   renders the rows gets the header that names them. */
.hxp .rosterhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 0 0.5rem;
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .add {
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: var(--ink);
  font-weight: 700;
  background: none;
  border: 0;
  border-bottom: 2px solid var(--ink);
  padding: 0 0 0.25rem;
  cursor: pointer;
  white-space: nowrap;
}
.hxp .add:hover { color: var(--red-text); border-bottom-color: var(--red-text); }

@media (max-width: 46rem) {
  .hxp .roster { grid-template-columns: minmax(0, 1fr) 5rem 2rem; }
}
`;

function MemberRow({
  member,
  competitionId,
  currentUserId,
  canManage,
  isOnlyAdmin,
  onChange,
}: {
  member: CompetitionMemberRow;
  competitionId: number;
  currentUserId: number;
  canManage: boolean;
  isOnlyAdmin: boolean;
  onChange?: () => void;
}) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isYou = member.user_id === currentUserId;
  const isMemberAdmin = member.role === "admin";
  // Nobody edits their own membership, and the last admin cannot be demoted or
  // removed — the competition would be left with no one who can manage it.
  const manageable = canManage && !isYou;

  const done = () => {
    router.refresh();
    onChange?.();
  };
  const remove = useServerAction(removeCompetitionMember, {
    successMessage: "Member removed",
    onSuccess: done,
  });
  const setRole = useServerAction(updateMemberRole, {
    successMessage: "Role updated",
    onSuccess: done,
  });
  const busy = remove.isLoading || setRole.isLoading;

  return (
    <>
      <div className={isYou ? "roster mine" : "roster"}>
        <span className="who">
          <span className="nm">{member.user_name}</span>
          {member.user_email && <span className="em">{member.user_email}</span>}
        </span>
        <span className="role">{isMemberAdmin ? "Admin" : ""}</span>
        {manageable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="menu"
                disabled={busy}
                aria-label={`Manage ${member.user_name}`}
              >
                {busy ? "·" : "⋯"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isMemberAdmin ? (
                <DropdownMenuItem
                  onClick={() =>
                    setRole.execute({
                      competitionId,
                      userId: member.user_id,
                      newRole: "forecaster" as CompetitionRole,
                    })
                  }
                  disabled={isOnlyAdmin}
                >
                  Demote to forecaster
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    setRole.execute({
                      competitionId,
                      userId: member.user_id,
                      newRole: "admin" as CompetitionRole,
                    })
                  }
                >
                  Promote to admin
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="danger"
                onClick={() => setConfirmRemove(true)}
                disabled={isMemberAdmin && isOnlyAdmin}
              >
                Remove from competition
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span />
        )}
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {member.user_name} from this competition? They will lose
              access to its props, forecasts and scores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="danger"
              disabled={remove.isLoading}
              onClick={async () => {
                await remove.execute({
                  competitionId,
                  userId: member.user_id,
                });
                setConfirmRemove(false);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The roster of a private competition.
 *
 * Admins first, then alphabetical — the people who can change the competition
 * are the ones you came here to find.
 */
export function MembersSheet({
  members,
  competitionId,
  currentUserId,
  canManage,
  onChange,
}: {
  members: CompetitionMemberRow[];
  competitionId: number;
  currentUserId: number;
  /** True for a competition admin: the row menus appear only then. */
  canManage: boolean;
  onChange?: () => void;
}) {
  const isOnlyAdmin = members.filter((m) => m.role === "admin").length <= 1;
  const ordered = [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.user_name.localeCompare(b.user_name);
  });

  if (members.length === 0) {
    return (
      <p className="lede">Nobody has been added to this competition yet.</p>
    );
  }

  return (
    <>
      {ordered.map((member) => (
        <MemberRow
          key={member.membership_id}
          member={member}
          competitionId={competitionId}
          currentUserId={currentUserId}
          canManage={canManage}
          isOnlyAdmin={isOnlyAdmin}
          onChange={onChange}
        />
      ))}
    </>
  );
}
