/**
 * Prints "true" or "false": may the agent working on this issue add tests?
 * Env: GITHUB_TOKEN, GUARD_REPO, GUARD_ISSUE_NUMBER. Any failure prints
 * "false" and says why on stderr.
 */
import { fetchTestsAllowed } from "./issue.ts";

const { GITHUB_TOKEN, GUARD_REPO, GUARD_ISSUE_NUMBER } = process.env;
try {
  if (!GITHUB_TOKEN || !GUARD_REPO || !/^[1-9]\d*$/.test(GUARD_ISSUE_NUMBER ?? "")) {
    throw new Error("GITHUB_TOKEN, GUARD_REPO or GUARD_ISSUE_NUMBER is missing");
  }
  const allowed = await fetchTestsAllowed(
    GITHUB_TOKEN,
    GUARD_REPO,
    Number(GUARD_ISSUE_NUMBER),
  );
  console.log(allowed ? "true" : "false");
} catch (err) {
  console.error(`Could not tell; treating as no: ${(err as Error).message}`);
  console.log("false");
}
