/**
 * Checks a patch the factory agent produced before anything is committed.
 *
 * Guard (run.ts) judges a pull request after the push. This applies the same
 * rules one step earlier, so a change the agent should not make never reaches
 * the branch. Pure functions; check-patch.ts is the command-line wrapper.
 */
import { evaluate, type ChangedFile } from "./policy.ts";

/**
 * Parse `git diff --numstat -z`: one "<added>\t<deleted>\t<path>\0" per file.
 * The -z form is required: without it git quotes unusual paths, and the
 * rules would be matching against the quoted text.
 */
export function parseNumstat(text: string): ChangedFile[] {
  return text
    .split("\0")
    .filter((record) => record !== "")
    .map((record) => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) throw new Error("Unrecognised numstat record");
      const [, added, deleted, filename] = match;
      // No real source file has one, and the name is about to be printed in
      // a log where a line break could start a command to the runner. The
      // message deliberately does not repeat the name.
      if (/[\x00-\x1f\x7f]/.test(filename)) {
        throw new Error("A file name contains a control character");
      }
      if (added === "-" || deleted === "-") {
        throw new Error(`${filename}: binary files are not allowed`);
      }
      return {
        filename,
        status: "modified",
        additions: Number(added),
        deletions: Number(deleted),
      };
    });
}

export interface PatchOptions {
  /** Let the change add new test files (policy.ts, allowNewTests). */
  allowNewTests?: boolean;
  /**
   * Paths the change creates, from `git diff --name-only --diff-filter=A`.
   * Numstat alone cannot tell a new file from an edited one.
   */
  added?: string[];
}

/** Parse a NUL-separated path list, as `git diff --name-only -z` prints it. */
export function parsePathList(text: string): string[] {
  return text.split("\0").filter((path) => path !== "");
}

/** The rule violations in a change, given its numstat. Empty means allowed. */
export function checkPatch(numstat: string, options: PatchOptions = {}): string[] {
  let files: ChangedFile[];
  try {
    files = parseNumstat(numstat);
  } catch (err) {
    return [(err as Error).message];
  }
  if (files.length === 0) return ["The patch changes nothing"];
  const added = new Set(options.added ?? []);
  files = files.map((file) =>
    added.has(file.filename) ? { ...file, status: "added" } : file,
  );

  // Always the agent's rules, whoever opened the pull request: the agent may
  // not touch dependency files even on a bump.
  return evaluate({
    author: { login: "factory-agent", type: "Bot" },
    files,
    allowNewTests: options.allowNewTests === true,
  }).violations;
}
