# Parachute

One app for your vaults and the applets that grow on them. Early: version 0.1.0, a pre-release
([what works and what doesn't](RELEASE-NOTES.md)).

## Install and sign in

You need a vault on a Parachute hub (its address looks like `https://your-hub/vault/name`) and a Nostr key, or a new
one.

1. **Get the app** from the [releases page](https://github.com/ParachuteComputer/parachute/releases):
   - **Android** (8 or newer, 64-bit ARM): download the `.apk` on the phone and open it.
   - **Mac** (Apple Silicon): the `.dmg`. It isn't notarised, so macOS asks once:
     [docs/INSTALL-MAC.md](docs/INSTALL-MAC.md). The newest build of `next` is in the
     [Mac workflow's](https://github.com/ParachuteComputer/parachute/actions/workflows/mac.yml) artifacts.
2. **Your key.** On the first screen, **Make a new key**. If your key is already in the Uni app or
   [Buzz](https://github.com/unforcedagi/buzz) desktop, choose **Pair from a device that has your key** instead: on
   that device, Settings → **Pair a device**; here, scan its QR code (Android) or paste its `nostrpair://` link (Mac);
   check the 6-digit codes match.
3. **Your hub knows your key.** The hub's owner links it once: `parachute auth link-pubkey --user <name> <npub>`. The
   app shows your `npub1…`.
4. **Add a vault.** Enter the vault's address, press **Sign in with your key**, and press **Approve** on the hub's page.
   **Other ways to sign in** uses the hub's own sign-in instead (a password, or Parachute Cloud's).

**For agents:** an applet is one note your agent writes with the Parachute MCP; see
[docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md). Building from source is under [Build](#build).

## What it does

- **Your key.** You sign in with your Nostr key. Pair it from a device that has it (the Uni app or Buzz desktop sends it
  over the Buzz pairing relay, encrypted end to end), make a new one, or paste one. It stays in the app's native side, in
  the platform's secure storage.
- **Vaults.** Add a vault on any Parachute hub by its address and sign in there with your key, or another way the hub
  offers (a password, or Cloud's own sign-in). Browse, search and read its notes.
- **Applets.** An applet is one note in your vault: its metadata is the manifest (what it may read and write, which
  kinds of note it opens), its content is the code: one TSX or JSX module, or an HTML page. Any chat AI with the
  Parachute MCP can make one by writing that note: see [docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md). It runs
  sealed, only after you allow it, and changed code asks again.
- **The kit and the look.** An applet imports `parachute`: the data calls (in record words), and a few parts to build a
  screen from (a rich note, a tally of days, a list, a card, a field, an empty state). The whole app and every applet
  follow one theme note in your home vault ([docs/THEME.md](docs/THEME.md)); with none, the built-in one.
- **Open with.** A note's type is its tag. Tap a note and it opens in the applet that claims its type, or in the plain
  vault view, which opens anything. When two applets claim a type, Parachute asks once. Your choices stay on your device.

It runs on Android and desktop (Tauri 2); releases are built for Android and Apple Silicon Macs
([.github/workflows/release.yml](.github/workflows/release.yml), [docs/LAUNCH.md](docs/LAUNCH.md) for what a public
launch still needs). The web build is what the tests drive.

## Build

Needs Node 22+.

```sh
npm ci
npm run dev          # the web build at http://localhost:1420 (the frame's bundle is built once at start: restart after changing src/frame)
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # Playwright on the web build, against a real hub (see below)
```

`npm run e2e` starts a throwaway Parachute hub (`parachute-core` from `@openparachute/core`, which runs on Bun 1.4+) in
a temp folder on a loopback port, seeds a vault from `e2e/fixtures`, and removes it after. Point `PARACHUTE_CORE` at
the binary if it isn't on your `PATH`.

## How it fits together

Two layers. The **shell** (`src/shell/`, started from `src/main.tsx`) is small and fixed: it holds the key, the sign-ins
and their tokens, the applets' grants and their card, the self-test, and the screens that use them (adding a vault, an applet's
screen, Settings, a link from outside). The **frame** (`src/frame/`: the launcher, a vault, a note, open-with and its
sheet) is its own bundle (the `virtual:frame-kit` Vite plugin) that the shell runs in a sealed frame: a srcdoc iframe with
`sandbox="allow-scripts"`, an opaque origin, no network and no storage of its own. It reaches the shell only through one
typed message interface, `src/bridge/protocol.ts`, which reads vaults (never a token), lists applets with their status,
keeps the person's "Always" choices and moves the person between addresses. Nothing in it grants: Allow is the shell's
own button. A tap counts only when the shell sees the person's live user activation. The frame exists only while one of
its addresses is shown (a shell screen removes it), and it asks at most a few hundred things in ten seconds. Its CSP
lets a note's pictures load only from inside the note (data:), not from the web; links out (web, mail, phone) open
through the shell, during a tap. A tap counts for the frame only while the frame has the focus.

**The frame can come from the home vault.** The built-in frame is itself one TSX module (`src/frame/default-frame.tsx`)
that the shell transpiles and runs like any other. A note tagged `parachute-frame` in the person's home vault (Settings
picks it; by default the first vault signed in to) runs in its place once the self-test has passed and the person
allowed that exact code on the frame's card. Changed code asks again, the last allowed copy runs offline, and a frame
that stops gives way to the built-in one. "Make this mine" copies the built-in frame into the vault (copy-on-write); a
newer built-in frame is then offered in Settings, never written over theirs. See
[docs/CHANGE-YOUR-FRAME.md](docs/CHANGE-YOUR-FRAME.md) and `src/shell/frameSource.ts`.

**Moving around** is one model ([docs/NAVIGATION.md](docs/NAVIGATION.md)): the launcher for everything, a bar at the
foot for the pinned places and the home applet, Back to where you came from, a note in its applet. The bar is the
shell's (`src/shell/BottomBar.tsx`), drawn under the frame and under applets; what is on it is one settings note in the
home vault (`src/shell/homeSettings.ts`), which the person's agent can write. Open on start (`src/shell/start.ts`) runs
an applet by itself only when this device holds both its Allow and the person's choice of it as home.

- `src/vault/`: signing in (OAuth with PKCE and dynamic registration, one sign-in per vault), the vaults this device
  holds, the client.
- `src/key/` and `src-tauri/src/{key,pairing,door}.rs`: the person's Nostr key. The secret never reaches the web side:
  Rust keeps it (Android Keystore through `KeyPlugin.kt`, the desktop keyring), receives it by pairing (NIP-AB, the
  receiving side of what the Uni app and Buzz desktop send, on buzz-core), and signs the hub's key door
  (`/api/auth/nostr/challenge` and `/verify`, the same on hub 0.8 and 0.9). The door starts a hub session, which the
  shell puts in the webview; the hub's usual authorize page then gives the vault token, so a key sign-in and a password
  sign-in hold a vault the same way. A hub without the door (Cloud today) is signed in to on its own page.
- `src/applet/`: an applet as Parachute reads it. The manifest (`metadata.applet`, contract 2) is read exactly as the Uni
  app reads it, so one HTML applet note runs in both (the Uni app doesn't run TSX); what it opens goes beside it in `metadata.opens`. Its code (`code.ts`):
  the note's extension says html, tsx or jsx; TSX/JSX is transpiled in the app with sucrase (small, pure JS, offline),
  cached against the code's hash, and run with React provided as an import. The sealed frame,
  its kit (`window.uni`, also `window.parachute`), the grant card and the sandbox self-test, which runs by itself and
  decides whether applets run here at all (sealed on desktop, approved code only on Android).
- `src/open/`: open with. The rule (`resolve.ts`, used by the frame); the defaults kept on this device and the tap marks,
  so an applet starts only on a person's tap (the shell's). The note's route, the sheet and long-press are the frame's.
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
