"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LocalDate } from "@/components/local-date";
import { MarkdownRenderer } from "@/components/markdown";
import { sheetCss } from "@/components/prop-list/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useServerAction,
  useServerActionNoParams,
} from "@/hooks/use-server-action";
import { deleteSuggestedProp, getSuggestedProps } from "@/lib/db_actions";
import type { VSuggestedProp } from "@/types/db_types";

const ownCss = `
/* One suggestion per block, separated by a hairline. Not a table: a claim is
   a sentence of unpredictable length, and the only column worth aligning
   would be the byline. */
.hxp .sug { padding: 1.5rem 0 1.25rem; border-bottom: 1px solid var(--rule); }
.hxp .sug .claim { font-size: 1rem; max-width: 44rem; }

/* The notes arrive glued to the claim, so they are set apart the way an aside
   is: indented off a rule, quieter, and labelled with the same word the
   suggestion form put over the box they were typed into. */
.hxp .sug .notes {
  margin-top: 1rem;
  border-left: 1px solid var(--rule);
  padding-left: 1rem;
  max-width: 34rem;
}
.hxp .sug .notes .lbl {
  display: block;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding-bottom: 0.375rem;
}
.hxp .sug .notes .body { color: var(--ink-muted); font-size: 0.875rem; }

.hxp .sug .foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1.5rem;
  padding-top: 1rem;
}
.hxp .sug .by {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .sug .by .who {
  text-transform: none;
  letter-spacing: 0.02em;
  color: var(--ink);
}

.hxp .act {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
  border: 0;
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 40%, transparent);
  padding: 0 0 0.25rem;
  cursor: pointer;
  white-space: nowrap;
}
.hxp .act:hover:not(:disabled) { color: var(--red-text); border-bottom-color: var(--red-text); }
.hxp .act:disabled { color: var(--ink-faint); border-bottom-color: transparent; cursor: default; }

.hxp .failed { color: var(--red-text); padding-top: 1.5rem; }
`;

export default function SuggestedProps() {
  const [suggestedProps, setSuggestedProps] = useState<VSuggestedProp[]>([]);
  const [propToDelete, setPropToDelete] = useState<VSuggestedProp | null>(null);

  const getSuggestedPropsAction = useServerActionNoParams(getSuggestedProps, {
    showToast: false,
    onSuccess: (data) => {
      setSuggestedProps(data);
    },
  });

  const deleteSuggestedPropAction = useServerAction(deleteSuggestedProp, {
    successMessage: "Suggestion deleted",
    onSuccess: () => {
      if (propToDelete) {
        setSuggestedProps((prev) =>
          prev.filter((prop) => prop.id !== propToDelete.id),
        );
        setPropToDelete(null);
      }
    },
  });

  // Load suggested props on component mount
  useEffect(() => {
    getSuggestedPropsAction.execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once on mount to avoid infinite loop
  }, []);

  const loading = getSuggestedPropsAction.isLoading;
  const loadError = getSuggestedPropsAction.error;
  const isLoadingDelete = deleteSuggestedPropAction.isLoading;

  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + ownCss }} />
      <div className="col">
        <header className="masthead">
          <h1>Suggested props</h1>
        </header>

        <h2 className="kicker">
          <span>
            In review
            {!loading && !loadError && (
              <span className="aside num"> · {suggestedProps.length}</span>
            )}
          </span>
          <Link className="aside" href="/admin">
            ← Admin
          </Link>
        </h2>

        <p className="lede">
          Propositions forecasters have sent in. Delete one once it has gone
          into a season, or when it is not going to.
        </p>

        {loadError ? (
          <p className="failed">{loadError}</p>
        ) : loading ? (
          <p className="lede">Loading suggestions…</p>
        ) : suggestedProps.length === 0 ? (
          <p className="lede">Nobody has suggested a prop yet.</p>
        ) : (
          suggestedProps.map((prop) => {
            return (
              <article className="sug" key={prop.id}>
                <div className="claim">
                  <MarkdownRenderer className="md">
                    {prop.prop_text}
                  </MarkdownRenderer>
                </div>

                {prop.notes && (
                  <div className="notes">
                    <span className="lbl">Notes</span>
                    <div className="body">
                      <MarkdownRenderer className="md">
                        {prop.notes}
                      </MarkdownRenderer>
                    </div>
                  </div>
                )}

                <div className="foot">
                  <span className="by">
                    Suggested by <span className="who">{prop.user_name}</span>
                    {" · "}
                    <LocalDate date={prop.created_at} />
                  </span>
                  <button
                    type="button"
                    className="act"
                    onClick={() => setPropToDelete(prop)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Dialogs stay the app's own: they are shared furniture, and this sheet
          does not fork them. */}
      <Dialog
        open={propToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPropToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete suggested prop</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this suggested prop? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="hxf">
            <button
              type="button"
              className="quit"
              onClick={() => setPropToDelete(null)}
              disabled={isLoadingDelete}
            >
              Cancel
            </button>
            <button
              type="button"
              className="submit danger"
              onClick={() => {
                if (propToDelete) {
                  deleteSuggestedPropAction.execute({ id: propToDelete.id });
                }
              }}
              disabled={isLoadingDelete}
            >
              {isLoadingDelete ? "Deleting…" : "Delete"}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
