#!/usr/bin/env bash
# Stops and removes the servers up.sh started (only that compose project's containers and volumes) and their folder.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D="${SERVICES_DIR:-$HERE/../.services}"
export SERVICES_DIR="$D" BUZZ_IMAGE="${BUZZ_IMAGE:-none}"
docker compose -p "${SERVICES_PROJECT:-parachute-e2e}" -f "$HERE/compose.yml" down -v --remove-orphans
# the gateway's container may have written files as another user (its root): leave none behind
[ -d "$D" ] && { rm -rf "$D" 2>/dev/null || docker run --rm -v "$(cd "$D" && pwd):/d" python:3.12-slim rm -rf /d/mail && rm -rf "$D"; }
echo "services down"
