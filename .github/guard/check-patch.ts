/**
 * Reads `git diff --numstat -z` on stdin and exits non-zero if the change
 * breaks the agent's rules. Used by the factory workflows before anything
 * the agent wrote is committed.
 *
 *   --allow-new-tests   the change may add new test files
 *   --added <file>      a file holding `git diff --name-only -z
 *                       --diff-filter=A`: the paths the change creates
 */
import { readFileSync } from "node:fs";
import { checkPatch, parsePathList, type PatchOptions } from "./patch.ts";

const options: PatchOptions = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--allow-new-tests") {
    options.allowNewTests = true;
  } else if (args[i] === "--added" && args[i + 1] !== undefined) {
    options.added = parsePathList(readFileSync(args[++i], "utf8"));
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const violations = checkPatch(input, options);
  if (violations.length === 0) {
    console.log("Patch is within what the agent may change.");
    return;
  }
  console.error("Patch refused:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
});
