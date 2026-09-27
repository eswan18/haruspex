import { FormSheet } from "@/components/form-sheet/form-sheet";

export const unsubCss = `
/* One statement and one press. No fields, so the sheet is mostly air: the
   claim, then the plate of ink that acts on it. */
.hxp .unsub { max-width: 34rem; }
.hxp .unsub .what {
  margin: 0 0 1.75rem;
  font-size: 0.9375rem;
  color: var(--ink-muted);
}
.hxp .unsub .submit { width: 100%; }
.hxp .unsub .after {
  padding-top: 1.25rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}
`;

/**
 * What an unsubscribe link shows.
 *
 * Asking rather than announcing is the whole design: the GET that lands here
 * changes nothing, because link scanners follow GETs. The press below is a
 * POST, and it is the first thing that writes.
 *
 * Presentational and cookie-free — it is shown to a reader with no session,
 * and names the notification rather than the reader. The token in the URL is
 * a credential, so the page reveals nothing a leaked link would not already
 * have earned.
 */
export function UnsubscribeSheet({
  state,
  label,
  description,
  token,
}: {
  /** `ask` before anything is written; the others report what was. */
  state: "ask" | "off" | "on" | "invalid";
  /** The notification's name, absent on a link that proves nothing. */
  label?: string;
  description?: string;
  token?: string;
}) {
  if (state === "invalid") {
    return (
      <Sheet kicker="Unsubscribe" title="This link is not valid">
        <div className="unsub">
          <p className="what">
            It may have been mangled in transit, or it may be older than the
            key that signed it. Your settings are unchanged.
          </p>
          <p className="after">
            Every notification can be set from{" "}
            <a className="riso-md-link" href="/account">
              your account page
            </a>
            .
          </p>
        </div>
      </Sheet>
    );
  }

  if (state === "off") {
    return (
      <Sheet kicker="Unsubscribed" title={`No more ${lower(label)}`}>
        <div className="unsub">
          <p className="what">
            That is switched off. Nothing else about your account has changed.
          </p>
          <Press token={token} enabled label="Actually, keep sending these" />
          <p className="after">
            Everything else is on{" "}
            <a className="riso-md-link" href="/account">
              your account page
            </a>
            .
          </p>
        </div>
      </Sheet>
    );
  }

  if (state === "on") {
    return (
      <Sheet kicker="Back on" title={`You will get ${lower(label)} again`}>
        <div className="unsub">
          <p className="what">Switched back on.</p>
          <p className="after">
            Everything else is on{" "}
            <a className="riso-md-link" href="/account">
              your account page
            </a>
            .
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet kicker="Unsubscribe" title={`Stop sending ${lower(label)}?`}>
      <div className="unsub">
        <p className="what">{description}</p>
        <Press token={token} enabled={false} label="Turn it off" />
        <p className="after">
          Nothing is switched off until you press it. To set each notification
          separately, use{" "}
          <a className="riso-md-link" href="/account">
            your account page
          </a>
          .
        </p>
      </div>
    </Sheet>
  );
}

/** The sheet itself, with the same masthead and way home in every state. */
function Sheet({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <FormSheet
      title={title}
      kicker={kicker}
      back={{ href: "/", label: "Haruspex" }}
      extraCss={unsubCss}
    >
      {children}
    </FormSheet>
  );
}

/**
 * The one press. A real form POST, so it works with no JavaScript at all —
 * which an email's reader may well have.
 */
function Press({
  token,
  enabled,
  label,
}: {
  token?: string;
  enabled: boolean;
  label: string;
}) {
  return (
    <form
      method="post"
      action={`/api/unsubscribe?t=${encodeURIComponent(token ?? "")}`}
    >
      <input type="hidden" name="enabled" value={String(enabled)} />
      <button type="submit" className="submit">
        {label}
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
    </form>
  );
}

/** "New props" reads as "new props" mid-sentence. */
function lower(label?: string): string {
  if (!label) return "these";
  return label.charAt(0).toLowerCase() + label.slice(1);
}
