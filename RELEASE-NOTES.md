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
- **Your Parachutes.** Sign in once per hub (0.8 or 0.9) with your key, a password, or Parachute Cloud's own page. It
  asks to read your home vault only; each other vault is an **Open** line in Settings, and an applet asks your hub
  for its own vault (read, or change notes) when you allow it, and gives it back when you revoke it
  ([docs/design/SCOPES.md](docs/design/SCOPES.md)). The list of your Parachutes is kept in your home vault, so a new
  device finds them all.
- **Other Parachutes.** Add an org's Parachute as someone else's; bring its applets into your own Parachute and put its
  components on your home, each in its own sealed frame with its own card, seeing only what that card allows of their
  vault ([docs/OTHER-PARACHUTES.md](docs/OTHER-PARACHUTES.md)).
- **Your bundle.** The app opens on the home applet your bundle names (`Parachute/Bundles/<id>`; called an app record before 11-20), the bar is that
  record's pins in its order, then **Applets**: one list of the app's applets, and last **Settings**, on every screen
  (no record can take it off). Vaults are in Settings; a vault of yours the bundle draws from and this device doesn't read
  yet also ends the list (**Not open here yet**, **Open library**), so its applets aren't missed. *Changed:* the
  bar no longer puts your home first by itself: pin it (its **Pin**, in Applets or at its top) to keep it there.
- **Pin, one tap.** Every applet has **Pin** on its row in Applets and in its own top bar; **Pinned** when it is on the
  bar, and a tap takes it off. Written to your bundle, so your other devices follow. (The list's long-press no longer
  offers **Pin to the bar**.) On a phone, **Applets** and **Settings** stay at the bar's edge however many are pinned.
  A record that doesn't load leaves you the list and Settings ([docs/NAVIGATION.md](docs/NAVIGATION.md)).
- **Vault**, Parachute's own viewer: your vaults, each one's types with counts, a type's records as a table (sort,
  filter, group, saved views), a record's fields (changed where they stand), words, links both ways and history; what
  your AI writes appears while you look; **Changes** shows what changed, by whom (your AI by its key's name), each
  before and after, and puts a change or a whole run of them back; Sharing lists who reaches a vault, every key, AI and app by name, ends any of them with one tap, and gives an AI a key to some of its types (on a hub with the list: core T-476). One tap adds it ([docs/VAULT.md](docs/VAULT.md)).
- **Your notes.** Browse, search and read a vault's notes; a note opens in the applet that claims its type, else in
  Vault once it is added, else in the plain view. A typed record shows its fields (name and value). Write a new note and edit a note's words and
  fields in the app.
- **Parachute Simplified** for a Parachute Cloud person: Notes across the vaults you've opened, Journal, Capture (text or
  voice into Inbox/), Vault and Connect an AI ([docs/SIMPLE.md](docs/SIMPLE.md)). *Changed:* it was called Simple, and
  Journal and Vault are new on its bar.
- **Applets.** An applet is one note in your vault (TSX, JSX or HTML) that a chat AI with the Parachute MCP can write
  ([docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md)). It runs sealed, only after you allow it, and asks again when its
  code changes. A small kit (`parachute`) gives it record calls and parts to build a screen from; it writes a
  record's fields, types and tags too, so what it changes is what your AI reads back.
- **One look.** The app and every applet follow one theme note in your home vault ([docs/THEME.md](docs/THEME.md)).
  Make the screens around your notes your own with a frame note ([docs/CHANGE-YOUR-FRAME.md](docs/CHANGE-YOUR-FRAME.md)).
  *Changed:* an applet with no CSS of its own is drawn in the theme too (plain HTML: titles, lists, tables, buttons,
  fields), inside the kit's page margins; an HTML applet can use the parts' `pa-` classes; and an applet's own CSS now
  wins over the kit's whatever its specificity ([docs/THEME.md](docs/THEME.md#the-order-of-styles)). An applet
  that sets its own body margin lays out as before; `body { margin: 0 }` draws edge to edge. Settings → Look picks the style (Paper, the new
  default; Almanac, the earlier look; Book) for every device, and This screen picks Daylight, black on white, for an
  e-paper screen alone (a screen that says it is e-paper gets it by itself).
- **Applets that talk to servers.** An applet can name its servers; the card says each and what the app signs there as
  you, and the app talks to them for it with your key, which the applet never holds. The first: Rooms (your rooms on a
  Buzz relay, with Uni's cards), Mail (through a mail gateway), Journal and Matrix ([docs/PARITY.md](docs/PARITY.md)).
- **Links in.** `parachute://open?url=<a note's address>` opens a note.
- **Note links in applets.** A note's address (`https://<hub>/vault/<vault>/view/<id>`, the one form written),
  Uni's `uni:<ULID>` in a room and a `[[wikilink]]` in a note open the note in the app, through the kit
  ([docs/WRITE-AN-APPLET.md](docs/WRITE-AN-APPLET.md#links)). Rooms, Journal, Mail and Area ask for `open` to do it.

- **Applets hold only the vaults you tick** (11-23, [docs/ACCESS.md](docs/ACCESS.md) proposal 5). Vault, Notes,
  Connect and Home, and any applet that reaches across vaults, reach your home vault until you tick more: on its card,
  on the line over it (*Vault reaches kitchen · Change*), in its menu (**Vaults it reaches**) or in Settings → Applets.
  The pick is signed with your key, so every device of yours follows it and nothing without the key can widen it.
  - **Journal and Capture keep their notes where you pick** (*Journal keeps its notes in kitchen · Change*): one of your
    own vaults; notes written before stay where they are. Home's line into Inbox/ follows Capture.
  - **Update every device.** A build from before 11-23 doesn't know picks: there, Vault, Notes, Connect and Home still
    reach every vault that device holds. An applet with a card that you pick for on a new build asks again on an older
    one; allowing it again there drops it back to your home on every device until you pick again.

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
- **Moving to a new phone.** Nothing of the app is in Android's backup or a phone-to-phone transfer (your sign-ins,
  drafts and passcode stay on the device they were made on). On a new or restored phone, pair your key and sign in again.
- **Crash reports.** None are sent. If the app misbehaves, tell us what you did.
