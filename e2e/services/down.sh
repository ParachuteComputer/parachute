#!/usr/bin/env bash
# Stops and removes the servers up.sh started (only that compose project's containers and volumes) and the folder up.sh
# made for them (only one with its marker).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D="${SERVICES_DIR:-$HERE/../.services}"
[ -d "$D" ] && D="$(cd "$D" && pwd)"
export SERVICES_DIR="$D" BUZZ_IMAGE="${BUZZ_IMAGE:-none}"
docker compose -p "${SERVICES_PROJECT:-parachute-e2e}" -f "$HERE/compose.yml" down -v --remove-orphans
if [ -f "$D/.parachute-e2e" ]; then
  # the gateway's container may have written files as another user (its root): leave none behind
  rm -rf "$D" 2>/dev/null || { docker run --rm --label owner=parachute-e2e -v "$D:/d" python:3.12-slim rm -rf /d/mail && rm -rf "$D"; }
fi
echo "services down"
