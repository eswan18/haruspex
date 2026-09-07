"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
import {
  getSuggestedProps,
  getWritableCompetitions,
  setSuggestedPropStatus,
} from "@/lib/db_actions";
import type {
  Competition,
  SuggestedPropStatus,
  VSuggestedProp,
} from "@/types/db_types";
import {
  REVIEWED_PARAM,
  partitionQueue,
  reviewedFilterOf,
  type ReviewedFilter,
} from "./review-queue";

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

/* The decision, set as a kicker rather than a coloured chip: red is spoken for
   here, and "rejected" is a ruling, not a failure. */
.hxp .sug .verdict {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .sug .verdict .word { color: var(--ink); }

.hxp .sug .acts { display: flex; gap: 1.25rem; white-space: nowrap; }

/* Nothing here for the reviewed section's head: it is an h2.kicker holding a
   .bucket, which the shared sheet already draws. Wrapping it in a flex
   container is what broke it -- that made the h2 a flex item, so its 2px
   section rule shrank to the width of its own text. */

/* The filter belongs to what opens, not to the head. In the head it made the
   row grow by its own height the moment the section opened -- the head is a
   baseline-aligned flex row, so it takes the height of its tallest child, and
   the seg is about 10px taller than the words beside it. Everything below
   dropped by that much on every toggle. Out here it can only push down what it
   precedes. Same row open-props puts under its own kicker. */
.hxp .filters {
  display: flex;
  justify-content: flex-end;
  padding-top: 1.5rem;
}
`;

const REVIEWED_CHOICES: { id: ReviewedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

export function SuggestedPropsReview() {
  const [suggestedProps, setSuggestedProps] = useState<VSuggestedProp[]>([]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = reviewedFilterOf(Object.fromEntries(searchParams.entries()));

  const getSuggestedPropsAction = useServerActionNoParams(getSuggestedProps, {
    showToast: false,
    onSuccess: (data) => {
      setSuggestedProps(data);
    },
  });

  const setStatusAction = useServerAction(setSuggestedPropStatus, {
    showToast: false,
    // Refetch rather than patch in place: the server decides decided_at and
    // who decided, and this page has no way to know either.
    onSuccess: () => {
      getSuggestedPropsAction.execute();
    },
  });

  // Offered after an accept. The accept is already recorded by then, so
  // dismissing this costs nothing -- it asks about the next step, not the one
  // just taken.
  const [offerPropFor, setOfferPropFor] = useState<VSuggestedProp | null>(null);
  const [writable, setWritable] = useState<Competition[]>([]);

  const getWritableAction = useServerActionNoParams(getWritableCompetitions, {
    showToast: false,
    onSuccess: (data) => setWritable(data),
  });

  // Load suggested props on component mount
  useEffect(() => {
    getSuggestedPropsAction.execute();
    getWritableAction.execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once on mount to avoid infinite loop
  }, []);

  const loading = getSuggestedPropsAction.isLoading;
  const loadError = getSuggestedPropsAction.error;
  const deciding = setStatusAction.isLoading;

  const queue = useMemo(
    () => partitionQueue(suggestedProps, filter),
    [suggestedProps, filter],
  );

  /**
   * `replace`, not `push`: this is which slice of one page you are looking at,
   * and a history entry per click would bury the page you arrived from. Same
   * reasoning as the open-props filter.
   */
  function show(next: ReviewedFilter | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === null) {
      params.delete(REVIEWED_PARAM);
    } else {
      params.set(REVIEWED_PARAM, next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function decide(prop: VSuggestedProp, status: SuggestedPropStatus | null) {
    setStatusAction.execute({ id: prop.id, status });
    // Only on the way in to "accepted", and only when there is somewhere for
    // the prop to go. Flipping a rejection back to accepted counts: that is
    // the same decision, arrived at later.
    if (status === "accepted" && writable.length > 0) {
      setOfferPropFor(prop);
    }
  }

  function Suggestion({ prop }: { prop: VSuggestedProp }) {
    return (
      <article className="sug" key={prop.id}>
        <div className="claim">
          <MarkdownRenderer className="md">{prop.prop_text}</MarkdownRenderer>
        </div>

        {prop.notes && (
          <div className="notes">
            <span className="lbl">Notes</span>
            <div className="body">
              <MarkdownRenderer className="md">{prop.notes}</MarkdownRenderer>
            </div>
          </div>
        )}

        <div className="foot">
          <span className="by">
            Suggested by <span className="who">{prop.user_name}</span>
            {" · "}
            <LocalDate date={prop.created_at} />
          </span>

          {prop.status === null ? (
            <span className="acts">
              <button
                type="button"
                className="act"
                disabled={deciding}
                onClick={() => decide(prop, "accepted")}
              >
                Accept
              </button>
              <button
                type="button"
                className="act"
                disabled={deciding}
                onClick={() => decide(prop, "rejected")}
              >
                Reject
              </button>
            </span>
          ) : (
            <span className="acts">
              <button
                type="button"
                className="act"
                disabled={deciding}
                onClick={() =>
                  decide(
                    prop,
                    prop.status === "accepted" ? "rejected" : "accepted",
                  )
                }
              >
                {prop.status === "accepted" ? "Reject" : "Accept"} instead
              </button>
              <button
                type="button"
                className="act"
                disabled={deciding}
                onClick={() => decide(prop, null)}
              >
                Reopen
              </button>
            </span>
          )}
        </div>

        {prop.status !== null && (
          <div className="foot">
            <span className="verdict">
              <span className="word">{prop.status}</span>
              {prop.decided_by_name && ` by ${prop.decided_by_name}`}
              {prop.decided_at && (
                <>
                  {" · "}
                  <LocalDate date={prop.decided_at} />
                </>
              )}
            </span>
          </div>
        )}
      </article>
    );
  }

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
              <span className="aside num"> · {queue.pending.length}</span>
            )}
          </span>
          <Link className="aside" href="/admin">
            ← Admin
          </Link>
        </h2>

        <p className="lede">
          Propositions forecasters have sent in. Accept one that is going into a
          season and reject one that is not; either can be changed later.
        </p>

        {loadError ? (
          <p className="failed">{loadError}</p>
        ) : loading ? (
          <p className="lede">Loading suggestions…</p>
        ) : queue.pending.length === 0 ? (
          <p className="lede">
            {suggestedProps.length === 0
              ? "Nobody has suggested a prop yet."
              : "Nothing left to review."}
          </p>
        ) : (
          queue.pending.map((prop) => <Suggestion key={prop.id} prop={prop} />)
        )}

        {!loading && !loadError && queue.reviewedCount > 0 && (
          <>
            <h2 className="kicker">
              {/* A .bucket, not a plain action: the section head doubles as
                  the control that opens it, and the sheet draws that as a
                  rule under the words plus a caret, thickening when open. */}
              <button
                type="button"
                className="bucket"
                aria-expanded={filter !== null}
                data-state={filter === null ? "closed" : "open"}
                onClick={() => show(filter === null ? "all" : null)}
              >
                Reviewed · {queue.reviewedCount}
                <span className="car" aria-hidden="true">
                  {filter === null ? "▾" : "▴"}
                </span>
              </button>
            </h2>

            {filter !== null && (
              <div className="filters">
                <span className="riso-seg">
                  {REVIEWED_CHOICES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={filter === c.id}
                      onClick={() => show(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </span>
              </div>
            )}

            {filter !== null &&
              (queue.reviewed.length === 0 ? (
                <p className="lede">
                  Nothing {filter === "all" ? "" : filter}.
                </p>
              ) : (
                queue.reviewed.map((prop) => (
                  <Suggestion key={prop.id} prop={prop} />
                ))
              ))}
          </>
        )}
      </div>

      {/* Dialogs stay the app's own: they are shared furniture, and this sheet
          does not fork them. */}
      <Dialog
        open={offerPropFor !== null}
        onOpenChange={(open) => {
          if (!open) setOfferPropFor(null);
        }}
      >
        <DialogContent className="riso-dialog">
          <DialogHeader>
            <DialogTitle className="riso-dialog-title">
              Create a prop now?
            </DialogTitle>
            <DialogDescription className="riso-dialog-desc">
              {writable.length === 1
                ? `This will open the new prop form for ${writable[0].name}, with the claim and notes filled in.`
                : "Pick where it goes and the new prop form opens with the claim and notes filled in."}
            </DialogDescription>
          </DialogHeader>

          <div className="hxf riso-dialog-choices">
            {writable.map((competition) => (
              <button
                key={competition.id}
                type="button"
                className="submit"
                onClick={() => {
                  if (!offerPropFor) return;
                  // The suggestion travels as an id, not as text.
                  router.push(
                    `/competitions/${competition.id}/props/new?from=${offerPropFor.id}`,
                  );
                }}
              >
                {competition.name}
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>

          <DialogFooter className="hxf riso-dialog-footer">
            <button
              type="button"
              className="quit"
              onClick={() => setOfferPropFor(null)}
            >
              Not now
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
