import { describe, expect, it } from "vitest";
import { issueNumberFromBranch } from "../../.github/guard/issue";

describe("issueNumberFromBranch", () => {
  it("reads the issue number from a factory branch", () => {
    expect(issueNumberFromBranch("factory/issue-42")).toBe(42);
  });

  it.each([
    "factory/issue-",
    "factory/issue-0",
    "factory/issue-042",
    "factory/issue-42-extra",
    "factory/issue-42/x",
    "x/factory/issue-42",
    "dependabot/npm_and_yarn/factory/issue-42",
    "factory/issue-4 2",
    "factory/issue-42\n",
    "factory/issue-12345678901",
    "main",
  ])("does not treat %j as a factory branch", (branch) => {
    expect(issueNumberFromBranch(branch)).toBeNull();
  });
});
