"use client";

import { useId, useState } from "react";

import { Field } from "@/components/form-sheet/form-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const BUG_REPORT_MAX_LENGTH = 5_000;

/**
 * The bug report form, with how it is sent left to the caller.
 *
 * Kept apart from the navbar button that wires it to Sentry so it can be
 * looked at in Storybook without a Sentry client behind it.
 *
 * On failure the text stays where it was: a report the reader took the
 * trouble to write is not thrown away because the network blinked.
 */
export function BugReportDialog({
  open,
  onOpenChange,
  send,
  initialMessage = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves once the report is accepted; rejects if it was not. */
  send: (message: string) => Promise<void>;
  /** For stories. */
  initialMessage?: string;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const id = useId();
  const trimmed = message.trim();

  function close(next: boolean) {
    if (status === "sending") return;
    onOpenChange(next);
    if (!next) {
      // Start the next report fresh, but only once this one went.
      if (status === "sent") setMessage("");
      setStatus("idle");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || trimmed.length > BUG_REPORT_MAX_LENGTH) return;
    setStatus("sending");
    try {
      await send(trimmed);
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            {status === "sent"
              ? "Thanks — your report is in."
              : "Something broken, wrong or confusing? Say what you were doing and what happened. The page you’re on and your account are attached."}
          </DialogDescription>
        </DialogHeader>

        {status === "sent" ? (
          <DialogFooter className="hxf">
            <button type="button" className="submit" onClick={() => close(false)}>
              Close
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
          </DialogFooter>
        ) : (
          <form className="hxf" onSubmit={submit}>
            <Field
              label="What went wrong?"
              htmlFor={id}
              count={[message.length, BUG_REPORT_MAX_LENGTH]}
              error={
                status === "failed"
                  ? "That didn’t send. Your text is still here; try again in a moment."
                  : undefined
              }
            >
              <textarea
                id={id}
                rows={7}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="I opened a prop and the chart was empty…"
                disabled={status === "sending"}
              />
            </Field>
            <DialogFooter>
              <button
                type="button"
                className="quit"
                onClick={() => close(false)}
                disabled={status === "sending"}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="submit"
                disabled={
                  status === "sending" ||
                  !trimmed ||
                  trimmed.length > BUG_REPORT_MAX_LENGTH
                }
              >
                {status === "sending" ? "Sending…" : "Send"}
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
