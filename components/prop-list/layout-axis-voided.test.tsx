import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LayoutAxis } from "./layout-axis";
import { resolvedFixture } from "./fixtures";

/** The resolved list prints Void where a voided prop's penalty would go. */
describe("LayoutAxis on a voided prop", () => {
  it("prints Void in the penalty cell and draws no truth mark", () => {
    const voided = resolvedFixture.filter((p) => p.voided);
    expect(voided).toHaveLength(1);
    const html = renderToStaticMarkup(
      <LayoutAxis props={voided} resolved />,
    );
    expect(html).toContain('<span class="pen none">Void</span>');
    expect(html).not.toContain('class="truth"');
  });
});
