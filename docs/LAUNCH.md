# What a public launch still needs

0.1.0 can go out as a GitHub pre-release today (`.github/workflows/release.yml`). These are what stand between that and
a launch for people who won't read install notes. Each has a recommendation; none is done yet.

## 1. Android signing for Google Play

**Now:** the APK is signed with a play-test key. Locally it is described by `~/.config/parachute-playtest/keystore.properties`;
in CI it comes from four repository secrets, which are **not set yet**:

| Secret | What |
|---|---|
| `PLAYTEST_KEYSTORE_BASE64` | the keystore file, base64 (`base64 -w0 playtest.jks`) |
| `PLAYTEST_KEYSTORE_PASSWORD` | its store password |
| `PLAYTEST_KEY_ALIAS` | the key's alias |
| `PLAYTEST_KEY_PASSWORD` | the key's password |

Without these secrets a tag's release fails, and a dry run signs with a key made for that run (the file is named
`-dry-run-key`). The passwords must not contain a backslash (`\`): the properties file reads it as an escape.

**Google Play:** the plan, the Play build (an app bundle with no in-app update, signed with an upload key) and what is
left are in [STORES.md](STORES.md).

## 2. Apple notarisation

**Now:** the Mac app is ad-hoc signed. macOS asks once before opening it (docs/INSTALL-MAC.md), and after each update
asks again whether Parachute may use its Keychain item, because every build has a new signature.

**Wired, waiting for the keys:** `mac.yml` signs with a Developer ID certificate and notarises the app and the dmg once
the five Apple secrets are set; [STORES.md](STORES.md) says which, and why a notarised dmg rather than the Mac App Store
for now. Notarised, the app opens with no Gatekeeper step, and a stable signature ends the Keychain question after
updates.

## 3. An update channel

**Now:** a build made with `PARACHUTE_UPDATE_FEED` (the address of a `latest.json` beside the builds) reads it at start,
when it comes back to the front (at most every six hours) and when Settings opens, and offers a newer build: one line
above the bar ("A newer Parachute is ready", **Download**, **Later**) and Settings → Updates. On Android, Download
installs it from inside the app: the shell reads the feed itself, downloads the APK it names (from the feed's own origin
only), checks it against the feed's `sha256`, looks at it (Parachute, newer than this build, same signer) and hands it
to Android's installer (a PackageInstaller session, UpdatePlugin.kt). Android asks once for the right to install apps,
then before each update, and installs it only when it is signed with the same key: that is the trust. A refusal is said
in words (a different signer, an older file, blocked by the system, cancelled), and each try is remembered, so after a
restart Settings says whether the update took or this is still the old build. A feed written before `sha256` still
works; the app says it couldn't check the file. When the download itself fails, Settings also offers the browser's
download. On the Mac, Download opens the file in the browser and the person installs it. The feed names files on its own
origin only, and nothing from a vault or an applet can change where a build looks (src-tauri/src/updates.rs,
src/shell/updates.ts). `scripts/update-feed.sh` writes the feed with each file's sha256, last, after the files are in
place. A build's identity is its commit and that commit's time; the time is also the APK's Android version code, so each build
of next installs over the one before (the Play bundle counts commits instead: docs/STORES.md). Mac builds of next get the feed from the repository secret `PARACHUTE_UPDATE_FEED`
(none: no updates offered). Builds without a feed offer nothing.

**Recommendation for launch:** on the Mac (and later Windows and Linux), Tauri's updater plugin, reading a signed
`latest.json` that the release workflow attaches to each GitHub release; its signing key is one more secret
(`TAURI_SIGNING_PRIVATE_KEY`). It should wait for notarisation, so an update doesn't bring back the Gatekeeper step. On
Android, Google Play once the app is there; its build drops `REQUEST_INSTALL_PACKAGES` and has no feed
([STORES.md](STORES.md)). The feed above is for builds made by
hand or from next (the release workflow passes none, and GitHub's release downloads answer with a redirect, which the
app doesn't follow); until then testers can point Obtainium at this repository's releases.

## 4. Crash reporting

**Now:** nothing is sent. The app holds a person's key and reads their private notes, so any report has to be careful.

**Recommendation:** off by default and opt-in, asked once after the first crash, showing what would be sent: Rust
panics and uncaught web errors with the stack and app version, never note content, addresses, tokens or keys. Send
them over the Sentry protocol to a self-hosted GlitchTip behind Cloudflare, so no third party holds them. If that is
more than launch needs, a "Copy a crash report" button that people paste into an issue is the smallest honest start.

## Smaller things before launch

- **Identifiers are for good.** `computer.parachute.app` (Android package, Mac bundle id, Keychain service) and the
  `parachute://` scheme can't change once in a store. Kept, for the reasons in [STORES.md](STORES.md).
- **Other platforms.** iPhone and iPad need the Apple account above and an iOS shell (key store, pairing scan).
  Windows builds are untested.
