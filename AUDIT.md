# Audit: what lives in parachute-surface, who uses it, and what applets need from it

Step 5 of the Parachute app (the applet kit). Read on 2026-11-16, read-only, from
`ParachuteComputer/parachute-surface` at `main` 74c2522 and `next` 4600e80 (fresh clone). The dependents were
read from local checkouts and from GitHub. Nothing in parachute-surface, core, cloud or Prism was changed.

## 1. What is in parachute-surface

| Package | Version (npm) | What it is |
|---|---|---|
| `@openparachute/surface-client` | 0.3.7 (0.3.7) | Browser side of a vault: `VaultClient` (notes, tags, attachments, live `subscribe` over WebSocket), OAuth with PKCE and client registration, token storage, the `Note` type. No runtime dependencies. |
| `@openparachute/surface-render` | 0.3.1 (0.3.1) | React parts that draw a note: `NoteRenderer` (picks markdown, csv, json, yaml, code or plain by path), `MarkdownView` (react-markdown with gfm, breaks and `[[wikilinks]]`), embeds, MDX view, and `styles.css`. **On `next` only (unreleased):** `./rich`, rich-notes-kit 0.4 (MIT, vendored), which draws recipes, minutes, session notes and chant charts, plus tasks, logs, callouts and charts in any note, behind `NoteRenderer`'s `rich` switch (#247–#250). |
| `@openparachute/surface` | 0.3.9 | The host: serves custom web UIs under the hub. |
| `@openparachute/surface-server` | 0.1.4 | Server kit for surfaces with a backend. |
| `@openparachute/doc-schema` | 0.1.0 | ProseMirror/TipTap schema and markdown codec. |
| `@openparachute/mcp` | 0.2.0 | Stdio MCP bridge to hubs. |
| `@openparachute/account-client` | 0.1.0 (not published) | Browser SDK for the account contract. |
| private apps | — | pebble-config, docs-editor, meeting-ingest, meeting-mcp, the admin UI. |

The frame transport (`createFrameFetch` / `serveFrameFetch`) is not on `main` or npm. It is only in open PR #244.

## 2. Who uses which piece

| Consumer | Pins | Uses |
|---|---|---|
| **This app** (`ParachuteComputer/parachute`) | surface-client 0.3.7, surface-render 0.3.1 (exact) | client: `VaultClient`, `VaultConflictError`, the OAuth and PKCE helpers, `Note`; `VaultClient` is also bundled into every applet frame as `parachute.vault`. render: `NoteRenderer`, `unresolvedLink`, `styles.css`, only in the frame's note view (`src/frame/views/NoteView.tsx`). |
| **The Uni app** (and its many working copies) | the same two, exact | client: `VaultClient` (also in its frame kit), `Note`. render: `NoteRenderer`, `CodeRenderer` and code formats in its note view. Its frame kit gives applets `window.uni`, with no parts. |
| **parachute-app** (the older notes app) | client 0.3.7, render `^0.3.1` | client: `VaultClient` and errors, query builder, OAuth discovery. render: `NoteRenderer`, `MarkdownView`. |
| **The Uni app's applets** (the live Recipes applet) | none | Plain HTML that calls `uni.vault.*`, `uni.ready`, `uni.onOpen`; CSS on `--text`, `--muted`, `--surface`, `--line` with its own fallbacks. A v2 that inlines rich-notes-kit (197 KB) is built and waiting. |
| **parachute-core** (0.8.0 installed; 0.9.0-pre.1 remote) | none | Two comments only. The hub lists the host (`@openparachute/surface`) as an installable service. |
| **parachute-cloud** | none | Its workers depend on core, door-contract and scope-guard (checked `package.json`, `workers/identity`, `workers/vault` on GitHub). |
| **Prism** (`omniharmonic/prism`, three local worktrees) | none | No `@openparachute/*` dependency in any of its packages; "VaultClient" in its docs is its own interface. |
| parachute-hub, parachute-vault (both archived) | none | Onboarding strings and the service list only. |

## 3. What applets need, and the plan to move it here

An applet imports `react`, `react-dom` and `parachute`, and nothing else. Of parachute-surface it needs two things:

1. **Vault data:** `VaultClient`, which the frame already carries as `parachute.vault`. It is published and stable,
   and the Uni app uses it the same way. **Plan: keep it from npm for now.** Move it into this repo only when this
   repo becomes the one place that releases Parachute's browser packages (see 5).
2. **A note renderer with rich notes:** what `parachute`'s `Note` part draws. The rich renderer exists only on
   surface-render's unreleased `next`. **Plan, done in this step:** this repo takes surface-render from `next` 4600e80
   into `packages/surface-render/`, byte for byte, with where it came from in `packages/surface-render/VENDORED.md`.
   The app builds it from source, the frame's note view and the applet `Note` part both use it, and the npm
   dependency on surface-render goes. From here, the note renderer is changed in this repo.

The look (theme tokens) and the parts (list, card, field, empty) are new and never lived in parachute-surface. They
are written here, in `src/kit/`, on the tokens only, so each could later be shared as a record (step 6).

## 4. Archiving parachute-surface: what it would break

Not archived; this is what it would cost today.

- **Nothing stops running.** Archiving leaves npm alone: every published version stays installable, and every
  consumer pins a published version. No repo clones it in CI, uses it as a submodule, or depends on it by git URL
  (searched every `package.json`, lock file and workflow in the checkouts read).
- **Publishing stops.** Its `release.yml` is the npm trusted publisher for all seven packages and for the `parachute-mcp`
  binaries. An archived repo can't take the commits a release needs.
- **Unreleased work is stranded:** the rich renderer and remote-image fix on `next`, the 0.4 kit branch, and PR #244
  (the frame transport the Uni app's `frameFetch.ts` waits for).
- **Who would feel it:** the Uni app (all its clones) and parachute-app get no more fixes to the client or renderer.
  The hub's installer would keep installing the frozen host 0.3.9. Docs that link to it: the module map, hub
  service-row conventions, core's hub README, parachute.computer's surface pages.
- **This app is not exposed**, once this step lands: its renderer is in this repo, and the client is a published,
  pinned version.

## 5. Proposals for repos this step doesn't change

- **parachute-surface:** merge `next` to `main` and publish surface-render 0.4 so the Uni app and parachute-app get
  rich notes too. Or agree that this repo's `packages/surface-render` is the renderer's home from now on, and mark the
  package there as moved. Owner: whoever releases parachute-surface.
- **The Uni app:** applets that use the new parts (`Note`, `List`, `Card`, `Field`, `Empty`, `useTheme`) run only in
  the Parachute app. The Uni app's frame kit gives `window.uni` without them, so such an applet stops there with
  "it imports … and an applet can import only …". Either the Uni app takes the same parts (built from this repo), or
  its applets keep to `vault`, `ready` and `onOpen`. Owner: the Uni app.
- **The Uni app's Recipes applet:** it can become a TSX applet on the parts. The worked example in
  `docs/WRITE-AN-APPLET.md` is one. Owner: the Uni app.
- **core:** nothing needed. The live-query WebSocket (`GET /api/subscribe`) already does what the theme record needs.
- **Prism, cloud:** nothing; neither depends on parachute-surface.

## How this was read

- Packages, exports and dependencies: `package.json` and source in a fresh clone of `next` and local `main`.
- Dependents: `rg` for `@openparachute/surface` over every `package.json` in the local checkouts (231 manifests:
  Uni app copies 144, parachute-surface worktrees 36, parachute-app 29, this repo's worktrees 6, other 16). Imports were read in
  this repo, the Uni app, parachute-app and the Recipes applet.
- GitHub: `git ls-remote` for parachute-surface; `gh api` for parachute-cloud's `package.json` files and
  parachute-surface's archived flag; Prism's `package.json` files in three local worktrees.
- Not read: Prism's source beyond its manifests; parachute-cloud beyond its manifests; whether an archived repo can
  still run an OIDC publish.
