# @openparachute/applet-host

A Parachute applet as an MCP App view: what Claude (and ChatGPT, and any host of the MCP Apps extension) shows when a
person opens one of their applets from Parachute's connector. One HTML file, versioned; parachute-core serves it
(`packages/vault/src/applet-host/`, `ui://parachute/applet/<id>`), and so will Parachute Cloud.

## What it does

- The connector offers each applet the person approved by code hash as its own tool, `open-<id>`, with its own view
  and a global entry point: one tile per applet on Claude's Artifacts page, pinnable to the sidebar. An applet nobody
  approved, or one whose code changed since, isn't offered.
- The view gets the applet in the page (`src/payload.ts`), checks the code's hash against the approval again, compiles
  it as the app does, and runs it in **the app's sealed frame, nested inside the view**: `sandbox="allow-scripts"` (an
  opaque origin, no storage, no reach into the view), the frame's own content policy (no network), no devices.
- The frame's only door is the app's contract session, routed to the app's own vault module: the record tools, only in
  the manifest's folders, judged at every call as in the app. Its legs are the host's `tools/call` on the connector
  (`src/mcpVault.ts`), so the view holds no token and every call is the person's own key at its level.
- The host protocol is a few messages by hand (`src/host.ts`): `ui/initialize`, `tools/call`, size and display mode.

## What doesn't work inside Claude (and why)

- **Voice** (`reach: [voice]`): no microphone in a sealed frame, and the host's view isn't granted one.
- **Relays and services** (Rooms, mail, Matrix, Techne: `services`, `techne`): they need the app's key and broker. An
  applet that needs them shows without them, as in someone else's vault.
- **Other vaults** (`app: [vaults]`), **files and uploads** (attachments, `app.pick`), **embeds**, **signals** and
  **settings sections**: not bridged.
- **Components** (`component:` imports): not offered; their code lives in other records.
- **Saved state** lasts while the view is open; **offline** isn't possible (every read is a live connector call).

## Build and test

```bash
npx vite build --config packages/applet-host/vite.config.ts      # → packages/applet-host/dist/applet-host.html
npx vitest run packages/applet-host                              # the parsers
packages/applet-host/e2e/basic-host.sh "$TMPDIR/ext-apps" 47393  # the reference host, pinned
EXT_APPS="$TMPDIR/ext-apps" PARACHUTE_CORE=<parachute-core> APPLET_HOST_HTML=$PWD/packages/applet-host/dist/applet-host.html \
  node packages/applet-host/e2e/run.mjs [shots] [--strict] [--browser webkit]
```

The e2e (CI: `applet-host`) starts a throwaway hub with made-up records, the app's People and Library applets, an
applet that tries every way out of its frame, and one nobody approved; links a throwaway key to the owner and signs
approvals as the app does; then drives the reference host as a person would.

A new version: bump `version` here, build, and keep it in core with `bun scripts/keep-applet-host.ts <html> <version>`
(parachute-core). Publishing to npm is Aaron's.
