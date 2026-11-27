import { describe, expect, it } from "vitest";
import {
  issueNumberFromBranch,
  testsAllowed,
  TESTS_LABEL,
  type IssueEvent,
} from "../../.github/guard/issue";

const owner = { login: "eswan18", type: "User" };
const event = (
  kind: string,
  actor: IssueEvent["actor"],
  name = TESTS_LABEL,
): IssueEvent => ({ event: kind, actor, label: { name } });

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

describe("testsAllowed", () => {
  it("is true when the owner applied the label and it is still there", () => {
    expect(testsAllowed([event("labeled", owner)], "eswan18", [TESTS_LABEL])).toBe(true);
  });

  it("is false when the label was never applied", () => {
    expect(testsAllowed([], "eswan18", [])).toBe(false);
    expect(testsAllowed([event("labeled", owner, "factory")], "eswan18", ["factory"])).toBe(false);
  });

  it("is false when the label is no longer on the issue", () => {
    expect(testsAllowed([event("labeled", owner)], "eswan18", ["factory"])).toBe(false);
  });

  it("is false when the label is present but no event explains it", () => {
    expect(testsAllowed([], "eswan18", [TESTS_LABEL])).toBe(false);
  });

  it.each([
    ["someone else", { login: "mallory", type: "User" }],
    ["a bot", { login: "haruspex-factory[bot]", type: "Bot" }],
    ["a workflow", { login: "github-actions[bot]", type: "Bot" }],
    ["a bot using the owner's name", { login: "eswan18", type: "Bot" }],
    ["an account GitHub cannot name", null],
  ])("is false when %s applied it", (_who, actor) => {
    expect(testsAllowed([event("labeled", actor)], "eswan18", [TESTS_LABEL])).toBe(false);
  });

  it("goes by the most recent add or remove", () => {
    const bot = { login: "haruspex-factory[bot]", type: "Bot" };
    // The owner removed it and a bot put it back.
    expect(
      testsAllowed(
        [event("labeled", owner), event("unlabeled", owner), event("labeled", bot)],
        "eswan18",
        [TESTS_LABEL],
      ),
    ).toBe(false);
    // A bot added it, then the owner replaced it.
    expect(
      testsAllowed(
        [event("labeled", bot), event("unlabeled", owner), event("labeled", owner)],
        "eswan18",
        [TESTS_LABEL],
      ),
    ).toBe(true);
  });

  it("ignores events about other labels and other kinds of event", () => {
    expect(
      testsAllowed(
        [
          event("labeled", owner),
          event("unlabeled", owner, "factory"),
          { event: "closed", actor: { login: "mallory", type: "User" } },
        ],
        "eswan18",
        [TESTS_LABEL],
      ),
    ).toBe(true);
  });
});
