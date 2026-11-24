#!/usr/bin/env bash
# The version code of a Google Play build: the number of commits behind HEAD (docs/STORES.md, "Version code").
# Two builds of one commit agree; a commit on top of another counts one more; and the number stays small (Play's ceiling
# is 2,100,000,000, and a code can't be lowered once used). Needs the whole history, so a shallow clone is refused:
# its count would be too low. Run it on next (or main, which next contains).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  echo "play-version-code: shallow clone, so the commit count is too low (fetch the history: git fetch --unshallow)" >&2
  exit 1
fi
count=$(git rev-list --count HEAD)
[[ $count =~ ^[1-9][0-9]*$ ]] || { echo "play-version-code: no commit count" >&2; exit 1; }
echo "$count"
