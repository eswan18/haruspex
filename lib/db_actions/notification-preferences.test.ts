import { describe, it, expect, vi, beforeEach } from "vitest";
import * as getUser from "@/lib/get-user";
import * as dbHelpers from "@/lib/db-helpers";
import * as preferences from "@/lib/notifications/preferences";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

vi.mock("@/lib/db-helpers", () => ({
  withRLS: vi.fn(),
}));

vi.mock("@/lib/notifications/preferences", () => ({
  getEffectivePreferences: vi.fn(),
  setPreference: vi.fn(),
}));

import {
  getNotificationPreferences,
  setNotificationPreference,
} from "./notification-preferences";

const reader = {
  id: 7,
  name: "Reader",
  email: "reader@example.com",
  is_admin: false,
};

describe("notification preference actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dbHelpers.withRLS).mockImplementation(async (_userId, fn) =>
      fn({} as never),
    );
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(reader as never);
  });

  describe("getNotificationPreferences", () => {
    it("returns the reader's effective preferences", async () => {
      vi.mocked(preferences.getEffectivePreferences).mockResolvedValue({
        "competition.member_added": true,
        "competition.prop_added": false,
      });

      const result = await getNotificationPreferences();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          "competition.member_added": true,
          "competition.prop_added": false,
        });
      }
      expect(dbHelpers.withRLS).toHaveBeenCalledWith(7, expect.any(Function));
    });

    it("refuses a reader who is not signed in", async () => {
      vi.mocked(getUser.getUserFromCookies).mockResolvedValue(null);

      const result = await getNotificationPreferences();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("UNAUTHORIZED");
      expect(preferences.getEffectivePreferences).not.toHaveBeenCalled();
    });
  });

  describe("setNotificationPreference", () => {
    it("records the reader's choice", async () => {
      const result = await setNotificationPreference({
        type: "competition.prop_added",
        enabled: false,
      });

      expect(result.success).toBe(true);
      expect(preferences.setPreference).toHaveBeenCalledWith(
        expect.anything(),
        7,
        "competition.prop_added",
        false,
      );
    });

    it("refuses a reader who is not signed in", async () => {
      vi.mocked(getUser.getUserFromCookies).mockResolvedValue(null);

      const result = await setNotificationPreference({
        type: "competition.prop_added",
        enabled: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("UNAUTHORIZED");
      expect(preferences.setPreference).not.toHaveBeenCalled();
    });

    it("refuses mail that is always sent", async () => {
      const result = await setNotificationPreference({
        // Not an OptionalNotificationType: reachable only by calling the
        // action directly, which a server action always is.
        type: "admin.manual_email" as never,
        enabled: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("VALIDATION_ERROR");
      expect(preferences.setPreference).not.toHaveBeenCalled();
    });

    it("refuses a type it does not know", async () => {
      const result = await setNotificationPreference({
        type: "competition.prop_removed" as never,
        enabled: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe("VALIDATION_ERROR");
      expect(preferences.setPreference).not.toHaveBeenCalled();
    });
  });
});
