import { describe, expect, it } from "vitest";

import { describeThrownError, STALE_PAGE_MESSAGE } from "./thrown-error";

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
