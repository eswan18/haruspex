/**
 * Entry point for the Guard check: fetch a pull request's facts from the
 * GitHub API, apply the rules in policy.ts, and exit non-zero on a violation.
 *
 * It reads the PR as data. It must never check out, import or execute anything
 * from the PR, because it runs with the base repository's workflow token.
 */
import { appendFileSync } from "node:fs";
import {
  classifyAuthor,
  evaluate,
  type ChangedFile,
  type GuardInput,
} from "./policy.ts";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
// GitHub lists at most 3000 files for a pull request.
const MAX_PAGES = 30;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const token = requireEnv("GITHUB_TOKEN");
const repo = requireEnv("GUARD_REPO");
const prNumber = requireEnv("GUARD_PR_NUMBER");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GUARD_REPO is malformed");
if (!/^\d+$/.test(prNumber)) throw new Error("GUARD_PR_NUMBER is malformed");

async function github(path: string, accept: string): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "haruspex-guard",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return response;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await github(path, "application/vnd.github+json");
  return (await response.json()) as T;
}

interface PullRequest {
  user: { login: string; type: string };
  changed_files: number;
  base: { sha: string; repo: { full_name: string } };
  head: { sha: string; repo: { full_name: string } | null };
}

async function listFiles(): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getJson<ChangedFile[]>(
      `/repos/${repo}/pulls/${prNumber}/files?per_page=${PAGE_SIZE}&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return files;
}

async function fileAt(fullName: string, sha: string, path: string) {
  const response = await github(
    `/repos/${fullName}/contents/${path}?ref=${sha}`,
    "application/vnd.github.raw+json",
  );
  return response.text();
}

function report(lines: string[]): void {
  const text = lines.join("\n");
  console.log(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${text}\n`);
}

async function main(): Promise<number> {
  const pr = await getJson<PullRequest>(`/repos/${repo}/pulls/${prNumber}`);
  const author = { login: pr.user.login, type: pr.user.type };

  if (classifyAuthor(author) === "human") {
    report([`Guard: opened by ${author.login}, a person. Nothing to check.`]);
    return 0;
  }

  const files = await listFiles();
  const input: GuardInput = {
    author,
    files,
    truncated: files.length !== pr.changed_files,
  };

  if (files.some((file) => file.filename === "package.json")) {
    try {
      input.packageJson = {
        base: await fileAt(pr.base.repo.full_name, pr.base.sha, "package.json"),
        head: await fileAt(
          pr.head.repo?.full_name ?? repo,
          pr.head.sha,
          "package.json",
        ),
      };
    } catch (err) {
      // Leave it unset: the policy fails closed when it cannot compare.
      console.log(`Could not fetch package.json: ${(err as Error).message}`);
    }
  }

  const { kind, violations } = evaluate(input);
  if (violations.length === 0) {
    report([
      `Guard: passed. ${files.length} file(s) changed by ${author.login} (${kind}), all within what a bot may change.`,
    ]);
    return 0;
  }

  report([
    `Guard: failed. This pull request was opened by ${author.login} (${kind}) and breaks ${violations.length} rule(s):`,
    "",
    ...violations.map((violation) => `- ${violation}`),
    "",
    "A person needs to review this change. The rules are in .github/guard/policy.ts.",
  ]);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Any failure to check is a failed check.
    console.error(`Guard could not run: ${(err as Error).message}`);
    process.exit(1);
  },
);
