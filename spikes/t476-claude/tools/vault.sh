#!/usr/bin/env bash
# Throwaway vault for T-476 spikes: parachute-core's vault from source, on 127.0.0.1, a fresh home, made-up data only.
# usage: tools/vault.sh start|stop   (state in $S=${S:-$TMPDIR/inclaude-t476-vault}; token in $S/token, port in $S/port)
set -euo pipefail
BUN=${BUN:-$(mise which bun 2>/dev/null || command -v bun)}
S=${S:-${TMPDIR:-/tmp}/inclaude-t476-vault}; 
CORE=${CORE:?set CORE to a parachute-core checkout (the uni/t476-inclaude-mcp-app branch for open-applet)}
case "${1:-start}" in
start)
  mkdir -p "$S/home/.parachute/vault" "$S/tmp"
  [ -f "$S/token" ] || { head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$S/token"; chmod 600 "$S/token"; }
  PORT=${PORT:-$( [ -f "$S/port" ] && cat "$S/port" || echo $(( 47000 + RANDOM % 2400 )) )}; echo "$PORT" > "$S/port"
  echo "port: $PORT" > "$S/home/.parachute/vault/config.yaml"
  (cd "$CORE/packages/vault" && nohup env -i PATH="$(dirname "$BUN"):/usr/bin:/bin" HOME="$S/home" PARACHUTE_HOME="$S/home/.parachute" TMPDIR="$S/tmp" \
    PORT="$PORT" VAULT_BIND=127.0.0.1 PARACHUTE_VAULT_NAME=${VAULT:-demo} VAULT_AUTH_TOKEN="$(cat "$S/token")" EMBEDDINGS_ENABLED=false PARACHUTE_APPLET_HOST_HTML="${APPLET_HOST_HTML:-}" \
    "$BUN" src/server.ts >>"$S/vault.log" 2>&1 & echo $! > "$S/pid")
  for i in $(seq 1 100); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.3; done
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && echo "$PORT" || { tail -20 "$S/vault.log"; exit 1; } ;;
stop) # only the vault this script started: a bun whose environment names this state dir
  for p in $(pgrep -u "$(id -u)" -f 'src/server.ts' || true); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx "PARACHUTE_HOME=$S/home/.parachute" && kill "$p"; done
  rm -f "$S/pid"; sleep 1; echo stopped ;;
esac
