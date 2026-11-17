# Parachute 0.1.0 (pre-release)

The first build for people to try: one app for your Parachute vaults and the applets that grow on them. It is early.
Expect rough edges and say what you find in [issues](https://github.com/ParachuteComputer/parachute/issues).

## Downloads

| File | For |
|---|---|
| `Parachute_0.1.0_arm64.apk` | Android 8 or newer, 64-bit ARM. Install it by opening the file (allow installs from your browser or file manager). |
| `Parachute_0.1.0_aarch64.dmg` | Macs with Apple Silicon, macOS 11 or newer. See [docs/INSTALL-MAC.md](docs/INSTALL-MAC.md): it isn't notarised, so macOS asks once. |
| `Parachute_0.1.0_aarch64.app.tar.gz` | The same Mac app, without the dmg. |
| `SHA256SUMS` | Check a download: `shasum -a 256 -c SHA256SUMS --ignore-missing`. |

## What works

- **Sign in with your Nostr key.** Pair it from the Uni app or Buzz desktop (encrypted end to end; a 6-digit code to
  check), make a new one, or paste one. It stays in the Android Keystore or the Mac's Keychain, never in the web side.
- **Your Parachutes.** Sign in once per hub (0.8 or 0.9) with your key, a password, or Parachute Cloud's own page, and
  every vault you can reach there comes with it, grouped by Parachute in the launcher. The list of your Parachutes is
  kept in your home vault, so a new device finds them all.
- **Other Parachutes.** Add an org's Parachute as someone else's; bring its applets into your launcher and put its
  components on your home, each in its own sealed frame with its own card, seeing only what that card allows of their
  vault ([docs/OTHER-PARACHUTES.md](docs/OTHER-PARACHUTES.md)).
- **Read your notes.** Browse, search and read a vault's notes; a note opens in the applet that claims its type, or in
  the plain view.
- **Applets.** An applet is one note in your vault (TSX, JSX or HTML) that a chat AI with the Parachute MCP can write
  ([docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md)). It runs sealed, only after you allow it, and asks again when its
  code changes. A small kit (`parachute`) gives it record calls and parts to build a screen from.
- **One look.** The app and every applet follow one theme note in your home vault ([docs/THEME.md](docs/THEME.md)).
  Make the launcher your own with a frame note ([docs/CHANGE-YOUR-FRAME.md](docs/CHANGE-YOUR-FRAME.md)).
- **Applets that talk to servers.** An applet can name its servers; the card says each and what the app signs there as
  you, and the app talks to them for it with your key, which the applet never holds. The first: Rooms (your rooms on a
  Buzz relay, with Uni's cards), Mail (through a mail gateway), Journal and Matrix ([docs/PARITY.md](docs/PARITY.md)).
- **Links in.** `parachute://open?url=<a note's address>` opens a note.

## What doesn't yet

- **Editing notes in the app.** The plain view reads; applets can write. Write from your agent or another client.
- **Stores and updates.** Not on Google Play or the App Store. The APK is signed with a play-test key, and the Mac app
  is ad-hoc signed and not notarised. There is no update channel: download the next release by hand. After a Mac
  update, macOS asks once whether Parachute may use the key in your Keychain.
- **Other platforms.** No iPhone, iPad, Windows or Linux download. Linux builds from source (`npm run tauri build`);
  Windows is untested.
- **Key sign-in everywhere.** A hub needs the key door (`parachute-core` 0.8 and later). Parachute Cloud signs you in on
  its own page for now. A hub's owner has to link your key to your account first.
- **Scanning on a Mac.** The Mac has no QR scan for pairing: copy the pairing link and paste it.
- **Crash reports.** None are sent. If the app misbehaves, tell us what you did.
