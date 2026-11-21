import Link from "next/link";
import type { ReactNode } from "react";

import { sheetCss } from "@/components/prop-list/sheet";
import { NOTIFICATIONS } from "@/lib/notifications/types";

/**
 * The help page: how Haruspex works, and how to use it from an AI assistant.
 *
 * Plain reading matter set in the shared sheet (.hxp): a contents list of
 * section links, then one ruled section per topic. Every section has an id so
 * other pages, mail and announcements can link straight to it (/help#mcp).
 * The two URLs come in as props because they differ per deployment.
 */

export const HELP_SECTIONS = [
  { id: "how-it-works", title: "How Haruspex works" },
  { id: "competitions", title: "Competitions" },
  { id: "private-competitions", title: "Starting a private competition" },
  { id: "suggesting", title: "Suggesting a prop" },
  { id: "email", title: "Email notifications" },
  { id: "mcp", title: "Use Haruspex from Claude" },
] as const;

type SectionId = (typeof HELP_SECTIONS)[number]["id"];

const ownCss = `
/* The contents: one mono line per section, ruled like the rest of the sheet. */
.hxp .toc {
  list-style: none;
  margin: 1.75rem 0 0;
  padding: 0;
  max-width: 34rem;
}
.hxp .toc li { border-bottom: 1px solid var(--rule); }
.hxp .toc li:first-child { border-top: 1px solid var(--rule); }
.hxp .toc a {
  display: flex;
  gap: 1rem;
  padding: 0.625rem 0;
  color: var(--ink);
  text-decoration: none;
}
.hxp .toc a:hover { color: var(--red-text); }
.hxp .toc a:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }
.hxp .toc .n { color: var(--ink-muted); min-width: 1.5rem; }

/* A section: the kicker opens it, then reading matter at a readable measure.
   scroll-margin keeps a linked-to head clear of the top edge. */
.hxp .topic { scroll-margin-top: 1.5rem; }
.hxp .topic h2.kicker { margin-top: 4rem; }
.hxp .prose { max-width: 38rem; padding-top: 1.5rem; }
.hxp .prose p { margin: 0 0 1rem; }
.hxp .prose h3 {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 400;
  color: var(--ink-muted);
  margin: 2rem 0 0.75rem;
}
/* The reset strips list markers; steps need their numbers back. */
.hxp .prose ul, .hxp .prose ol { margin: 0 0 1rem; padding-left: 1.5rem; }
.hxp .prose ul { list-style: disc; }
.hxp .prose ol { list-style: decimal; }
.hxp .prose li::marker { color: var(--ink-muted); }
.hxp .prose li { margin: 0 0 0.5rem; }
.hxp .prose a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--red);
  text-underline-offset: 0.2em;
}
.hxp .prose a:hover { color: var(--red-text); }
.hxp .prose code {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
/* Something to copy: set apart by a hairline, never a box. */
.hxp .prose pre {
  margin: 0 0 1rem;
  padding: 0.75rem 0 0.75rem 1rem;
  border-left: 2px solid var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.hxp .prose dl { margin: 0 0 1rem; }
.hxp .prose dt { font-weight: 700; }
.hxp .prose dd { margin: 0 0 0.75rem; color: var(--ink-muted); }
`;

function Topic({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = HELP_SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section className="topic" id={id} aria-labelledby={`${id}-head`}>
      <h2 className="kicker" id={`${id}-head`}>
        <span>{title}</span>
      </h2>
      <div className="prose">{children}</div>
    </section>
  );
}

export function HelpSheet({
  mcpUrl,
  connectedAppsUrl,
}: {
  /** The MCP endpoint to paste into Claude, or null if this site has none. */
  mcpUrl: string | null;
  /** Identity's page for disconnecting an app, or null if unknown. */
  connectedAppsUrl: string | null;
}) {
  const optionalEmails = Object.values(NOTIFICATIONS).filter(
    (spec) => spec.optional,
  );

  return (
    <div className="hxp">
      <style dangerouslySetInnerHTML={{ __html: sheetCss + ownCss }} />
      <div className="col">
        <header className="masthead">
          <h1>Help</h1>
        </header>
        <p className="lede">
          How Haruspex works, and how to use it from an AI assistant.
        </p>

        <nav aria-label="Contents">
          <ol className="toc">
            {HELP_SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="n mono num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Topic id="how-it-works">
          <p>
            A <strong>prop</strong> is a question about the future with a
            deadline: &ldquo;Will X happen by Y?&rdquo; Most are yes or no. Some
            are multiple choice, where either exactly one option will happen or
            any number of them can.
          </p>
          <p>
            You <strong>forecast</strong> a probability. Saying 70% means you
            think it is more likely than not, but expect to be wrong about three
            times in ten. On a multiple-choice prop you give each option its own
            probability. You can change your forecast as often as you like until
            the forecast deadline.
          </p>
          <p>
            After the deadline the prop is <strong>resolved</strong>: someone
            records what actually happened.
          </p>
          <h3>Scoring</h3>
          <p>
            Each resolved forecast gets a Brier score: the squared distance
            between your probability and what happened (1 if it did, 0 if it did
            not). A perfect forecast scores 0, always saying 50% scores 0.25,
            and lower is better. Multiple-choice props are scored on the same 0
            to 1 scale. Your score in a competition is your average over its
            resolved props.
          </p>
          <p>
            The standings hide anyone who has not forecast every prop, by
            default, because an average over fewer props is not comparable with
            an average over all of them. Forecast everything to stay on the
            board.
          </p>
          <p>
            The <Link href="/standalone/calibration">Calibration</Link> page
            shows how well your probabilities match reality: whether the things
            you call 70% happen about 70% of the time.
          </p>
        </Topic>

        <Topic id="competitions">
          <p>Props live in competitions, and there are two kinds.</p>
          <dl>
            <dt>Public seasons</dt>
            <dd>
              Open to everyone with an account. The whole season shares one
              schedule: forecasts open, forecasts close, and the season ends.
              Site admins run them.
            </dd>
            <dt>Private competitions</dt>
            <dd>
              Visible only to their members. Each prop has its own forecast
              deadline and resolution date, so props can be added throughout.
              Members are either forecasters or admins. The competition&rsquo;s
              admins add props, add and remove members, and resolve props.
            </dd>
          </dl>
          <p>
            You can see every competition you belong to on the{" "}
            <Link href="/competitions">Competitions</Link> page.
          </p>
        </Topic>

        <Topic id="private-competitions">
          <p>
            For now, <strong>ask a site admin</strong>: only site admins can
            create competitions. Tell them what it should be called and who
            should run it. They will create it and make you one of its admins.
          </p>
          <p>
            From then on it is yours to run, from the competition&rsquo;s page:
          </p>
          <ul>
            <li>
              <strong>Add members.</strong> Anyone with a Haruspex account can
              be added. If someone is not in the list, ask them to sign in to
              Haruspex once first.
            </li>
            <li>
              <strong>Add props</strong>, each with its own forecast deadline
              and resolution date. You can choose to email the members about a
              new prop.
            </li>
            <li>
              <strong>Resolve props</strong> once you know the outcome.
            </li>
          </ul>
        </Topic>

        <Topic id="suggesting">
          <p>
            Have an idea for a prop?{" "}
            <Link href="/props/suggest">Suggest it</Link>, with a note on how it
            should be settled if that is not obvious. Suggestions go to the site
            admins, who review them and add the ones they accept to a season.
          </p>
        </Topic>

        <Topic id="email">
          <p>Haruspex can email you about:</p>
          <dl>
            {optionalEmails.map((spec) => (
              <div key={spec.label}>
                <dt>{spec.label}</dt>
                <dd>{spec.description}</dd>
              </div>
            ))}
          </dl>
          <p>
            Turn any of these off under{" "}
            <Link href="/account">Account Settings</Link>, or with the
            unsubscribe link at the bottom of the email itself. A message an
            admin writes to you personally always arrives.
          </p>
        </Topic>

        <Topic id="mcp">
          {mcpUrl ? (
            <McpSetup mcpUrl={mcpUrl} connectedAppsUrl={connectedAppsUrl} />
          ) : (
            <p>Connecting an assistant is not set up on this site.</p>
          )}
        </Topic>
      </div>
    </div>
  );
}

function McpSetup({
  mcpUrl,
  connectedAppsUrl,
}: {
  mcpUrl: string;
  connectedAppsUrl: string | null;
}) {
  return (
    <>
      <p>
        You can connect Claude, or another AI assistant that supports MCP, to
        your Haruspex account. It can then list competitions and props, read a
        prop in full, add props, and record resolutions. It acts as you: it sees
        only what you see on the site and can do only what you can do.
      </p>
      <p>
        <strong>Before you start, sign in to Haruspex once</strong>, so there is
        an account for the assistant to sign in to.
      </p>

      <h3>Claude on the web or the desktop app</h3>
      <ol>
        <li>
          Open <strong>Settings → Connectors</strong> and choose{" "}
          <strong>Add custom connector</strong>.
        </li>
        <li>
          Name it Haruspex, and enter this URL:
          <pre>
            <code>{mcpUrl}</code>
          </pre>
        </li>
        <li>
          Choose <strong>Connect</strong>, sign in, and approve the access
          Claude asks for.
        </li>
      </ol>
      <p>
        A connector added on claude.ai also appears in the desktop and mobile
        apps.
      </p>

      <h3>Claude Code</h3>
      <pre>
        <code>{`claude mcp add --transport http haruspex ${mcpUrl}`}</code>
      </pre>
      <p>
        Then run <code>/mcp</code> inside Claude Code to sign in.
      </p>

      <h3>Reading and writing</h3>
      <p>
        When you approve, you choose what the assistant may do: read
        competitions and props, or also add and resolve props. If you allow
        reading only, the assistant asks again the first time it needs to write.
      </p>

      <h3>Disconnecting</h3>
      <p>
        Remove the connector in Claude&rsquo;s settings
        {connectedAppsUrl ? (
          <>
            , and revoke its access under{" "}
            <a href={connectedAppsUrl}>Connected apps</a> in your identity
            account
          </>
        ) : null}
        . An assistant that is already signed in keeps working until its current
        access expires.
      </p>
    </>
  );
}
