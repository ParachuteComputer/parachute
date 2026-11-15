# Parachute

One app for your vaults and the applets that grow on them.

- **Vaults.** Add a vault on any Parachute hub by its address and sign in there. Browse, search and read its notes.
- **Applets.** An applet is one note in your vault: its metadata is the manifest (what it may read and write, which
  kinds of note it opens), its content is the code: one TSX or JSX module, or an HTML page. Any chat AI with the
  Parachute MCP can make one by writing that note: see [docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md). It runs
  sealed, only after you allow it, and changed code asks again.
- **Open with.** A note's type is its tag. Tap a note and it opens in the applet that claims its type, or in the plain
  vault view, which opens anything. When two applets claim a type, Parachute asks once. Your choices stay on your device.

It runs on Android and desktop (Tauri 2). The web build is what the tests drive.

## Build

Needs Node 22+.

```sh
npm ci
npm run dev          # the web build at http://localhost:1420
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # Playwright on the web build, against a real hub (see below)
```

`npm run e2e` starts a throwaway Parachute hub (`parachute-core` from `@openparachute/core`, which runs on Bun 1.4+) in
a temp folder on a loopback port, seeds a vault from `e2e/fixtures`, and removes it after. Point `PARACHUTE_CORE` at
the binary if it isn't on your `PATH`.

## How it fits together

- `src/vault/`: signing in (OAuth with PKCE and dynamic registration, one sign-in per vault), the vaults this device
  holds, the client.
- `src/applet/`: an applet as Parachute reads it. The manifest (`metadata.applet`, contract 2) is read exactly as the Uni
  app reads it, so one applet note runs in both; what it opens goes beside it in `metadata.opens`. Its code (`code.ts`):
  the note's extension says html, tsx or jsx; TSX/JSX is transpiled in the app with sucrase (small, pure JS, offline),
  cached against the code's hash, and run with React provided as an import. The sealed frame,
  its kit (`window.uni`, also `window.parachute`), the grant card and the sandbox self-test, which runs by itself and
  decides whether applets run here at all (sealed on desktop, approved code only on Android).
- `src/open/`: open with. The note's route decides (`resolve.ts`); the sheet and long-press; defaults kept on this
  device; tap marks, so an applet starts only on a person's tap.
- `src/links/`: links in, `parachute://open?url=<a note's web address>`.

An applet's note, as an example:

```yaml
tags: [applet]
metadata:
  applet: { contract: 2, id: recipes, name: Recipes, access: [{ vault: here, allow: [{ path: Recipes/, verbs: [read, create, update] }] }] }
  opens: [{ type: recipe, path: Recipes/ }]   # recipe notes under Recipes/ open in it
```

## The shell (Android and desktop)

Tauri 2, pinned to Tauri 2.11 and wry 0.55.1: the Android webview files in
`src-tauri/gen/android/app/src/main/java/computer/parachute/app/` (`RustWebView.kt`, `Ipc.kt`, `MainFrameOnly.kt`) are
copies of wry's templates that keep the bridge to native code out of applet frames and remote pages, and
`src-tauri/build.rs` refuses an Android build on any other wry.

```sh
npm run tauri dev                       # desktop, against the dev server
scripts/android-build.sh                # release APK for arm64, signed with the play-test key
scripts/android-build.sh --debug --target x86_64   # a debug build for the emulator
```

The Android build needs `ANDROID_HOME`, `NDK_HOME` and Java 17, and a signing key described in
`~/.config/parachute-playtest/keystore.properties` (or `PARACHUTE_KEYSTORE_PROPERTIES`): `storeFile`, `storePassword`,
`keyAlias`, `keyPassword`. The script checks the APK's signature against it. Keys never go in the repo.

**Signing in from the shell.** The app registers on a hub as "Parachute" with the redirect
`http://127.0.0.1:47219/oauth/callback`. A hub keeps that name for redirects only the person's own device can receive,
and loopback is one. Nothing listens on that port: the shell catches the navigation in its own webview and hands the
code to the app (`src-tauri/src/lib.rs`, `signin_return`).

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
