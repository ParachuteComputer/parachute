#!/usr/bin/env bash
# Write the update feed (src/shell/updates.ts) beside the builds it names, so every Parachute built with
# PARACHUTE_UPDATE_FEED=<that folder's address>/latest.json offers them. Run it last, after the files are in place:
# the feed is what moves people to a build. Each file's sha256 goes in too: the Android app checks its download against it.
#   scripts/update-feed.sh <folder> [--android <apk>] [--mac <dmg>]     (the build's commit: HEAD, or PARACHUTE_BUILD_*)
set -euo pipefail
cd "$(dirname "$0")/.."
dir=$1; shift
[ -d "$dir" ] || { echo "no folder $dir" >&2; exit 2; }
at=${PARACHUTE_BUILD_AT:-$(git log -1 --format=%ct)} commit=${PARACHUTE_BUILD_COMMIT:-$(git rev-parse --short=7 HEAD)}
files="{}" sums="{}"
while [ $# -gt 0 ]; do
  case "$1" in
    --android|--mac) [ -f "$dir/$2" ] || { echo "$2 is not in $dir" >&2; exit 2; }
      files=$(node -e 'const f=JSON.parse(process.argv[1]);f[process.argv[2]]=process.argv[3];console.log(JSON.stringify(f))' "$files" "${1#--}" "$2")
      sums=$(node -e 'const f=JSON.parse(process.argv[1]);f[process.argv[2]]=require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[3])).digest("hex");console.log(JSON.stringify(f))' "$sums" "${1#--}" "$dir/$2"); shift ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac; shift
done
[ "$files" != "{}" ] || { echo "name at least one file (--android, --mac)" >&2; exit 2; }
node -e 'console.log(JSON.stringify({v:1,at:Number(process.argv[1]),commit:process.argv[2],files:JSON.parse(process.argv[3]),sha256:JSON.parse(process.argv[4])},null,2))' "$at" "$commit" "$files" "$sums" > "$dir/latest.json.new"
mv "$dir/latest.json.new" "$dir/latest.json"
cat "$dir/latest.json"
