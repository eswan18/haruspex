import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbHelpers from "@/lib/db-helpers";
import * as preferences from "@/lib/notifications/preferences";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db-helpers", () => ({
  withRLS: vi.fn(),
}));

vi.mock("@/lib/notifications/preferences", () => ({
  setPreference: vi.fn(),
}));

import { signUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

import { POST } from "./route";

const TYPE = "competition.prop_added";

function url(token: string) {
  return `https://haruspex.test/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** What a mail client's one-click unsubscribe sends: RFC 8058's fixed body. */
function oneClick(token: string) {
  return new Request(url(token), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
}

/** What the confirm page's form sends. */
function formPost(token: string, enabled: boolean) {
  return new Request(url(token), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,application/xhtml+xml",
    },
    body: `enabled=${enabled}`,
  });
}

describe("POST /api/unsubscribe", () => {
  let token: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
    vi.mocked(dbHelpers.withRLS).mockImplementation(async (_userId, fn) =>
      fn({} as never),
    );
    token = signUnsubscribeToken(7, TYPE);
  });

  it("turns the notification off for a mail client's one click", async () => {
    const response = await POST(oneClick(token));

    expect(response.status).toBe(200);
    expect(preferences.setPreference).toHaveBeenCalledWith(
      expect.anything(),
      7,
      TYPE,
      false,
    );
    // As that reader, so the row passes its own write policy.
    expect(dbHelpers.withRLS).toHaveBeenCalledWith(7, expect.any(Function));
  });

  it("sends a browser back to the page, which says what happened", async () => {
    const response = await POST(formPost(token, false));

    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain("/unsubscribe?");
    expect(location).toContain("done=off");
  });

  it("turns it back on when the reader presses undo", async () => {
    const response = await POST(formPost(token, true));

    expect(preferences.setPreference).toHaveBeenCalledWith(
      expect.anything(),
      7,
      TYPE,
      true,
    );
    expect(response.headers.get("location")).toContain("done=on");
  });

  it("refuses a token that proves nothing, and writes nothing", async () => {
    const response = await POST(oneClick("7:competition.prop_added:deadbeef"));

    expect(response.status).toBe(400);
    expect(preferences.setPreference).not.toHaveBeenCalled();
  });

  it("refuses a missing token", async () => {
    const response = await POST(
      new Request("https://haruspex.test/api/unsubscribe", { method: "POST" }),
    );

    expect(response.status).toBe(400);
    expect(preferences.setPreference).not.toHaveBeenCalled();
  });

  it("refuses a well-signed token for mail that cannot be turned off", async () => {
    const response = await POST(
      oneClick(signUnsubscribeToken(7, "admin.manual_email" as never)),
    );

    expect(response.status).toBe(400);
    expect(preferences.setPreference).not.toHaveBeenCalled();
  });

  it("says so plainly when the write fails", async () => {
    vi.mocked(dbHelpers.withRLS).mockRejectedValue(new Error("db down"));

    const response = await POST(oneClick(token));

    // A mail client retries a 500; it must not be told the unsubscribe stuck.
    expect(response.status).toBe(500);
  });
});
