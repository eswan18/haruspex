# Factory step 4: labelled issue to pull request

## Intent

The owner writes an issue, labels it, and gets a pull request written by the
factory agent. This is the step that turns the factory from a dependency bot
into something that takes work. The owner reviews and merges every one;
merging without a person waits for the staging smoke test in step 5.

## Goals

- An issue labelled `factory` by the owner produces a pull request from
  `haruspex-factory`, or a comment on the issue saying why it did not.
- The agent's change is checked against the guard rules before it is
  committed, and again by the required Guard check afterwards.
- Failing checks get up to three repair rounds, then `needs-human`.
- The change may bring new tests, at the agent's judgment.

## Non-goals

- Merging. Nothing in this step merges.
- Schema changes, dependency changes, configuration, documentation. The
  guard allowlist is unchanged except for new tests.
- Reading anyone's comments but the owner's, or acting on issues the owner
  did not write.

## What would make this a failure

- The agent, or anything a workflow runs, can give itself permissions: start
  itself, grant itself tests, or change a check that judges it.
- A change to an existing test reaches a pull request under the agent's name.
- A person who is not the owner can put words in front of the agent.

## Approaches considered

1. **Extend `bump-fix.yml`** to handle issue branches too. One file, but it is
   already 600 lines and its agent path has run live; adding a second trigger
   and a second kind of pull request to it risks the part that works.
2. **Copy its agent and patch steps into new workflows.** No risk to the bump
   loop, but three copies of the confinement flags and the patch collection,
   which are the security boundary and must not drift.
3. **A reusable workflow for the confined agent run, called by two small
   workflows.** Chosen. The boundary is written once (`factory-agent.yml`),
   and a reusable workflow is fetched by GitHub from the default branch, so
   unlike a local action on disk the agent cannot edit it before a later step
   uses it. `bump-fix.yml` is left alone for now and can move onto the shared
   workflow later.

## Design

**Trigger** (`issue-agent.yml`, on `issues: labeled`). Runs only when the
label is `factory`, the sender is the repository owner with a `User` account,
the issue is open, was written by the owner, and is not a pull request. The
repository is public, so the author check is what keeps a stranger's text away
from the agent. If `factory/issue-<n>` already exists it stops and says so.

**Agent** (`factory-agent.yml`, `workflow_call`). The same confinement as the
bump loop: Claude Code pinned, `--restricted --safe-mode`, tools Read, Grep,
Glob and Edit, no shell, no token. It is given the issue's title and body,
followed by the owner's own comments, in `.factory/issue.md`; on a repair round also the failing log and the diff so
far. Its product is a patch collected from a clean copy of the repository. A
run that stops early yields no patch.

**Push** (in each caller). No AI. Applies the patch, checks the result with
`.github/guard/apply-patch.sh` from the default branch, commits as the App,
pushes `factory/issue-<n>`, opens the pull request with `Closes #<n>`.

**Tests.** A pull request written from an issue may add test files: a file
is allowed if it is *added*, sits in the application directories, and is
named `*.test.ts(x)` or `*.spec.ts(x)`. Modified, renamed, copied or removed
test files stay blocked, as do fixtures, mocks and helpers. Guard recognises
these pull requests by the branch name, which only the push job sets. The
agent decides whether a change merits a test. This first shipped behind a
second owner-applied label, `factory-tests`; it was removed the same day,
because "new files only" already rules out weakening a test and the label
was easy to forget. Repairs to dependency bumps still may not add tests. The check is always made against the commit the branch left
the default branch at, so a test the agent added in round one can be corrected
in round two but an older one cannot.

**When a task contradicts a test.** The first live run showed the gap: asked
for a fix that an existing smoke test ruled out, the agent repaired its way
to green with a different, narrower fix. It is now told to change nothing
in that case and name the test, which ends in `needs-human` with the reason
on the pull request. Existing tests stay the owner's to change.

**Repairs** (`issue-fix.yml`, on `workflow_run` of PR Checks). Failure on a
`factory/issue-*` branch whose pull request the App opened: another agent run,
up to three, then `needs-human`. Success: `ready-for-review` and a mention.

**Telling the owner.** Outcomes on the issue are commented by the workflow
token, because the App has no issues permission and should not gain one.

## Calls made here, not by the owner

- First attempts get 60 turns; repairs keep 30. The handoff's 30 was sized
  for repairs, and a first attempt has to read the codebase.
- New tests count toward the 400-line cap.
- Label `factory`; branch `factory/issue-<n>`.

## Left for later

- Moving `bump-fix.yml` onto `factory-agent.yml`.
- Step 5: staging smoke test, then merging per class.
