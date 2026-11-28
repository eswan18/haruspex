/**
 * Reads a JSON array of changed paths on stdin and prints, as JSON, those
 * that are sensitive (sensitive.ts). Exit 0: none. Exit 1: some. Exit 2: the
 * input could not be read, which the caller must treat as "some".
 */
import { sensitiveAmong } from "./sensitive.ts";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let paths: unknown;
  try {
    paths = JSON.parse(input);
  } catch {
    paths = null;
  }
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    console.error("Expected a JSON array of paths");
    process.exit(2);
  }
  const found = sensitiveAmong(paths as string[]);
  console.log(JSON.stringify(found));
  process.exit(found.length === 0 ? 0 : 1);
});
