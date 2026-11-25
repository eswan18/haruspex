import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NOTIFICATIONS } from "@/lib/notifications/types";
import { HELP_SECTIONS, HelpSheet } from "./help-sheet";

const html = renderToStaticMarkup(
  <HelpSheet mcpUrl="https://haruspex.fyi/mcp" />,
);

describe("HelpSheet", () => {
  it("has the five sections, each reachable from the contents", () => {
    expect(HELP_SECTIONS.map((s) => s.id)).toEqual([
      "how-it-works",
      "competitions",
      "suggesting",
      "email",
      "mcp",
    ]);
    for (const { id } of HELP_SECTIONS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("prints the MCP URL, links to Claude and ChatGPT setup", () => {
    expect(html).toContain("<code>https://haruspex.fyi/mcp</code>");
    expect(html).toContain('href="https://support.claude.com/');
    expect(html).toContain('href="https://help.openai.com/');
  });

  it("lists every email a reader can turn off, from the registry", () => {
    for (const spec of Object.values(NOTIFICATIONS)) {
      if (spec.optional) expect(html).toContain(spec.label);
    }
  });

  it("says the assistant setup is unavailable when there is no MCP URL", () => {
    const bare = renderToStaticMarkup(<HelpSheet mcpUrl={null} />);
    expect(bare).not.toContain("support.claude.com");
    expect(bare).toMatch(/not set up on this site/i);
  });
});
