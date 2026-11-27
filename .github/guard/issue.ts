/**
 * How an issue hands work to the factory agent, and what it permits.
 *
 * Two labels, both of which count only when the repository's owner applied
 * them: FACTORY_LABEL starts the agent on an issue, and TESTS_LABEL lets the
 * pull request it opens add new test files. The agent's branch is named after
 * the issue, which is how Guard finds the issue again from the pull request.
 *
 * Pure functions here; fetchTestsAllowed at the bottom is the only I/O.
 */
import type { Author } from "./policy.ts";

export const FACTORY_LABEL = "factory";
export const TESTS_LABEL = "factory-tests";
export const BRANCH_PREFIX = "factory/issue-";

/** The issue a factory branch was cut for, or null if it is not one. */
export function issueNumberFromBranch(branch: string): number | null {
  const match = /^factory\/issue-([1-9]\d{0,8})$/.exec(branch);
  return match ? Number(match[1]) : null;
}

/** One entry from GitHub's "list issue events" API; only what is used. */
export interface IssueEvent {
  event: string;
  actor: Author | null;
  label?: { name: string };
}

/**
 * Whether the owner's own hand put TESTS_LABEL on the issue. Decided by the
 * last time the label was added or removed: it must be an add, by the owner,
 * from a person's account. A label a bot or a workflow applied does not count,
 * so nothing the factory runs can grant itself this.
 */
export function testsAllowed(
  events: IssueEvent[],
  owner: string,
  currentLabels: string[],
): boolean {
  if (!currentLabels.includes(TESTS_LABEL)) return false;
  const last = events
    .filter(
      (event) =>
        (event.event === "labeled" || event.event === "unlabeled") &&
        event.label?.name === TESTS_LABEL,
    )
    .at(-1);
  return (
    last !== undefined &&
    last.event === "labeled" &&
    last.actor !== null &&
    last.actor.type === "User" &&
    last.actor.login === owner
  );
}

const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/**
 * Ask GitHub. Any doubt is a no: an unreadable issue, or more events than
 * were read, means tests are not allowed.
 */
export async function fetchTestsAllowed(
  token: string,
  repo: string,
  issue: number,
): Promise<boolean> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo is malformed");
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "haruspex-guard",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  };

  const { labels, pull_request } = await get<{
    labels: { name: string }[];
    pull_request?: unknown;
  }>(`/repos/${repo}/issues/${issue}`);
  // A pull request has an issue number too; it is not a task.
  if (pull_request) return false;

  const events: IssueEvent[] = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) return false;
    const batch = await get<IssueEvent[]>(
      `/repos/${repo}/issues/${issue}/events?per_page=${PAGE_SIZE}&page=${page}`,
    );
    events.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return testsAllowed(
    events,
    repo.split("/")[0],
    labels.map((label) => label.name),
  );
}
