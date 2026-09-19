import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { manageLink } from "./preferences";

describe("manageLink", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
  });

  it("points at the account page for mail a reader can turn off", () => {
    expect(manageLink("competition.prop_added")).toBe(
      "https://haruspex.test/account",
    );
  });

  it("gives none for mail that is always sent", () => {
    // comms prints the footer link only when one arrives, so withholding it
    // here is what keeps an unmanageable email from offering to be managed.
    expect(manageLink("admin.manual_email")).toBeUndefined();
  });
});
