import { NOTIFICATIONS } from "@/lib/notifications/types";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

import { UnsubscribeSheet } from "./unsubscribe-sheet";

/**
 * The page an unsubscribe link lands on.
 *
 * It only ever asks, or reports what the POST to `/api/unsubscribe` did. A GET
 * must never change a setting: mail scanners and link prefetchers follow every
 * URL in a message, and readers would find themselves unsubscribed by a robot.
 *
 * No session is read, so it works from an email in any browser. `done` is
 * cosmetic — it says what the POST already did, and cannot itself write.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; done?: string }>;
}) {
  const { t, done } = await searchParams;

  const verified = t ? verifyUnsubscribeToken(t) : null;
  if (!verified) {
    return <UnsubscribeSheet state="invalid" />;
  }

  const spec = NOTIFICATIONS[verified.type];
  // Only optional types survive verification, so this holds; the check is for
  // the type checker's sake rather than the reader's.
  if (!spec.optional) {
    return <UnsubscribeSheet state="invalid" />;
  }

  const state = done === "off" ? "off" : done === "on" ? "on" : "ask";
  return (
    <UnsubscribeSheet
      state={state}
      label={spec.label}
      description={spec.description}
      token={t}
    />
  );
}
