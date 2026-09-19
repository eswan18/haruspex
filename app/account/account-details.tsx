"use client";

import Image from "next/image";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { sheetCss } from "@/components/prop-list/sheet";
import { toggleCss } from "@/components/setting-toggle/setting-toggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { EffectivePreferences } from "@/lib/notifications/preferences";

import { NotificationSettings, notifyCss } from "./notification-settings";

const ownCss = `
/* The record: a portrait struck at the left, the facts ruled beside it. Every
   line is one key and one value, so the hairlines do the separating and
   nothing needs a box. */
.hxp .record {
  display: flex;
  align-items: flex-start;
  gap: 0 2rem;
  flex-wrap: wrap;
  padding-top: 1.75rem;
}
.hxp .facts { flex: 1 1 18rem; min-width: 0; margin: 0; }

.hxp .fact {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  gap: 0 1.5rem;
  align-items: baseline;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .fact:first-child { padding-top: 0; }
.hxp .fact .k {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.hxp .fact .v {
  margin: 0;
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}
/* A handle and an address are machine strings, set the way the roster sets
   them, not the way a person's name is set. */
.hxp .fact .v.id {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
}

/* The one picture in the app, and the only reason it survives the argument
   that cut portraits from the roster: this one is the reader's own, it is the
   fastest way to tell which account you are signed into, and it is never
   stood in for — with no picture at the provider the row simply does not
   print, rather than degrading to a grey plate with an initial in it. Square,
   because nothing else in this language is round. */
.hxp .portrait {
  display: block;
  background: none;
  border: 0;
  padding: 0;
  margin: 0 0 1rem;
  cursor: zoom-in;
}
.hxp .portrait img {
  display: block;
  width: 5rem;
  height: 5rem;
  object-fit: cover;
  border: 1px solid var(--rule);
}
.hxp .portrait:hover img { border-color: var(--ink); }
.hxp .portrait:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }

/* The way out, cut as the sign-in plate is cut: this page has one action on
   it, it leaves the app, and it gets the whole block of ink. */
.hxp .out {
  display: block;
  width: 100%;
  max-width: 34rem;
  margin-top: 1.75rem;
  padding: 1.0625rem 1.25rem;
  background: var(--ink);
  color: var(--paper);
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  text-decoration: none;
  transition: background-color 120ms ease;
}
.hxp .out:hover { background: var(--red); }
.hxp .out:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }
.hxp .out .arrow { float: right; }

.hxp .note {
  padding-top: 1rem;
  margin: 0;
  max-width: 34rem;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}
.hxp .note.mono { font-size: 0.6875rem; }
`;

/**
 * The reader's own account.
 *
 * Authentication is delegated, so the record itself is not editable here and
 * the page refuses to pretend otherwise: it prints what the app holds about
 * you, then hands you the door to the provider that owns it. The one thing
 * that IS ours to set is which mail we send, so that sits between them.
 */
export function AccountDetails({
  idpBaseUrl,
  notifications,
}: {
  idpBaseUrl?: string;
  /** Null when nobody is signed in, or the read failed. */
  notifications: EffectivePreferences | null;
}) {
  const { user, isLoading } = useCurrentUser();
  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{
          __html: sheetCss + ownCss + notifyCss + toggleCss,
        }}
      />
      <div className="col">
        <header className="masthead">
          <h1>Account</h1>
        </header>
        {user ? (
          <AccountRecord
            email={user.email}
            username={user.username}
            name={user.name}
            pictureUrl={user.picture_url}
            idpBaseUrl={idpBaseUrl}
            notifications={notifications}
          />
        ) : (
          <p className="lede">
            {isLoading ? "Reading your record…" : "You are not signed in."}
          </p>
        )}
      </div>
    </div>
  );
}

/** The provider's account page, or nothing if this deployment has no provider. */
function accountSettingsUrl(idpBaseUrl?: string) {
  if (!idpBaseUrl) return undefined;
  return `${idpBaseUrl.replace(/\/+$/, "")}/oauth/account-settings`;
}

function AccountRecord({
  email,
  username,
  name,
  pictureUrl,
  idpBaseUrl,
  notifications,
}: {
  email: string;
  username: string | null;
  name: string | null;
  pictureUrl: string | null;
  idpBaseUrl?: string;
  notifications: EffectivePreferences | null;
}) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const settingsUrl = accountSettingsUrl(idpBaseUrl);

  return (
    <>
      <h2 className="kicker">
        <span>Signed in as</span>
      </h2>
      <div className="record">
        {pictureUrl && (
          <>
            <button
              type="button"
              className="portrait"
              onClick={() => setAvatarOpen(true)}
              aria-label="Enlarge your profile picture"
            >
              <Image
                src={pictureUrl}
                alt="Your avatar"
                width={80}
                height={80}
              />
            </button>
            <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
              <DialogContent className="flex items-center justify-center bg-transparent border-none shadow-none p-0 max-w-fit outline-none focus:outline-none [&>button]:hidden">
                <DialogTitle className="sr-only">Profile picture</DialogTitle>
                <Image
                  src={pictureUrl}
                  alt="Your avatar"
                  width={300}
                  height={300}
                  className="h-72 w-72 object-cover"
                />
              </DialogContent>
            </Dialog>
          </>
        )}
        <dl className="facts">
          {name && (
            <div className="fact">
              <dt className="k">Name</dt>
              <dd className="v">{name}</dd>
            </div>
          )}
          {username && (
            <div className="fact">
              <dt className="k">Username</dt>
              <dd className="v id">{username}</dd>
            </div>
          )}
          <div className="fact">
            <dt className="k">Email</dt>
            <dd className="v id">{email}</dd>
          </div>
        </dl>
      </div>

      {notifications && <NotificationSettings initial={notifications} />}

      <h2 className="kicker">
        <span>Identity provider</span>
      </h2>
      <p className="lede">
        Your name, username, email and picture are held by the identity
        provider. They are changed there, not here.
      </p>
      {settingsUrl ? (
        <>
          <a
            className="out"
            href={settingsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage account details
            <span className="arrow" aria-hidden="true">
              ↗
            </span>
          </a>
          <p className="note">Opens your identity provider in a new tab.</p>
        </>
      ) : (
        // Previously this still printed the button, with no href behind it.
        <p className="note mono">No identity provider is configured</p>
      )}
    </>
  );
}
