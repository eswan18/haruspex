import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe-token";

describe("unsubscribe tokens", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-secret");
  });

  it("round-trips the reader and the notification", () => {
    const token = signUnsubscribeToken(7, "competition.prop_added");

    expect(verifyUnsubscribeToken(token)).toEqual({
      userId: 7,
      type: "competition.prop_added",
    });
  });

  it("refuses a token signed with another secret", () => {
    const token = signUnsubscribeToken(7, "competition.prop_added");
    // Rotating the secret is the only revocation these links have, since they
    // deliberately never expire.
    vi.stubEnv("JWT_SECRET", "rotated-secret");

    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("refuses a token whose reader was swapped", () => {
    const token = signUnsubscribeToken(7, "competition.prop_added");
    const forged = token.replace(/^7:/, "8:");

    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("refuses a token whose notification was swapped", () => {
    const token = signUnsubscribeToken(7, "competition.prop_added");
    const forged = token.replace(
      "competition.prop_added",
      "competition.member_added",
    );

    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("refuses mail that cannot be turned off, however well signed", () => {
    // Nothing should mint one of these, but a token is only as good as what
    // the reader of it will act on.
    const token = signUnsubscribeToken(7, "admin.manual_email" as never);

    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("refuses rubbish", () => {
    for (const token of [
      "",
      "not-a-token",
      "7:competition.prop_added",
      "7:competition.prop_added:",
      "7:competition.prop_added:zz",
      ":::",
      "seven:competition.prop_added:abcd",
    ]) {
      expect(verifyUnsubscribeToken(token)).toBeNull();
    }
  });

  it("refuses to sign without a secret, rather than signing with nothing", () => {
    vi.stubEnv("JWT_SECRET", "");

    expect(() => signUnsubscribeToken(7, "competition.prop_added")).toThrow(
      /JWT_SECRET/,
    );
  });
});
