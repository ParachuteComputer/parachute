#!/usr/bin/env bash
# The MCP Apps reference host (github.com/modelcontextprotocol/ext-apps, examples/basic-host) at a pinned commit, built
# to serve on 127.0.0.1 with its sandbox proxy on SANDBOX_PORT: what e2e/run.mjs drives.
#   packages/applet-host/e2e/basic-host.sh <dir> [sandbox port, default 47393]
# Its sandbox address is a constant in its source (localhost:8081); this points it at 127.0.0.1:<port>, binds both
# servers to 127.0.0.1, and lets express serve from a path with a dot folder in it.
set -euo pipefail
DIR=$1; PORT=${2:-47393}
REF=${EXT_APPS_REF:-ea3e9d0e624a20bc1c51310292f09d9b8ed17161}   # 2026-11-10, ext-apps 2.1.0 (DOCS.md §2)
if [ ! -d "$DIR/.git" ]; then
  git init -q "$DIR"
  git -C "$DIR" fetch -q --depth 1 https://github.com/modelcontextprotocol/ext-apps.git "$REF"
  git -C "$DIR" checkout -q FETCH_HEAD
fi
cd "$DIR"
echo "ext-apps at $(git rev-parse --short HEAD)"
sed -i.bak "s#const SANDBOX_PROXY_BASE_URL = \"[^\"]*\"#const SANDBOX_PROXY_BASE_URL = \"http://127.0.0.1:$PORT/sandbox.html\"#" examples/basic-host/src/implementation.ts
sed -i.bak 's#hostApp.listen(HOST_PORT, (err)#hostApp.listen(HOST_PORT, "127.0.0.1", (err)#; s#sandboxApp.listen(SANDBOX_PORT, (err)#sandboxApp.listen(SANDBOX_PORT, "127.0.0.1", (err)#; s#express.static(DIRECTORY)#express.static(DIRECTORY, { dotfiles: "allow" })#; s#res.sendFile(join(DIRECTORY, "sandbox.html"))#res.sendFile(join(DIRECTORY, "sandbox.html"), { dotfiles: "allow" })#' examples/basic-host/serve.ts
grep -q "127.0.0.1:$PORT/sandbox.html" examples/basic-host/src/implementation.ts
npm install --no-audit --no-fund >/dev/null
cd examples/basic-host && npm run build >/dev/null
echo "basic-host built (sandbox 127.0.0.1:$PORT)"
