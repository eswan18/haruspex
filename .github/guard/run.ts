/**
 * Entry point for the Guard check: fetch a pull request's facts from the
 * GitHub API, apply the rules in policy.ts, and exit non-zero on a violation.
 *
 * It reads the PR as data. It must never check out, import or execute anything
 * from the PR, because it runs with the base repository's workflow token.
 */
import { appendFileSync } from "node:fs";
import {
  evaluate,
  type Author,
  type ChangedFile,
  type GuardInput,
} from "./policy.ts";
import { fetchTestsAllowed, issueNumberFromBranch } from "./issue.ts";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
// GitHub lists at most 3000 files for a pull request.
const MAX_PAGES = 30;
// ...and at most 250 commits.
const MAX_COMMITS = 250;

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
  head: { sha: string; ref: string; repo: { full_name: string } | null };
}

/**
 * An agent's PR may add tests when it is on a factory branch in this
 * repository and the owner labelled that branch's issue to say so. Anything
 * that goes wrong while asking leaves the answer at no.
 */
async function newTestsAllowed(pr: PullRequest): Promise<boolean> {
  if (pr.head.repo?.full_name !== repo) return false;
  const issue = issueNumberFromBranch(pr.head.ref);
  if (issue === null) return false;
  try {
    return await fetchTestsAllowed(token, repo, issue);
  } catch (err) {
    console.log(`Could not read issue #${issue}: ${(err as Error).message}`);
    return false;
  }
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

interface PullRequestCommit {
  author: Author | null;
  committer: Author | null;
}

/**
 * Each commit's author and committer, plus whoever triggered this run. The
 * commit identities come from the commit's email, which its writer chooses;
 * the sender is recorded by GitHub and cannot be chosen.
 */
async function listContributors(): Promise<(Author | null)[]> {
  const contributors: (Author | null)[] = [];
  let count = 0;
  for (let page = 1; page <= Math.ceil(MAX_COMMITS / PAGE_SIZE); page++) {
    const batch = await getJson<PullRequestCommit[]>(
      `/repos/${repo}/pulls/${prNumber}/commits?per_page=${PAGE_SIZE}&page=${page}`,
    );
    for (const commit of batch) {
      contributors.push(commit.author, commit.committer);
    }
    count += batch.length;
    if (batch.length < PAGE_SIZE) break;
  }
  // At the cap there may be commits we were not shown.
  if (count >= MAX_COMMITS) contributors.push(null);

  const senderLogin = process.env.GUARD_SENDER_LOGIN;
  const senderType = process.env.GUARD_SENDER_TYPE;
  if (senderLogin && senderType) {
    contributors.push({ login: senderLogin, type: senderType });
  }

  return contributors.map((contributor) =>
    contributor ? { login: contributor.login, type: contributor.type } : null,
  );
}

async function fileAt(fullName: string, sha: string, path: string) {
  const response = await github(
    `/repos/${fullName}/contents/${path}?ref=${sha}`,
    "application/vnd.github.raw+json",
  );
  return response.text();
}

function report(lines: string[]): void {
  // File names and logins come from the pull request. With control
  // characters replaced, none of them can start a line of its own, which is
  // where the runner looks for commands.
  const text = lines
    .map((line) => line.replace(/[\x00-\x1f\x7f]/g, "?"))
    .join("\n");
  console.log(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${text}\n`);
}

async function main(): Promise<number> {
  const pr = await getJson<PullRequest>(`/repos/${repo}/pulls/${prNumber}`);
  const author = { login: pr.user.login, type: pr.user.type };
  const contributors = await listContributors();

  const files = await listFiles();
  const input: GuardInput = {
    author,
    contributors,
    files,
    truncated: files.length !== pr.changed_files,
    allowNewTests: await newTestsAllowed(pr),
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
  if (kind === "human") {
    report([
      `Guard: opened by ${author.login}, and every commit is a person's. Nothing to check.`,
    ]);
    return 0;
  }

  const others = [
    ...new Set(
      contributors
        .filter((contributor) => contributor?.type !== "User")
        .map((contributor) => contributor?.login ?? "an unidentified account"),
    ),
  ].filter((login) => login !== author.login);
  if (others.length > 0) {
    report([`Guard: also worked on by ${others.join(", ")}.`]);
  }

  if (input.allowNewTests && kind === "agent") {
    report(["Guard: the owner labelled the issue to allow new test files."]);
  }

  if (violations.length === 0) {
    report([
      `Guard: passed. ${files.length} file(s) changed by ${author.login} (${kind}), all within what a bot may change.`,
    ]);
    return 0;
  }

  report([
    `Guard: failed. This pull request was opened by ${author.login} and is held to the ${kind} rules. It breaks ${violations.length} rule(s):`,
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
