import { describe, it, expect } from "vitest";

import { resolveButtonLink, validateAnnouncement } from "./announcement";

const base = "https://haruspex.fyi";

describe("resolveButtonLink", () => {
  it("resolves a path against the app's address", () => {
    expect(resolveButtonLink("/props/suggest", base)).toBe(
      "https://haruspex.fyi/props/suggest",
    );
    expect(resolveButtonLink("/props/suggest", `${base}/`)).toBe(
      "https://haruspex.fyi/props/suggest",
    );
  });

  it("keeps a full https URL", () => {
    expect(resolveButtonLink("https://example.com/x?y=1", base)).toBe(
      "https://example.com/x?y=1",
    );
  });

  it("refuses anything that is not a path or an https URL", () => {
    expect(resolveButtonLink("http://example.com", base)).toBeNull();
    expect(resolveButtonLink("javascript:alert(1)", base)).toBeNull();
    expect(resolveButtonLink("//evil.example.com", base)).toBeNull();
    expect(resolveButtonLink("props/suggest", base)).toBeNull();
  });
});

describe("validateAnnouncement", () => {
  const valid = { subject: " Ideas for 2027 ", body: " Send us props. " };

  it("trims and accepts an announcement with no button", () => {
    expect(validateAnnouncement(valid, base)).toEqual({
      ok: true,
      announcement: { subject: "Ideas for 2027", body: "Send us props." },
    });
  });

  it("treats a blank label and link as no button", () => {
    const result = validateAnnouncement(
      { ...valid, buttonLabel: "  ", buttonLink: "" },
      base,
    );
    expect(result.ok && result.announcement.button).toBeUndefined();
  });

  it("accepts a button with both halves", () => {
    expect(
      validateAnnouncement(
        { ...valid, buttonLabel: "Suggest a prop", buttonLink: "/props/suggest" },
        base,
      ),
    ).toEqual({
      ok: true,
      announcement: {
        subject: "Ideas for 2027",
        body: "Send us props.",
        button: {
          label: "Suggest a prop",
          url: "https://haruspex.fyi/props/suggest",
        },
      },
    });
  });

  it("refuses half a button", () => {
    expect(
      validateAnnouncement({ ...valid, buttonLabel: "Go" }, base).ok,
    ).toBe(false);
    expect(
      validateAnnouncement({ ...valid, buttonLink: "/props/suggest" }, base)
        .ok,
    ).toBe(false);
  });

  it("refuses a link that is not a path or an https URL", () => {
    expect(
      validateAnnouncement(
        { ...valid, buttonLabel: "Go", buttonLink: "http://example.com" },
        base,
      ).ok,
    ).toBe(false);
  });

  it("refuses an empty subject or body", () => {
    expect(validateAnnouncement({ ...valid, subject: "  " }, base).ok).toBe(
      false,
    );
    expect(validateAnnouncement({ ...valid, body: "" }, base).ok).toBe(false);
  });
});
