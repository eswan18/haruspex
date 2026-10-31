import { describe, it, expect } from "vitest";

import { isSafeHref, renderEmailMarkdown } from "./email-markdown";

describe("renderEmailMarkdown", () => {
  it("renders headings, bold, italic and lists", () => {
    const html = renderEmailMarkdown(
      "## New Site Name\n\n**Bold** and *italic*.\n\n- one\n- two",
    );

    expect(html).toContain("<h2>New Site Name</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toMatch(/<ul>\s*<li>one<\/li>/);
  });

  it("keeps a single line break, as comms does", () => {
    expect(renderEmailMarkdown("Thanks,\nEthan")).toMatch(
      /Thanks,<br\s*\/?>\s*Ethan/,
    );
  });

  it("prints raw HTML as text", () => {
    const html = renderEmailMarkdown(
      '<script>alert("x")</script>\n\nHi <b>there</b>',
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("links a safe URL and prints an unsafe one as its words", () => {
    expect(renderEmailMarkdown("[go](https://haruspex.fyi/props/suggest)"))
      .toContain('<a href="https://haruspex.fyi/props/suggest" class="riso-md-link"');

    const unsafe = renderEmailMarkdown("[click](javascript:alert(1))");
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).toContain("click");
  });

  it("escapes quotes in an href so they cannot break out of the attribute", () => {
    const html = renderEmailMarkdown('[x](https://a.example/"onmouseover="alert(1))');

    expect(html).not.toMatch(/"\s*onmouseover=/);
  });
});

describe("isSafeHref", () => {
  it("allows http, https and mailto, and nothing else", () => {
    expect(isSafeHref("https://haruspex.fyi")).toBe(true);
    expect(isSafeHref("mailto:a@example.com")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("/props/suggest")).toBe(false);
  });
});
