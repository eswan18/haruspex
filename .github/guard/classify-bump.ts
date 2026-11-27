/**
 * Usage: node classify-bump.ts <base package.json> <head package.json>
 *                              <base lockfile> <head lockfile>
 *
 * Prints the verdict as JSON. Exits 0 when the bump is minor/patch only, 1
 * when it is not, 2 when it could not be judged. Used by bump-fix.yml.
 */
import { readFileSync } from "node:fs";
import { classifyBump } from "./bump.ts";

const paths = process.argv.slice(2);
if (paths.length !== 4) {
  console.error("Expected four file paths.");
  process.exit(2);
}

let verdict;
try {
  const [basePackageJson, headPackageJson, baseLock, headLock] = paths.map(
    (path) => readFileSync(path, "utf8"),
  );
  verdict = classifyBump({ basePackageJson, headPackageJson, baseLock, headLock });
} catch (err) {
  console.error(`Could not read the files: ${(err as Error).message}`);
  process.exit(2);
}

console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.eligible ? 0 : 1);
