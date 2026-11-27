/**
 * How an issue hands work to the factory agent.
 *
 * The owner labels an issue FACTORY_LABEL; the agent's branch is named after
 * the issue. Only the factory's push job creates such a branch, and Guard
 * recognises the agent's pull requests by it.
 */

export const FACTORY_LABEL = "factory";
export const BRANCH_PREFIX = "factory/issue-";

/** The issue a factory branch was cut for, or null if it is not one. */
export function issueNumberFromBranch(branch: string): number | null {
  const match = /^factory\/issue-([1-9]\d{0,8})$/.exec(branch);
  return match ? Number(match[1]) : null;
}
