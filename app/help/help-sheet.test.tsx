import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NOTIFICATIONS } from "@/lib/notifications/types";
import { HELP_SECTIONS, HelpSheet } from "./help-sheet";

const html = renderToStaticMarkup(
  <HelpSheet
    mcpUrl="https://haruspex.fyi/mcp"
    connectedAppsUrl="https://identity.ethanswan.com/oauth/connected-apps"
  />,
);

describe("HelpSheet", () => {
  it("has the six sections, each reachable from the contents", () => {
    expect(HELP_SECTIONS.map((s) => s.id)).toEqual([
      "how-it-works",
      "competitions",
      "private-competitions",
      "suggesting",
      "email",
      "mcp",
    ]);
    for (const { id } of HELP_SECTIONS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("tells a reader to ask an admin for a private competition", () => {
    expect(html).toMatch(/ask a site admin/i);
  });

  it("prints the MCP URL for both setups, and the connected-apps link", () => {
    expect(html).toContain("https://haruspex.fyi/mcp");
    expect(html).toContain(
      "claude mcp add --transport http haruspex https://haruspex.fyi/mcp",
    );
    expect(html).toContain(
      'href="https://identity.ethanswan.com/oauth/connected-apps"',
    );
  });

  it("lists every email a reader can turn off, from the registry", () => {
    for (const spec of Object.values(NOTIFICATIONS)) {
      if (spec.optional) expect(html).toContain(spec.label);
    }
  });

  it("says the assistant setup is unavailable when there is no MCP URL", () => {
    const bare = renderToStaticMarkup(
      <HelpSheet mcpUrl={null} connectedAppsUrl={null} />,
    );
    expect(bare).not.toContain("claude mcp add");
    expect(bare).toMatch(/not set up on this site/i);
  });
});
