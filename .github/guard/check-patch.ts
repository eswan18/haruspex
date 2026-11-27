/**
 * Reads `git diff --numstat -z` on stdin and exits non-zero if the change
 * breaks the agent's rules. Used by .github/workflows/bump-fix.yml.
 */
import { checkPatch } from "./patch.ts";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const violations = checkPatch(input);
  if (violations.length === 0) {
    console.log("Patch is within what the agent may change.");
    return;
  }
  console.error("Patch refused:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
});
