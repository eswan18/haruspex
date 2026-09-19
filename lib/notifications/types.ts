/**
 * Every email haruspex can cause to be sent, and whether a reader may turn it
 * off.
 *
 * Pure: no database, no server-only, so the settings page can import the
 * labels it shows. The keys are the `event_type` values published to Pub/Sub,
 * which is what ties a preference to the mail it suppresses.
 *
 * A reader's choice is stored only when they make one (see
 * `notification_preferences`); everyone else follows the `default` here. So
 * changing a default moves everyone who never chose — which is why
 * `types.test.ts` pins these values and tells you what to do about it.
 */

type NotificationSpec =
  | {
      /** The reader may turn it off, so it appears on the account page. */
      optional: true;
      /** What a reader who has never chosen gets. */
      default: boolean;
      label: string;
      description: string;
    }
  | {
      /**
       * Always sent. Nothing about it appears on the account page, and
       * nothing may filter on it.
       */
      optional: false;
    };

export const NOTIFICATIONS = {
  "competition.member_added": {
    optional: true,
    default: true,
    label: "Added to a competition",
    description:
      "When someone adds you to a private competition, so you know it is there.",
  },
  "competition.prop_added": {
    optional: true,
    default: true,
    label: "New props",
    description:
      "When a prop is added to a competition of yours that opens each prop on its own deadline.",
  },
  // One person writing to another from the admin Users page. Muting it would
  // silently eat a message meant for this reader alone, so it cannot be.
  "admin.manual_email": { optional: false },
} as const satisfies Record<string, NotificationSpec>;

export type NotificationType = keyof typeof NOTIFICATIONS;

/** The types a reader may turn off — the only ones a preference can name. */
export type OptionalNotificationType = {
  [K in NotificationType]: (typeof NOTIFICATIONS)[K]["optional"] extends true
    ? K
    : never;
}[NotificationType];

export const OPTIONAL_NOTIFICATION_TYPES = (
  Object.keys(NOTIFICATIONS) as NotificationType[]
).filter(isOptionalNotification);

export function isOptionalNotification(
  type: string,
): type is OptionalNotificationType {
  return (
    type in NOTIFICATIONS &&
    NOTIFICATIONS[type as NotificationType].optional === true
  );
}

/** What a reader who has never chosen gets. */
export function notificationDefault(type: OptionalNotificationType): boolean {
  const spec = NOTIFICATIONS[type];
  // The narrowing is by construction: only optional specs carry a default.
  return spec.optional ? spec.default : true;
}
