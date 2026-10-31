"use client";

import * as Sentry from "@sentry/nextjs";
import { Bug } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { BugReportDialog } from "./bug-report-dialog";

/**
 * The bug icon in the navbar, for signed-in readers.
 *
 * Reports go to Sentry as user feedback rather than anywhere in haruspex:
 * Sentry attaches the session replay (the buffered one is flushed for the
 * report, not only the sampled sessions) and any errors around it, and its
 * alert rules do the notifying. There is no table or admin page for these on
 * purpose.
 *
 * `sendFeedback`, not `captureFeedback`: it waits for Sentry to accept the
 * report and rejects if it did not — including when the browser client is
 * not running at all — so the dialog can say so instead of thanking the
 * reader for a report that went nowhere.
 */
export function BugReportButton({
  user,
}: {
  user: { id: number; name: string; email: string };
}) {
  const [open, setOpen] = useState(false);

  async function send(message: string) {
    await Sentry.sendFeedback(
      {
        message,
        name: user.name,
        email: user.email,
        url: window.location.href,
        source: "navbar-bug-button",
        tags: { user_id: user.id },
      },
      { includeReplay: true },
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="riso-icon-btn"
        onClick={() => setOpen(true)}
        title="Report a problem"
      >
        <Bug className="h-4 w-4" />
        <span className="sr-only">Report a problem</span>
      </Button>
      <BugReportDialog open={open} onOpenChange={setOpen} send={send} />
    </>
  );
}
