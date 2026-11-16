# Audit: what lives in parachute-surface, who uses it, and what applets need from it

Step 5 of the Parachute app (the applet kit). Read on 2026-11-16, read-only, from
`ParachuteComputer/parachute-surface` at `main` 74c2522 and `next` 4600e80 (fresh clone; `main` is two release commits
ahead of `next`). The dependents were read from local checkouts and from GitHub. Nothing in parachute-surface, core,
cloud or Prism was changed.

## 1. What is in parachute-surface

| Package | Version (npm) | What it is |
|---|---|---|
| `@openparachute/surface-client` | 0.3.7 (0.3.7) | The browser side of a vault: `VaultClient`, OAuth with PKCE, token storage and the `Note` type. `VaultClient` reads and writes notes, tags and attachments, and offers a live `subscribe` over WebSocket. It has no runtime dependencies. |
| `@openparachute/surface-render` | 0.3.1 (0.3.1) | React parts that draw a note, plus `styles.css`. `NoteRenderer` picks markdown, csv, json, yaml, code or plain by path. `MarkdownView` uses react-markdown with gfm, breaks and `[[wikilinks]]`. It also has embeds and an MDX view. |
| (the same, `next` only) | unreleased | `./rich`: rich-notes-kit 0.4 (MIT, vendored), behind `NoteRenderer`'s `rich` switch (#247–#250). It draws recipes, minutes, session notes and chant charts. In any note it draws tasks, logs, callouts and charts. |
| `@openparachute/surface` | 0.3.9 | The host: serves custom web UIs under the hub. |
| `@openparachute/surface-server` | 0.1.4 | Server kit for surfaces with a backend. |
| `@openparachute/doc-schema` | 0.1.0 | ProseMirror/TipTap schema and markdown codec. |
| `@openparachute/mcp` | 0.2.0 | Stdio MCP bridge to hubs. |
| `@openparachute/account-client` | 0.1.0 (not published) | Browser SDK for the account contract. |
| unpublished (`private: true`) | — | pebble-config, docs-editor, meeting-ingest, meeting-mcp, the admin UI. |

The frame transport (`createFrameFetch` / `serveFrameFetch`) is not on `main` or npm. It is only in open PR #244.

## 2. Who uses which piece

| Consumer | Pins | Uses |
|---|---|---|
| **This app** (`ParachuteComputer/parachute`) | surface-client 0.3.7 and surface-render 0.3.1, both exact | **client:** `VaultClient`, `VaultConflictError`, the OAuth and PKCE helpers and `Note`. `VaultClient` is also bundled into every applet frame as `parachute.vault`. **render:** `NoteRenderer` and `unresolvedLink` in the frame's note view (`src/frame/views/NoteView.tsx`), and `styles.css` in the frame bundle (`src/frame/entry.tsx`). |
| **The Uni app** | the same two, exact | **client:** `VaultClient` in its frame kit, and `Note`. **render:** `NoteRenderer`, `CodeRenderer` and the code formats in its note view. It runs HTML applets only. Its frame kit gives them `window.uni`, with no parts. |
| **parachute-app** (the older notes app) | client 0.3.7, render `^0.3.1` | **client:** `VaultClient` and its errors, the query builder, OAuth discovery, and `fetchAttachmentBlob` (through `vaultClientFetchBlob`). **render:** `NoteRenderer`, `MarkdownView`. |
| **HTML applets** written for the Uni app (Recipes) | none | Plain HTML that calls `uni.vault.*`, `uni.ready` and `uni.onOpen`. Its CSS uses `--text`, `--muted`, `--surface` and `--line`, with fallbacks. |
| **parachute-core** (0.8.0; 0.9.0-pre.1 beta) | none | The hub lists the host (`@openparachute/surface`) as an installable service and has code tied to it: an "Open Notes" fallback and the surface token. Its vault seed pack also tells a new vault's agent to build custom UIs with surface-client and surface-render (`packages/vault/core/src/seed-packs.ts`). |
| **parachute-cloud** | none | Its workers depend on core, door-contract and scope-guard (`package.json`, `workers/identity`, `workers/vault` on GitHub). |
| **Prism** (`omniharmonic/prism`) | none | No `@openparachute/*` dependency in any of its packages. The "VaultClient" in its docs is its own interface. |
| parachute-hub, parachute-vault (both archived) | none | Onboarding strings and the service list only. |

## 3. What applets need, and the plan to move it here

An applet imports `react`, `react-dom` and `parachute`, and nothing else. It needs two things from parachute-surface.

1. **Vault data:** `VaultClient`, which the frame already carries as `parachute.vault`. It is published and stable,
   and the Uni app uses it the same way. **Done: kept from npm for now.** The shell talks to the hub through it with a
   translating fetch, so the wire is the record door (`/api/records`; #22, see 5). Move it into this
   repo only when this repo becomes the one place that releases Parachute's browser packages.
2. **A note renderer with rich notes:** what the `Note` part in `parachute` draws. The rich renderer exists only on
   surface-render's unreleased `next`. **Done in #23:** surface-render copied from `next` 4600e80 into
   `packages/surface-render/`, byte for byte but for two type casts. `VENDORED.md` there says where it came from and
   its licences: the renderer is AGPL-3.0, rich-notes-kit and markdown-it are MIT. The app builds it from source under
   the same import name, and the npm dependency on surface-render goes. The frame's note view and the applets' `Note`
   part both use it.
   **Weight:** the rich kit and its markdown-it are about 240 KB of source before minifying, and react-markdown with
   remark comes on top. So the renderer goes into an applet's frame only when its code imports `Note` (560 KB of
   script and 26 KB of styles, minified); other applets get React and the light parts alone (222 KB).

The look (the theme tokens, PR #21) and the other parts (`Days`, list, card, field, empty) are new. They never lived
in parachute-surface. They are written here (`src/kit`, #23), on the tokens only, so each could later be shared as a
record (step 6).

## 4. Archiving parachute-surface: what it would break

It is not archived. This is what archiving would cost today.

- **Nothing stops running.** Archiving leaves npm alone, and every published version stays installable. This app
  and the Uni app pin exact versions, and parachute-app pins a `^0.3.1` range. No repo clones parachute-surface in
  CI, uses it as a submodule, or depends on it by git URL. I searched every `package.json`, lock file and workflow
  in the checkouts I read.
- **Publishing stops.** Its `release.yml` is the npm trusted publisher for all seven packages and for the
  `parachute-mcp` binaries. An archived repo can't take the commits a release needs.
- **Unreleased work is stranded:**
  - the rich renderer (#247–#250);
  - #246, a security fix. In surface-client 0.3.7, `fetchAttachmentBlob` sends the vault's bearer token to any
    absolute URL a note names. `next` keeps the token on the vault's own origin;
  - PR #244, the frame transport the Uni app is waiting for.
- **Who would feel it:**
  - parachute-app keeps its token leak either way: it has its own `fetchAttachmentBlob` with the same flaw, which #246
    leaves for a fix of its own, and its `^0.3.1` range on surface-render won't take a 0.4.
  - The Uni app and parachute-app get no more fixes to the client or the renderer.
  - The hub's installer keeps installing the frozen host 0.3.9, and core's seed pack keeps pointing new vaults at
    it.
  - Docs that name the repo go stale: core's hub README (its module list), the hub's services-row conventions, and
    parachute.computer's surface pages.
- **This app is not exposed.** It never calls `fetchAttachmentBlob`: images in its frame are data and blob only,
  and applet frames reach the vault through the shell with no token. Its renderer lives in this repo (#23).

## 5. Proposals for repos this step doesn't change

- **parachute-surface:**
  - Merge `main` into `next`, then release `next` (surface-render 0.4.0, surface-client 0.3.8). That gives the Uni
    app rich notes and the remote-image fix. parachute-app also needs an origin check in its own client and a
    dependency bump.
  - Or agree that this repo's `packages/surface-render` is the renderer's home from now on, and mark the package
    there as moved.
  - Also: `VaultClient` hard-codes `/api/notes`, which core 1.0 removes (0.9 adds `/api/records`). It needs the
    records door, falling back to `/api/notes` on a hub that doesn't have it. PR #22 does that in this app's own
    fetch for now (`src/vault/records.ts`).
  - Owner: whoever releases parachute-surface.
- **The Uni app:** it runs HTML applets only, and its frame kit has none of the new parts. An applet built on the
  parts (`Note`, `Days`, `List`, `Card`, `Field`, `Empty`) therefore runs only in this app. An HTML applet that keeps
  to `vault`, `ready`, `onOpen` and the CSS variables runs in both. If the Uni app should run TSX applets on the
  parts, it would take this repo's kit. Owner: the Uni app.
- **core:** nothing needed for this step. The live-query WebSocket (`GET /api/subscribe`) already does what the theme
  record needs. Its seed pack's surface advice may want this app's applet guide beside it.
- **Prism, cloud:** nothing. Neither depends on parachute-surface.

## How this was read

- **Packages, exports and dependencies:** `package.json` files and source, in a fresh clone of `next` and in local
  `main`. The npm versions come from `npm view`.
- **Dependents:** `rg` for `@openparachute/surface` over every `package.json` in the local checkouts. Imports were
  read in this repo, the Uni app, parachute-app and the Recipes applet.
- **GitHub:** `git ls-remote` and `gh api` (compare, PR #246) for parachute-surface; `gh api` for parachute-cloud's
  `package.json` files; Prism's `package.json` files.
- **Not read:** Prism's source beyond its manifests, parachute-cloud beyond its manifests, and whether an archived
  repo can still run an OIDC publish.
