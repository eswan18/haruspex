import { describe, expect, it } from "vitest";
import { parseSampleRate, sentryEnvironment } from "./sentry-utils";

describe("sentryEnvironment", () => {
  it.each([
    ["https://haruspex.fyi", "production"],
    ["haruspex.fyi", "production"],
    ["https://staging.haruspex.fyi", "staging"],
    ["staging.haruspex.fyi", "staging"],
    ["https://haruspex-staging.tailc06f30.ts.net", "staging"],
    ["https://haruspex.my-branch.preview.footstrike.run", "preview"],
    ["http://localhost:3000", "local"],
    ["localhost", "local"],
    ["http://127.0.0.1:3100", "local"],
    ["http://[::1]:3000", "local"],
    ["http://app.localhost:3000", "local"],
  ])("files %s under %s", (address, expected) => {
    expect(sentryEnvironment(address)).toBe(expected);
  });

  it("is local when the address is unknown or unreadable", () => {
    expect(sentryEnvironment(undefined)).toBe("local");
    expect(sentryEnvironment("")).toBe("local");
    expect(sentryEnvironment("http://")).toBe("local");
  });

  it("counts a hostname it does not recognise as production", () => {
    // A renamed production site must not be filed where no alert looks.
    expect(sentryEnvironment("https://forecasts.example.com")).toBe(
      "production",
    );
    // "staging" has to be a whole label, or end one after a hyphen.
    expect(sentryEnvironment("https://upstaging.example.com")).toBe(
      "production",
    );
  });

  it("ignores case", () => {
    expect(sentryEnvironment("https://STAGING.Haruspex.fyi")).toBe("staging");
  });
});

describe("parseSampleRate", () => {
  it("reads a rate between 0 and 1", () => {
    expect(parseSampleRate("0.25", 1)).toBe(0.25);
    expect(parseSampleRate("0", 1)).toBe(0);
  });

  it("falls back when the value is missing or out of range", () => {
    expect(parseSampleRate(undefined, 0.2)).toBe(0.2);
    expect(parseSampleRate("nope", 0.2)).toBe(0.2);
    expect(parseSampleRate("2", 0.2)).toBe(0.2);
    expect(parseSampleRate("-1", 0.2)).toBe(0.2);
  });
});
