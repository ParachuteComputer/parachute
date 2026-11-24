# T-476: Parachute inside Claude, two spikes

Research spikes, not product code. Made-up data on a throwaway vault, all on 127.0.0.1. The write-up is in the T-476
folder (DOCS.md, PROPOSAL.md); this is what it was tested with.

- `a-artifact/`: **Spike A, a live Claude artifact.** `parachute-tasks.html` is one self-contained page that lists the
  vault's tasks with `watchTool("query-records")` and edits them with `callTool("update-record")`, through
  `window.claude.use("mcp")` (artifact runtime contract 0.2.96). `manifest.json` is the capability a publish declares.
  `harness/` mimics claude.ai's side of the contract (sandboxed frame, strict CSP, first-call approval, the declared
  tool list, read caching and `invalidate`), making the connector calls server-side on the vault's key.
- `b-mcp-app/`: **Spike B, an MCP App.** The view is `packages/applet-kit/mcp` (one HTML file, built below). Core's
  `open-applet` tool (parachute-core branch `uni/t476-inclaude-mcp-app`) names it as `ui://parachute/applet-host`; the
  view runs any TSX applet record from the vault on the web kit, its vault calls bridged to the host's `tools/call`.
  `e2e.mjs` drives it in the ext-apps reference host (basic-host).
- `tools/`: the throwaway vault (`vault.sh`), a one-tool caller (`mcp.mjs`), the seed resets, and `authproxy.mjs` (adds
  the vault's key for hosts that can't send one).

## Run

```bash
# 0. from the app repo root: the view
npx vite build --config packages/applet-kit/mcp/vite.config.ts        # → dist-mcp/applet-host.html
cd spikes/t476-claude
# 1. a throwaway vault from core's spike branch, serving that view
CORE=/path/to/parachute-core APPLET_HOST_HTML=$PWD/../../dist-mcp/applet-host.html tools/vault.sh start
node tools/seed.mjs                                                     # made-up people, tasks, books + People and Library
# 2. Spike A
node a-artifact/harness/server.mjs a-artifact/parachute-tasks.html a-artifact/manifest.json   # prints the harness URL
node tools/reset-tasks.mjs && PW=../../node_modules/playwright node a-artifact/harness/e2e.mjs <harness url> <shots dir>
# 3. Spike B: basic-host from github.com/modelcontextprotocol/ext-apps (examples/basic-host), pointed at the proxy
node tools/authproxy.mjs 47391 &
#    in ext-apps/examples/basic-host (bind it to 127.0.0.1; its sandbox URL is fixed to localhost:8081 unless changed):
#    HOST_PORT=47392 SANDBOX_PORT=47393 SERVERS='["http://127.0.0.1:47391/mcp"]' npm start
PW=../../node_modules/playwright node b-mcp-app/e2e.mjs http://127.0.0.1:47392/ <shots dir> [strict]
tools/vault.sh stop
```
