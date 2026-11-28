/**
 * Asks whether a pull request must be read before the factory merges it
 * (sensitive.ts). Reads the pull request through the GitHub API as data;
 * nothing from it is checked out or run.
 *
 * Env: GITHUB_TOKEN, GUARD_REPO, GUARD_PR_NUMBER, and GUARD_HEAD_SHA: the
 * commit the caller is about to merge. If the pull request has moved on from
 * it, what would be read here is not what would be merged, and the answer is
 * "could not tell".
 * Prints a JSON array of reasons. Exit 0: none, it may merge. Exit 1: some.
 * Exit 2: could not tell, which the caller must treat as "some".
 */
import { reviewReasons, type ChangedSource } from "./sensitive.ts";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GUARD_REPO ?? "";
const prNumber = process.env.GUARD_PR_NUMBER ?? "";
const headSha = process.env.GUARD_HEAD_SHA ?? "";

async function github(path: string, accept: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "haruspex-guard",
    },
  });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await github(path, "application/vnd.github+json");
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return (await response.json()) as T;
}

/** A file's text at a commit; null if it does not exist there. */
async function textAt(sha: string, path: string): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await github(
    `/repos/${repo}/contents/${encoded}?ref=${sha}`,
    "application/vnd.github.raw+json",
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} reading a changed file`);
  }
  return response.text();
}

interface PullRequest {
  changed_files: number;
  base: { sha: string };
  head: { sha: string };
}

interface PullRequestFile {
  filename: string;
  previous_filename?: string;
}

async function main(): Promise<number> {
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GUARD_REPO is malformed");
  if (!/^[1-9]\d*$/.test(prNumber)) throw new Error("GUARD_PR_NUMBER is malformed");

  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error("GUARD_HEAD_SHA is malformed");

  const pr = await getJson<PullRequest>(`/repos/${repo}/pulls/${prNumber}`);
  if (pr.head.sha !== headSha) {
    throw new Error("the pull request has moved on from the commit being merged");
  }
  const listed: PullRequestFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getJson<PullRequestFile[]>(
      `/repos/${repo}/pulls/${prNumber}/files?per_page=${PAGE_SIZE}&page=${page}`,
    );
    listed.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  if (listed.length !== pr.changed_files) {
    throw new Error("the list of changed files may not be complete");
  }
  // The list was fetched after the pull request itself. Look again, so a
  // push in between cannot leave it describing a different commit.
  const after = await getJson<PullRequest>(`/repos/${repo}/pulls/${prNumber}`);
  if (after.head.sha !== headSha) {
    throw new Error("the pull request moved while it was being read");
  }

  const files: ChangedSource[] = [];
  for (const file of listed) {
    files.push({
      path: file.filename,
      previousPath: file.previous_filename,
      // A renamed file's earlier text is under its earlier name.
      base: await textAt(pr.base.sha, file.previous_filename ?? file.filename),
      head: await textAt(headSha, file.filename),
    });
  }

  const reasons = reviewReasons(files);
  console.log(JSON.stringify(reasons));
  return reasons.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Could not tell: ${(err as Error).message}`);
    process.exit(2);
  },
);
