import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CompetitionOverview } from "./competition-overview";
import {
  CURRENT_USER_ID,
  NOW,
  emptyPrivateSeason,
  privateSeason,
} from "./fixtures";

const shared = { currentUserId: CURRENT_USER_ID, now: NOW };

function render(props: Parameters<typeof CompetitionOverview>[0]) {
  return renderToStaticMarkup(<CompetitionOverview {...props} />);
}

/**
 * The way in to the new-prop form.
 *
 * It lives here because every other link to that form sits behind a non-empty
 * prop list: the open-props page carries it, and the overview only links to
 * that page when something is open. So an empty competition offered its own
 * admin no way to write its first prop, which is the case the last test pins.
 */
describe("CompetitionOverview's new-prop link", () => {
  it("offers the form to a reader who may write one", () => {
    const html = render({
      data: privateSeason,
      ...shared,
      newPropHref: "/competitions/12/props/new",
    });

    expect(html).toContain('href="/competitions/12/props/new"');
    expect(html).toContain("Write a prop");
  });

  it("offers nothing to a reader who may not", () => {
    const html = render({ data: privateSeason, ...shared });

    expect(html).not.toContain("Write a prop");
    expect(html).not.toContain("props/new");
  });

  it("offers it in an empty competition, where no other link can", () => {
    const html = render({
      data: emptyPrivateSeason,
      ...shared,
      newPropHref: "/competitions/13/props/new",
    });

    // Nothing is open, so the open-props link — the form's only other home —
    // is absent. This is exactly the state that had no way forward.
    expect(html).not.toContain("props/open");
    expect(html).toContain('href="/competitions/13/props/new"');
  });
});
