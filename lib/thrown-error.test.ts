import { describe, expect, it } from "vitest";

import {
  describeThrownError,
  isSignedOutError,
  NETWORK_MESSAGE,
  settleAction,
  SIGNED_OUT_MESSAGE,
  STALE_PAGE_MESSAGE,
} from "./thrown-error";

describe("describeThrownError", () => {
  it("asks for a reload when the page predates a deploy", () => {
    // Verbatim from Next 16's client, as it reached a reader in Oct 2026.
    const err = new Error(
      'Server Action "409e95c41b621c014b2f9a19d3e46e322b0f7eb504" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
    );
    expect(describeThrownError(err)).toBe(STALE_PAGE_MESSAGE);
  });

  it("passes any other error's message through", () => {
    expect(describeThrownError(new Error("Network down"))).toBe("Network down");
  });

  it("falls back when what was thrown is not an Error", () => {
    expect(describeThrownError("nope")).toBe("Something went wrong.");
    expect(describeThrownError(undefined, "Oops")).toBe("Oops");
  });
});

describe("isSignedOutError", () => {
  it("recognises the proxy's signed-out answer", () => {
    expect(isSignedOutError(new Error(SIGNED_OUT_MESSAGE))).toBe(true);
    expect(describeThrownError(new Error(SIGNED_OUT_MESSAGE))).toBe(
      SIGNED_OUT_MESSAGE,
    );
  });

  it("ignores anything else", () => {
    expect(isSignedOutError(new Error("Network down"))).toBe(false);
    expect(isSignedOutError(SIGNED_OUT_MESSAGE)).toBe(false);
  });
});

describe("describeThrownError, for a dropped connection", () => {
  it.each([
    "Load failed", // Safari
    "Failed to fetch", // Chrome
    "NetworkError when attempting to fetch resource.", // Firefox
  ])("translates the browser's %s", (message) => {
    expect(describeThrownError(new TypeError(message))).toBe(NETWORK_MESSAGE);
  });

  it("leaves a TypeError that is a bug, not the network, alone", () => {
    expect(describeThrownError(new TypeError("x is not a function"))).toBe(
      "x is not a function",
    );
  });
});

describe("settleAction", () => {
  it("passes a returned result through", async () => {
    await expect(
      settleAction(async () => ({ success: true as const, data: 3 })),
    ).resolves.toEqual({ success: true, data: 3 });
  });

  it("turns a throw into a failed result instead of a rejection", async () => {
    const result = await settleAction(async () => {
      throw new Error(SIGNED_OUT_MESSAGE);
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toBe(SIGNED_OUT_MESSAGE);
  });

  it("describes a dropped connection", async () => {
    const result = await settleAction(async () => {
      throw new TypeError("Load failed");
    });
    expect(!result.success && result.error).toBe(NETWORK_MESSAGE);
  });
});
