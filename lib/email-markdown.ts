import { marked, Renderer, type Tokens } from "marked";

/**
 * Markdown for the emails an admin writes (the announcement and the one-to-one
 * message), as the admin forms preview it.
 *
 * comms renders the real email from the same parser with the same options —
 * see its `src/emails/markdown-body.tsx` — so a preview here is what the
 * reader gets. The two must agree on three things, and changing one side
 * means changing the other:
 *
 * - `breaks: true`: a single line break stays a line break, as the plain-text
 *   body always did. Without it "Thanks,\nEthan" runs together.
 * - Raw HTML is printed as the text it is, never rendered.
 * - Only http(s) and mailto links are links; anything else is its words.
 *
 * marked rather than the `markdown-to-jsx` the props use, because that has no
 * way to keep single line breaks, and a preview that differed from the email
 * would be worse than none.
 */
export const EMAIL_MARKDOWN_OPTIONS = { gfm: true, breaks: true } as const;

/** http(s) and mailto only. Anything else is printed as its link text. */
export function isSafeHref(href: string): boolean {
  try {
    const { protocol } = new URL(href);
    return (
      protocol === "https:" || protocol === "http:" || protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const renderer = new Renderer();
// Raw HTML, block or inline: the characters as typed.
renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
renderer.link = function ({ href, tokens }: Tokens.Link) {
  const text = this.parser.parseInline(tokens);
  if (!isSafeHref(href)) return text;
  return `<a href="${escapeHtml(href)}" class="riso-md-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
// No images in these emails: the alt text stands in.
renderer.image = ({ text }: Tokens.Image) => escapeHtml(text);

/**
 * The HTML a preview shows. Safe to set as inner HTML: every piece of text
 * marked emits is escaped, and the overrides above escape the rest.
 */
export function renderEmailMarkdown(source: string): string {
  return marked.parse(source, {
    ...EMAIL_MARKDOWN_OPTIONS,
    renderer,
    async: false,
  });
}
