import { describe, it, expect } from "vitest";

import {
  isOptionalNotification,
  notificationDefault,
  OPTIONAL_NOTIFICATION_TYPES,
} from "./types";

describe("notification registry", () => {
  /**
   * The tripwire.
   *
   * A reader's row is written only when they choose, so everyone who never
   * chose follows the default below. Changing one here therefore moves those
   * readers — silently, and without them asking.
   *
   * IF THIS TEST FAILS because you meant to change a default: first write a
   * migration that inserts the OLD value as an explicit row for every user
   * who has none, so nobody's setting changes under them. Then update this
   * test. Adding a new type needs no migration — nobody has an opinion yet.
   */
  it("pins each default; changing one needs a migration first", () => {
    const defaults = Object.fromEntries(
      OPTIONAL_NOTIFICATION_TYPES.map((type) => [
        type,
        notificationDefault(type),
      ]),
    );

    expect(defaults).toEqual({
      "competition.member_added": true,
      "competition.prop_added": true,
    });
  });

  it("does not offer a preference for mail that is always sent", () => {
    expect(isOptionalNotification("admin.manual_email")).toBe(false);
    expect(OPTIONAL_NOTIFICATION_TYPES).not.toContain("admin.manual_email");
  });

  it("rejects a type it does not know", () => {
    expect(isOptionalNotification("competition.prop_removed")).toBe(false);
  });
});
