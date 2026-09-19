"use client";

import { useState } from "react";

import { SettingToggle } from "@/components/setting-toggle/setting-toggle";
import { useToast } from "@/hooks/use-toast";
import { setNotificationPreference } from "@/lib/db_actions";
import type { EffectivePreferences } from "@/lib/notifications/preferences";
import {
  NOTIFICATIONS,
  OPTIONAL_NOTIFICATION_TYPES,
  type OptionalNotificationType,
} from "@/lib/notifications/types";

export const notifyCss = `
/* One line per kind of mail: what it is on the left, the switch on the right,
   hairline between. The same ruled list the record above it prints. */
.hxp .notify { margin: 0; padding-top: 0.25rem; }
.hxp .notify .line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem 2rem;
  flex-wrap: wrap;
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--rule);
  max-width: 34rem;
}
.hxp .notify .txt { flex: 1 1 16rem; min-width: 0; }
.hxp .notify .who {
  display: block;
  font-size: 0.9375rem;
}
.hxp .notify .what {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}
`;

/**
 * The reader's own notification settings.
 *
 * Presentational: it is handed the values and told what to call. Every switch
 * shows what the reader is actually getting, which for someone who has never
 * chosen is the registry's default — there is no third "unset" reading here,
 * because from the reader's side there is no such state.
 */
export function NotificationList({
  values,
  onSet,
  busy = null,
}: {
  values: EffectivePreferences;
  /** Omit for a read-only printing of the settings. */
  onSet?: (type: OptionalNotificationType, enabled: boolean) => void;
  /** The one type whose save is in flight, if any. */
  busy?: OptionalNotificationType | null;
}) {
  return (
    <div className="notify">
      {OPTIONAL_NOTIFICATION_TYPES.map((type) => {
        const spec = NOTIFICATIONS[type];
        if (!spec.optional) return null;
        return (
          <div className="line" key={type}>
            <div className="txt">
              <span className="who">{spec.label}</span>
              <p className="what">{spec.description}</p>
            </div>
            <SettingToggle
              label={spec.label}
              value={values[type]}
              busy={busy === type}
              onSet={onSet && ((enabled) => onSet(type, enabled))}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The same list, wired to the server.
 *
 * Each switch saves on its own press. Nothing is written for a setting the
 * reader did not touch, which is what keeps a later change of default from
 * being frozen out for everyone by one visit to this page.
 */
export function NotificationSettings({
  initial,
}: {
  initial: EffectivePreferences;
}) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState<OptionalNotificationType | null>(null);
  const { toast } = useToast();

  async function onSet(type: OptionalNotificationType, enabled: boolean) {
    // Show the asked-for reading straight away, in the busy ink, rather than
    // the old one for the length of the round trip — which reads as "nothing
    // happened". A refusal puts it back and says so.
    const previous = values[type];
    setValues((current) => ({ ...current, [type]: enabled }));
    setPending(type);

    const result = await setNotificationPreference({ type, enabled });

    setPending(null);
    if (!result.success) {
      setValues((current) => ({ ...current, [type]: previous }));
      toast({
        title: "That didn't save",
        description: result.error,
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <h2 className="kicker">
        <span>Notifications</span>
      </h2>
      <p className="lede">
        Which emails Haruspex sends you. A message written to you by an admin is
        not on this list: those are always delivered.
      </p>
      <NotificationList values={values} onSet={onSet} busy={pending} />
    </>
  );
}
