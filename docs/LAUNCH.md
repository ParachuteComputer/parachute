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

**Recommendation:** register as an *organisation* on Google Play (a new personal account must first run a closed test
with 12 testers for 14 days; an organisation needs a D-U-N-S number instead). Use Play App Signing: Google keeps the
app's signing key, we keep only an *upload* key, made new for Play and stored like the play-test key. People who
installed a play-test APK reinstall once when they move to the Play version (a different signature can't update it).
Play also needs a privacy policy URL and the Data safety form, and each upload a higher `versionCode` (now fixed at 1
in `src-tauri/tauri.conf.json`: derive it from the version before the second release).

## 2. Apple notarisation

**Now:** the Mac app is ad-hoc signed. macOS asks once before opening it (docs/INSTALL-MAC.md), and after each update
asks again whether Parachute may use its Keychain item, because every build has a new signature.

**Recommendation:** join the Apple Developer Program as an organisation (99 USD a year; needs a D-U-N-S number), make a
*Developer ID Application* certificate and an App Store Connect API key, and add them as secrets: `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, and the key file. Tauri
signs and notarises with exactly these; `mac.yml` then signs with the identity instead of `-`. Notarised, the app opens
with no Gatekeeper step, and a stable signature ends the Keychain question after updates.

## 3. An update channel

**Now:** none. People download each release by hand.

**Recommendation:** on the Mac (and later Windows and Linux), Tauri's updater plugin, reading a signed `latest.json`
that the release workflow attaches to each GitHub release; its signing key is one more secret
(`TAURI_SIGNING_PRIVATE_KEY`). It should wait for notarisation, so an update doesn't bring back the Gatekeeper step. On
Android, Google Play once the app is there. Until then, testers can point Obtainium at this repository's releases: it
installs and updates the APK straight from them.

## 4. Crash reporting

**Now:** nothing is sent. The app holds a person's key and reads their private notes, so any report has to be careful.

**Recommendation:** off by default and opt-in, asked once after the first crash, showing what would be sent: Rust
panics and uncaught web errors with the stack and app version, never note content, addresses, tokens or keys. Send
them over the Sentry protocol to a self-hosted GlitchTip behind Cloudflare, so no third party holds them. If that is
more than launch needs, a "Copy a crash report" button that people paste into an issue is the smallest honest start.

## Smaller things before launch

- **Identifiers are for good.** `computer.parachute.app` (Android package, Mac bundle id, Keychain service) and the
  `parachute://` scheme can't change once in a store. Confirm them.
- **Other platforms.** iPhone and iPad need the Apple account above and an iOS shell (key store, pairing scan).
  Windows builds are untested.
