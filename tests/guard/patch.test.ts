import { describe, expect, it } from "vitest";
import { LIMITS } from "../../.github/guard/policy";
import { checkPatch, parseNumstat, parsePathList } from "../../.github/guard/patch";

// `git diff --numstat -z` output: "<added>\t<deleted>\t<path>\0" per file.
const numstat = (...rows: [string, string, string][]) =>
  rows.map(([a, d, p]) => `${a}\t${d}\t${p}\0`).join("");

describe("parseNumstat", () => {
  it("reads one entry per file", () => {
    expect(
      parseNumstat(numstat(["3", "1", "lib/a.ts"], ["0", "7", "app/b.tsx"])),
    ).toEqual([
      { filename: "lib/a.ts", status: "modified", additions: 3, deletions: 1 },
      { filename: "app/b.tsx", status: "modified", additions: 0, deletions: 7 },
    ]);
  });

  it("keeps spaces and quotes in a path intact", () => {
    const [entry] = parseNumstat(numstat(["1", "1", 'lib/a b "c".ts']));
    expect(entry.filename).toBe('lib/a b "c".ts');
  });

  it.each(["\n", "\r", "\t", "\x1b", "\x7f"])(
    "rejects a path containing %j without repeating it",
    (char) => {
      const path = `lib/a${char}::error::x.ts`;
      expect(() => parseNumstat(numstat(["1", "1", path]))).toThrow(
        /control character/,
      );
      expect(checkPatch(numstat(["1", "1", path]))).toEqual([
        "A file name contains a control character",
      ]);
    },
  );

  it("returns nothing for an empty diff", () => {
    expect(parseNumstat("")).toEqual([]);
  });

  it("rejects a binary file, which has no line counts", () => {
    expect(() => parseNumstat(numstat(["-", "-", "lib/blob.bin"]))).toThrow(
      /binary/,
    );
  });

  it("rejects output it does not understand", () => {
    expect(() => parseNumstat("garbage\0")).toThrow();
    expect(() => parseNumstat("1\t2\t\0")).toThrow();
  });
});

describe("checkPatch", () => {
  it("accepts a small change to application source", () => {
    expect(checkPatch(numstat(["3", "1", "lib/a.ts"]))).toEqual([]);
  });

  it.each([
    "package.json",
    "package-lock.json",
    "lib/a.test.ts",
    ".github/workflows/pr-checks.yml",
    ".claude/settings.json",
    "CLAUDE.md",
    "components/prop-list/fixtures.ts",
    ".factory/ci-failure.log",
  ])("rejects a change to %s", (path) => {
    expect(checkPatch(numstat(["1", "1", path]))).toHaveLength(1);
  });

  it("rejects an empty patch", () => {
    expect(checkPatch("")).toEqual(["The patch changes nothing"]);
  });

  it("rejects a patch over the size cap", () => {
    const violations = checkPatch(
      numstat([String(LIMITS.maxLines + 1), "0", "lib/a.ts"]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/lines/);
  });

  it("reports unreadable input as a violation instead of throwing", () => {
    expect(checkPatch("garbage\0")).toHaveLength(1);
  });
});

describe("checkPatch with new tests allowed", () => {
  const allow = { allowNewTests: true };

  it("accepts a new test file beside the code", () => {
    expect(
      checkPatch(numstat(["3", "1", "lib/a.ts"], ["20", "0", "lib/a.test.ts"]), {
        ...allow,
        added: ["lib/a.test.ts"],
      }),
    ).toEqual([]);
  });

  it("still rejects a change to a test that already exists", () => {
    expect(checkPatch(numstat(["1", "1", "lib/a.test.ts"]), allow)).toHaveLength(1);
    expect(
      checkPatch(numstat(["0", "9", "lib/a.test.ts"]), { ...allow, added: [] }),
    ).toHaveLength(1);
  });

  it("rejects a new test file unless tests are allowed", () => {
    expect(
      checkPatch(numstat(["20", "0", "lib/a.test.ts"]), { added: ["lib/a.test.ts"] }),
    ).toHaveLength(1);
  });

  it("matches added paths exactly", () => {
    expect(
      checkPatch(numstat(["1", "1", "lib/a.test.ts"]), {
        ...allow,
        added: ["lib/a.test.ts "],
      }),
    ).toHaveLength(1);
  });
});

describe("parsePathList", () => {
  it("splits on NUL and keeps odd characters", () => {
    expect(parsePathList("lib/a.ts\0lib/b c\n.ts\0")).toEqual(["lib/a.ts", "lib/b c\n.ts"]);
    expect(parsePathList("")).toEqual([]);
  });
});
