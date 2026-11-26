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
 * The MCP URL comes in as a prop because it differs per deployment.
 */

export const HELP_SECTIONS = [
  { id: "how-it-works", title: "How Haruspex works" },
  { id: "competitions", title: "Competitions" },
  { id: "suggesting", title: "Suggesting a prop" },
  { id: "email", title: "Email notifications" },
  { id: "mcp", title: "Haruspex MCP" },
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
}: {
  /** The MCP endpoint to paste into an assistant, or null if this site has none. */
  mcpUrl: string | null;
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
            Propositions, or <strong>props</strong>, are falsifiable predictions
            about the future. Most are yes or no, but some have multiple
            choices.
          </p>
          <p>
            For each prop, you register a <strong>forecast</strong>: the
            probability you assign to it coming true.
          </p>
          <p>
            Sometime after the deadline, a prop <strong>resolves</strong> when
            it&rsquo;s clear whether it came to pass.
          </p>
          <p>
            Some props say up front what would void them. A{" "}
            <strong>voided</strong> prop is settled with no result, and counts
            toward nobody&rsquo;s score.
          </p>
          <h3>Scoring</h3>
          <p>
            Forecasts are scored by{" "}
            <a href="https://en.wikipedia.org/wiki/Brier_score">Brier score</a>,
            the square of the &ldquo;error&rdquo;. The error is the difference
            between your forecast and the result, encoded as 1 or 0. So a 70%
            forecast of a prop that resolved to true would have an error of 0.3
            (1 &minus; 0.70), for a Brier score of 0.09 (0.3<sup>2</sup>). If
            that prop hadn&rsquo;t come true, it would be an error of 0.7, for a
            score of 0.49.
          </p>
        </Topic>

        <Topic id="competitions">
          <p>
            Competitions are collections of props. There are both public and
            private competitions.
          </p>
          <ul>
            <li>
              <strong>Public seasons:</strong> Open to everyone with an account.
              Usually annual.
            </li>
            <li>
              <strong>Private competitions:</strong> Visible only to members. No
              set schedule.
            </li>
          </ul>
        </Topic>

        <Topic id="suggesting">
          <p>
            You can <Link href="/props/suggest">suggest ideas</Link> for new
            props in the following year&rsquo;s public competition. Site admins
            review each suggestion and accept or reject it.
          </p>
        </Topic>

        <Topic id="email">
          <p>Haruspex can email you about:</p>
          <ul>
            {optionalEmails.map((spec) => (
              <li key={spec.label}>
                <strong>{spec.label}:</strong> {spec.description}
              </li>
            ))}
          </ul>
          <p>
            Turn any of these off under{" "}
            <Link href="/account">Account Settings</Link>, or with the
            unsubscribe link at the bottom of the email itself.
          </p>
        </Topic>

        <Topic id="mcp">
          {mcpUrl ? (
            <McpSetup mcpUrl={mcpUrl} />
          ) : (
            <p>Connecting an assistant is not set up on this site.</p>
          )}
        </Topic>
      </div>
    </div>
  );
}

function McpSetup({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <p>
        You can connect your AI assistant &mdash; including Claude or ChatGPT
        &mdash; to your Haruspex account. This lets the AI see competitions,
        props, and forecasts.
      </p>
      <p>
        You must have an existing Haruspex account before you can use the MCP.
      </p>

      <h3>Connecting</h3>
      <p>Use these instructions to connect common AI tools:</p>
      <ul>
        <li>
          <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">
            Claude: custom connectors
          </a>
        </li>
        <li>
          <a href="https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt">
            ChatGPT: custom MCP servers
          </a>
        </li>
      </ul>
      <p>
        MCP URL: <code>{mcpUrl}</code>
      </p>
    </>
  );
}
