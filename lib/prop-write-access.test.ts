import { describe, expect, it } from "vitest";

import { canCreateProps } from "./prop-write-access";

describe("canCreateProps", () => {
  describe("a private competition", () => {
    it("lets its own admin write", () => {
      expect(
        canCreateProps({ isPrivate: true, role: "admin", isSiteAdmin: false }),
      ).toBe(true);
    });

    it("keeps a forecaster out", () => {
      expect(
        canCreateProps({
          isPrivate: true,
          role: "forecaster",
          isSiteAdmin: false,
        }),
      ).toBe(false);
    });

    it("keeps a non-member out", () => {
      expect(
        canCreateProps({ isPrivate: true, role: null, isSiteAdmin: false }),
      ).toBe(false);
    });

    it("keeps out a site admin who is not a member", () => {
      // A private competition is its members' business; running the site does
      // not make you an admin of someone else's private season.
      expect(
        canCreateProps({ isPrivate: true, role: null, isSiteAdmin: true }),
      ).toBe(false);
    });
  });

  describe("a public competition", () => {
    it("lets a site admin write", () => {
      expect(
        canCreateProps({ isPrivate: false, role: null, isSiteAdmin: true }),
      ).toBe(true);
    });

    it("keeps an ordinary forecaster out", () => {
      expect(
        canCreateProps({ isPrivate: false, role: null, isSiteAdmin: false }),
      ).toBe(false);
    });

    it("ignores the membership role entirely", () => {
      // competition_members carries no rows for a public competition -- a
      // trigger rejects them -- so the role is always null here and asking it
      // anything would deny everyone.
      expect(
        canCreateProps({ isPrivate: false, role: "admin", isSiteAdmin: false }),
      ).toBe(false);
    });
  });
});
