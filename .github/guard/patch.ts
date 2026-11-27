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

/** The rule violations in a patch, given its numstat. Empty means allowed. */
export function checkPatch(numstat: string): string[] {
  let files: ChangedFile[];
  try {
    files = parseNumstat(numstat);
  } catch (err) {
    return [(err as Error).message];
  }
  if (files.length === 0) return ["The patch changes nothing"];

  // Always the agent's rules, whoever opened the pull request: the agent may
  // not touch dependency files even on a bump.
  return evaluate({
    author: { login: "factory-agent", type: "Bot" },
    files,
  }).violations;
}
