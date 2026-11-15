# Parachute

One app for your vaults and the applets that grow on them.

- **Vaults.** Add a vault on any Parachute hub by its address and sign in there. Browse, search and read its notes.
- **Applets.** An applet is a note in your vault: one HTML file and a manifest saying what it may read and write, and
  which kinds of note it opens. It runs sealed, only after you allow it.
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
