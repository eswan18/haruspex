#!/usr/bin/env bash
# Applies a patch the factory agent wrote, checks the result against the
# agent's rules, and commits it. Pushing is left to the caller.
#
# Run from the checkout the patch applies to, as a copy of this script taken
# from the default branch, never from the branch being changed. Nothing the
# patch contains is executed: it is applied, measured and committed.
#
# The check is made against BASE_SHA, the commit the pull request starts from,
# not against the commit being built on. So on a later round the limits count
# everything the pull request holds, and a test file the agent added earlier
# still counts as new, which is what lets it be corrected.
#
# Env:
#   PATCH             the patch, base64-encoded
#   BASE_SHA          where the pull request branches off the default branch
#   ALLOW_NEW_TESTS   "true" if the change may add new test files
#   COMMIT_SUBJECT    first line of the commit message
#   COMMIT_BODY       the rest of it
#   APP_SLUG          the factory App's slug; the commit is made in its name
#   GH_TOKEN          a token that can look up the App's account id
#   RUNNER_TEMP       scratch space outside the checkout
set -euo pipefail
: "${PATCH:?}" "${BASE_SHA:?}" "${COMMIT_SUBJECT:?}" "${COMMIT_BODY:?}"
: "${APP_SLUG:?}" "${GH_TOKEN:?}" "${RUNNER_TEMP:?}"

rules=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
scratch=$(mktemp -d "$RUNNER_TEMP/apply.XXXXXX")

printf '%s' "$PATCH" | base64 -d > "$scratch/agent.patch"
git apply --index "$scratch/agent.patch"

git diff --cached --numstat -z --no-renames "$BASE_SHA" > "$scratch/numstat"
git diff --cached --name-only -z --no-renames --diff-filter=A "$BASE_SHA" > "$scratch/added"
flags=(--added "$scratch/added")
if [ "${ALLOW_NEW_TESTS:-false}" = "true" ]; then
  flags+=(--allow-new-tests)
fi
node "$rules/check-patch.ts" "${flags[@]}" < "$scratch/numstat"

# Ordinary files only: no symlinks, submodules or executables.
odd_modes=$(git diff --cached --raw --no-renames "$BASE_SHA" | awk '$2 != "100644" && $2 != "000000"')
if [ -n "$odd_modes" ]; then
  echo "Patch refused: it adds something other than an ordinary file:"
  echo "$odd_modes"
  exit 1
fi

bot_id=$(gh api "/users/${APP_SLUG}[bot]" --jq .id)
git config user.name "${APP_SLUG}[bot]"
git config user.email "${bot_id}+${APP_SLUG}[bot]@users.noreply.github.com"
git commit --quiet -m "$COMMIT_SUBJECT" -m "$COMMIT_BODY"
git log -1 --stat --format='Committed %h: %s'
