import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbHelpers from "@/lib/db-helpers";
import * as getUser from "@/lib/get-user";
import * as pubsub from "@/lib/pubsub/client";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/get-user", () => ({
  getUserFromCookies: vi.fn(),
}));

vi.mock("@/lib/db-helpers", () => ({
  withRLS: vi.fn(),
}));

vi.mock("@/lib/pubsub/client", () => ({
  publishEvent: vi.fn().mockResolvedValue("msg-mock"),
}));

import {
  getAnnouncementAudienceSize,
  sendAnnouncement,
} from "./admin-announcement";

const admin = {
  id: 2,
  name: "Admin",
  email: "admin@example.com",
  is_admin: true,
};
const nonAdmin = { id: 1, name: "User", email: "u@example.com", is_admin: false };
const alice = { id: 11, email: "alice@example.com", name: "Alice" };
const bob = { id: 12, email: "bob@example.com", name: "Bob" };

/** A transaction whose user query returns `rows`, whatever it is asked. */
function withAudience(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["selectFrom", "select", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain.execute = vi.fn().mockResolvedValue(rows);
  vi.mocked(dbHelpers.withRLS).mockImplementation(async (_userId, fn) =>
    fn(chain as never),
  );
}

const valid = {
  subject: "Ideas for 2027",
  body: "Send us your props.",
  test: false,
};

describe("sendAnnouncement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.mocked(pubsub.publishEvent).mockResolvedValue("msg-mock");
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(admin as never);
    withAudience([alice, bob]);
  });

  it("publishes one event per recipient, sharing a correlation id", async () => {
    const result = await sendAnnouncement(valid);

    expect(result).toEqual({ success: true, data: { queued: 2, failed: 0 } });
    const events = vi.mocked(pubsub.publishEvent).mock.calls.map((c) => c[0]);
    expect(events.map((e) => e.notify)).toEqual([
      [
        expect.objectContaining({
          email: "alice@example.com",
          name: "Alice",
          unsubscribe_url: expect.stringContaining(
            "https://haruspex.test/unsubscribe?t=11%3Aadmin.announcement%3A",
          ),
          unsubscribe_post_url: expect.stringContaining(
            "https://haruspex.test/api/unsubscribe?t=11%3Aadmin.announcement%3A",
          ),
        }),
      ],
      [expect.objectContaining({ email: "bob@example.com" })],
    ]);
    expect(events[0]!.correlation_id).toBeDefined();
    expect(events[0]!.correlation_id).toBe(events[1]!.correlation_id);
    expect(events[0]).toEqual(
      expect.objectContaining({
        event_type: "admin.announcement",
        source: "haruspex",
        manage_link: "https://haruspex.test/account",
        notify_link: undefined,
        data: {
          subject: "Ideas for 2027",
          body: "Send us your props.",
          button_label: undefined,
        },
      }),
    );
  });

  it("carries the button as notify_link and button_label", async () => {
    await sendAnnouncement({
      ...valid,
      buttonLabel: "Suggest a prop",
      buttonLink: "/props/suggest",
    });

    const event = vi.mocked(pubsub.publishEvent).mock.calls[0]![0];
    expect(event.notify_link).toBe("https://haruspex.test/props/suggest");
    expect(event.data.button_label).toBe("Suggest a prop");
  });

  it("sends a test copy to the admin alone, without reading the audience", async () => {
    const result = await sendAnnouncement({ ...valid, test: true });

    expect(result).toEqual({ success: true, data: { queued: 1, failed: 0 } });
    expect(dbHelpers.withRLS).not.toHaveBeenCalled();
    expect(pubsub.publishEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(pubsub.publishEvent).mock.calls[0]![0].notify).toEqual([
      expect.objectContaining({ email: "admin@example.com", name: "Admin" }),
    ]);
  });

  it("counts a failed publish without stopping the rest", async () => {
    vi.mocked(pubsub.publishEvent)
      .mockRejectedValueOnce(new Error("pubsub down"))
      .mockResolvedValueOnce("msg-mock");

    const result = await sendAnnouncement(valid);

    expect(result).toEqual({ success: true, data: { queued: 1, failed: 1 } });
  });

  it("fails when nothing could be queued", async () => {
    vi.mocked(pubsub.publishEvent).mockRejectedValue(new Error("pubsub down"));

    const result = await sendAnnouncement(valid);

    expect(result.success).toBe(false);
  });

  it("refuses an invalid announcement before publishing anything", async () => {
    const result = await sendAnnouncement({ ...valid, buttonLabel: "Go" });

    expect(result.success).toBe(false);
    expect(pubsub.publishEvent).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(null as never);

    const result = await sendAnnouncement(valid);

    expect(result.success).toBe(false);
    expect(pubsub.publishEvent).not.toHaveBeenCalled();
  });

  it("refuses a non-admin, since the layout gate does not cover server actions", async () => {
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(nonAdmin as never);

    const result = await sendAnnouncement(valid);

    expect(result.success).toBe(false);
    expect(pubsub.publishEvent).not.toHaveBeenCalled();
  });
});

describe("getAnnouncementAudienceSize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAudience([alice, bob]);
  });

  it("counts the audience for an admin", async () => {
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(admin as never);

    expect(await getAnnouncementAudienceSize()).toEqual({
      success: true,
      data: 2,
    });
  });

  it("refuses a non-admin", async () => {
    vi.mocked(getUser.getUserFromCookies).mockResolvedValue(nonAdmin as never);

    const result = await getAnnouncementAudienceSize();

    expect(result.success).toBe(false);
    expect(dbHelpers.withRLS).not.toHaveBeenCalled();
  });
});
