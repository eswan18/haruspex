"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { InviteMemberDialog } from "@/components/members";
import { MembersSheet, membersCss } from "@/components/members/members-sheet";
import { sheetCss } from "@/components/prop-list/sheet";
import { getCompetitionMembers } from "@/lib/db_actions/competition-members";
import { settleAction } from "@/lib/thrown-error";
import type { VCompetitionMember } from "@/types/db_types";

const ownCss = `
.hxp .failed { color: var(--red-text); padding-top: 1.5rem; }
`;

/**
 * The roster of a private competition.
 *
 * Still fetched on the client as it was when this was a tab — the list is the
 * only thing on the page and is not worth blocking the route's first paint on.
 */
export function MembersPanel({
  competitionId,
  competitionName,
  currentUserId,
  canManage,
  backHref,
}: {
  competitionId: number;
  competitionName: string;
  currentUserId: number;
  canManage: boolean;
  backHref: string;
}) {
  const [members, setMembers] = useState<VCompetitionMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [inviting, setInviting] = useState(false);

  const load = useCallback(() => {
    startLoading(async () => {
      setError(null);
      // Settled: a throw inside a transition reaches the error boundary and
      // replaces the page; a failed result shows in the panel instead.
      const result = await settleAction(() =>
        getCompetitionMembers(competitionId),
      );
      if (result.success) setMembers(result.data);
      else setError(result.error);
    });
  }, [competitionId]);

  useEffect(load, [load]);

  const count = members?.length ?? 0;
  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{ __html: sheetCss + membersCss + ownCss }}
      />
      <div className="col">
        <header className="masthead">
          <h1>
            <Link href={backHref}>{competitionName}</Link>
          </h1>
        </header>

        <h2 className="kicker">
          <span>
            Members
            {members !== null && <span className="aside num"> · {count}</span>}
          </span>
          <Link className="aside" href={backHref}>
            ← Overview
          </Link>
        </h2>

        {error ? (
          <p className="failed">{error}</p>
        ) : isLoading || members === null ? (
          <p className="lede">Loading the roster…</p>
        ) : (
          <>
            <div className="rosterhead">
              <span>Forecaster</span>
              {canManage && (
                <button
                  type="button"
                  className="add"
                  onClick={() => setInviting(true)}
                >
                  + Add member
                </button>
              )}
            </div>
            <MembersSheet
              members={members}
              competitionId={competitionId}
              currentUserId={currentUserId}
              canManage={canManage}
              onChange={load}
            />
          </>
        )}
      </div>

      {canManage && inviting && (
        <InviteMemberDialog
          competitionId={competitionId}
          isOpen
          onClose={() => setInviting(false)}
          onMemberChange={load}
        />
      )}
    </div>
  );
}
