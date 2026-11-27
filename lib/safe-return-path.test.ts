import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./safe-return-path";

const BASE = "https://haruspex.example";

describe("safeReturnPath", () => {
  it.each([
    ["/", "/"],
    ["/competitions/3", "/competitions/3"],
    ["/props?status=open&page=2", "/props?status=open&page=2"],
    ["/help#scoring", "/help#scoring"],
    // Same-origin absolute URLs are reduced to their path.
    [`${BASE}/account?tab=1`, "/account?tab=1"],
    // A relative path resolves against the site root.
    ["standings", "/standings"],
  ])("keeps the same-site destination %s", (input, expected) => {
    expect(safeReturnPath(input, BASE)).toBe(expected);
  });

  it.each([
    ["an absolute URL on another site", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash host", "/\\evil.example"],
    ["a mixed-slash host", "\\/evil.example"],
    ["a tab hidden between slashes", "/\t/evil.example"],
    ["a newline hidden between slashes", "/\n/evil.example"],
    ["a different scheme on the same host", "http://haruspex.example/"],
    ["a different port", "https://haruspex.example:8443/"],
    ["a lookalike host", "https://haruspex.example.evil.example/"],
    ["userinfo before another host", "https://haruspex.example@evil.example/"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
  ])("sends %s to the home page", (_name, input) => {
    expect(safeReturnPath(input, BASE)).toBe("/");
  });

  it.each([[""], [null], [undefined]])(
    "defaults a missing value (%s) to the home page",
    (input) => {
      expect(safeReturnPath(input, BASE)).toBe("/");
    },
  );

  it("returns the home page when the URL cannot be parsed", () => {
    expect(safeReturnPath("https://", BASE)).toBe("/");
    expect(safeReturnPath("/ok", "not a url")).toBe("/");
  });

  it("never returns something that resolves off-site", () => {
    const inputs = ["//evil.example//", "/\\/evil.example", "///evil.example"];
    for (const input of inputs) {
      const result = safeReturnPath(input, BASE);
      expect(new URL(result, BASE).origin).toBe(BASE);
    }
  });
});
