#!/usr/bin/env bash
# Starts and seeds the throwaway servers the services specs need (e2e/services/README.md), then writes the variables
# that turn those specs on to $SERVICES_DIR/env (and to $GITHUB_ENV in CI). Run again on a running set, it starts what
# stopped; after a setup that failed part way, run down.sh first.
#   SERVICES_DIR      where keys, passwords and the gateway's files go (default e2e/.services; mode 700)
#   SERVICES_PROJECT  the compose project name, so two sets on one machine stay apart (default parachute-e2e)
#   BUZZ_IMAGE        the relay's image (default: production's, built once by relay-image.sh)
#   RELAY_PORT STALWART_PORT STALWART_SETUP_PORT MAIL_PORT MATRIX_PORT   loopback ports (3871 18443 18080 19951 18008)
# The browser's pass-through to the mail gateway is always 127.0.0.1:19952 (e2e/mail.spec.ts).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(mkdir -p "${SERVICES_DIR:-$HERE/../.services}" && cd "${SERVICES_DIR:-$HERE/../.services}" && pwd)"
export SERVICES_DIR
# down.sh removes only a folder up.sh made: a folder named by mistake keeps what it holds
[ -f "$SERVICES_DIR/.parachute-e2e" ] || [ -z "$(ls -A "$SERVICES_DIR")" ] || { echo "$SERVICES_DIR isn't empty and isn't a services folder" >&2; exit 1; }
touch "$SERVICES_DIR/.parachute-e2e"
chmod 700 "$SERVICES_DIR"
P="${SERVICES_PROJECT:-parachute-e2e}"
export RELAY_PORT="${RELAY_PORT:-3871}" STALWART_PORT="${STALWART_PORT:-18443}" STALWART_SETUP_PORT="${STALWART_SETUP_PORT:-18080}" \
  MAIL_PORT="${MAIL_PORT:-19951}" MATRIX_PORT="${MATRIX_PORT:-18008}"
BUZZ_IMAGE="${BUZZ_IMAGE:-$("$HERE/relay-image.sh")}"
export BUZZ_IMAGE
dc() { docker compose -p "$P" -f "$HERE/compose.yml" "$@"; }
seed() { node "$HERE/seed.mjs" "$1" "$SERVICES_DIR"; }

seed keys
mkdir -p "$SERVICES_DIR/mail"
dc up -d --wait --wait-timeout 180 relay stalwart matrix
if [ ! -f "$SERVICES_DIR/mail/secrets/admin.pw" ]; then
  seed mail-bootstrap
  dc restart stalwart   # it reads the config its setup wrote
fi
seed mail
dc up -d --wait --wait-timeout 180 mail-gateway
seed matrix

# the relay answers once it has migrated its database and made its community
for _ in $(seq 60); do curl -sf -o /dev/null "http://127.0.0.1:$RELAY_PORT/health" && break; sleep 1; done
curl -sf -o /dev/null "http://127.0.0.1:$RELAY_PORT/health" || { dc logs relay | tail -40; echo "the relay did not answer" >&2; exit 1; }

seed relay

cat > "$SERVICES_DIR/env" <<VARS
BUZZ_RELAY=ws://localhost:$RELAY_PORT
BUZZ_KEYS=$SERVICES_DIR/keys
MAIL_BRIDGE=http://127.0.0.1:$MAIL_PORT
STALWART=https://127.0.0.1:$STALWART_PORT
MAIL_SECRETS=$SERVICES_DIR/mail/secrets
MATRIX_HS=http://127.0.0.1:$MATRIX_PORT
MATRIX_TOKENS=$SERVICES_DIR/matrix
VARS
[ -n "${GITHUB_ENV:-}" ] && cat "$SERVICES_DIR/env" >> "$GITHUB_ENV"
echo "services up (project $P); variables in $SERVICES_DIR/env"
