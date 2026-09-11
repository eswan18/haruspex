import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbHelpers from "@/lib/db-helpers";
import * as pubsub from "@/lib/pubsub/client";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db-helpers", () => ({
  withRLS: vi.fn(),
}));

vi.mock("@/lib/pubsub/client", () => ({
  publishEvent: vi.fn().mockResolvedValue("msg-mock"),
}));

import { announcePropAdded } from "./prop-added";

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };

/** A transaction whose member query returns `rows`, whatever it is asked. */
function trxReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "selectFrom",
    "innerJoin",
    "select",
    "where",
    "orderBy",
  ]) {
    chain[method] = () => chain;
  }
  chain.execute = vi.fn().mockResolvedValue(rows);
  return chain;
}

function withMembers(rows: unknown[]) {
  vi.mocked(dbHelpers.withRLS).mockImplementation(async (_userId, fn) =>
    fn(trxReturning(rows) as never),
  );
}

const announcement = {
  authorId: 7,
  audience: "members" as const,
  competition: { id: 3, name: "Office Pool" },
  prop: {
    id: 42,
    text: "It snows on the first of December.",
    forecasts_due_date: new Date("2026-11-30T17:00:00Z"),
  },
};

describe("announcePropAdded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_BASE_URL", "https://haruspex.test");
    vi.mocked(pubsub.publishEvent).mockResolvedValue("msg-mock");
  });

  it("publishes one competition.prop_added event per recipient", async () => {
    withMembers([alice, bob]);

    await announcePropAdded(announcement);

    expect(pubsub.publishEvent).toHaveBeenCalledTimes(2);
    const events = vi.mocked(pubsub.publishEvent).mock.calls.map((c) => c[0]);
    // One target each, so a failed send retries only its own recipient.
    expect(events.map((e) => e.notify)).toEqual([[alice], [bob]]);
    for (const event of events) {
      expect(event).toMatchObject({
        event_type: "competition.prop_added",
        source: "haruspex",
        notify_link: "https://haruspex.test/competitions/3/props/42",
        data: {
          competition_id: 3,
          competition_name: "Office Pool",
          prop_id: 42,
          prop_text: "It snows on the first of December.",
          forecasts_due_date: "2026-11-30T17:00:00.000Z",
        },
      });
    }
  });

  it("gives every event from one prop the same correlation id", async () => {
    withMembers([alice, bob]);

    await announcePropAdded(announcement);

    const ids = vi
      .mocked(pubsub.publishEvent)
      .mock.calls.map((c) => c[0].correlation_id);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
  });

  it("resolves the audience as the author, under RLS", async () => {
    withMembers([alice]);

    await announcePropAdded(announcement);

    expect(dbHelpers.withRLS).toHaveBeenCalledWith(7, expect.any(Function));
  });

  it("publishes nothing when there is nobody to tell", async () => {
    withMembers([]);

    await announcePropAdded(announcement);

    expect(pubsub.publishEvent).not.toHaveBeenCalled();
  });

  it("sends a null deadline through as null", async () => {
    withMembers([alice]);

    await announcePropAdded({
      ...announcement,
      prop: { ...announcement.prop, forecasts_due_date: null },
    });

    expect(vi.mocked(pubsub.publishEvent).mock.calls[0]![0].data).toMatchObject(
      { forecasts_due_date: null },
    );
  });

  it("still tells the others when one publish fails, and does not throw", async () => {
    withMembers([alice, bob]);
    vi.mocked(pubsub.publishEvent)
      .mockRejectedValueOnce(new Error("topic gone"))
      .mockResolvedValueOnce("msg-2");

    await expect(announcePropAdded(announcement)).resolves.toBeUndefined();
    expect(pubsub.publishEvent).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the audience cannot be resolved", async () => {
    vi.mocked(dbHelpers.withRLS).mockRejectedValue(new Error("db down"));

    await expect(announcePropAdded(announcement)).resolves.toBeUndefined();
    expect(pubsub.publishEvent).not.toHaveBeenCalled();
  });
});
