#!/usr/bin/env bash
# The version code of a Google Play build: the number of commits behind HEAD (docs/STORES.md, "Version code").
# Two builds of one commit agree; a commit on top of another counts one more; and the number stays small (Play's ceiling
# is 2,100,000,000, and a code can't be lowered once used). Two guards keep that true:
#   - a shallow clone is refused: its count would be too low;
#   - HEAD must be on origin/next (its tip or behind it): a feature branch counts commits that a squash merge drops, so
#     its code could be higher than the next builds of next, and Play would refuse those.
# PARACHUTE_PLAY_UNCHECKED_BRANCH=1 skips the second, for a build nobody uploads (a pull request's, signed with a
# throwaway key). A tag on main is behind next: upload the newest build only, or Play sees the code go down.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  echo "play-version-code: shallow clone, so the commit count is too low (fetch the history: git fetch --unshallow)" >&2
  exit 1
fi
if [ -z "${PARACHUTE_PLAY_UNCHECKED_BRANCH:-}" ] && ! git merge-base --is-ancestor HEAD origin/next 2>/dev/null; then
  echo "play-version-code: HEAD isn't on origin/next: build a Play bundle from next, after the merge (git fetch origin next)" >&2
  exit 1
fi
count=$(git rev-list --count HEAD)
[[ $count =~ ^[1-9][0-9]*$ ]] || { echo "play-version-code: no commit count" >&2; exit 1; }
echo "$count"
