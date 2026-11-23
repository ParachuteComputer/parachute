# Parachute on a Mac

For Macs with Apple Silicon (M1 and later), macOS 11 or newer. The app is not notarised by Apple yet, so macOS asks
once before it opens it.

## 1. Download

- **A release:** the `.dmg` from the [releases page](https://github.com/ParachuteComputer/parachute/releases).
- **The latest build of `next`:** open the newest green run of the
  [Mac workflow](https://github.com/ParachuteComputer/parachute/actions/workflows/mac.yml), and download
  `parachute-macos` under Artifacts (you need to be signed in to GitHub). Unzip it to get the `.dmg`.

## 2. Install

Open the `.dmg` and drag **Parachute** onto **Applications**.

## 3. Open it past Gatekeeper

The first time, macOS says it can't check Parachute for malicious software. Do one of these, once:

- **macOS 15 (Sequoia) and newer:** open Parachute, click **Done**, then go to System Settings → Privacy & Security,
  scroll down, click **Open Anyway** next to Parachute, and confirm with your password.
- **macOS 14 and older:** in Applications, right-click (or Control-click) Parachute → **Open** → **Open**.
- **Or in Terminal**, on any version:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Parachute.app
  ```

After that it opens like any app.

## 4. Sign in with your key

No key? On the first screen, **Sign in with Parachute Cloud** (you're done once it opens on your notes), or **Sign in
with its address** for your own hub, an org's or a friend's, and skip to section 5.

Parachute signs you in with your Nostr key and keeps it in your Mac's login Keychain (under `computer.parachute.app`).
In the Nostr key card on the first screen:

- **Pair from a device that has your key** (best). On your phone, open the Uni app → Settings → **Pair a device**. It
  shows a QR code and a link that starts with `nostrpair://`. Copy the link and get it to your Mac (send it to yourself),
  paste it into Parachute and press **Start**. Check that both devices show the same 6-digit code, then confirm on both.
  Buzz desktop can send the key too (Settings → Pair mobile device).
- **Make a new key** if you don't have one. Parachute shows its public half (`npub1…`); the hub's owner links it to your
  account before it can sign you in.
- **Advanced: paste a secret key** (`nsec1…`) only if you copied it from somewhere you trust.

When you install a newer build, macOS may ask whether Parachute may use the key in your Keychain (each build has a new
signature until the app is signed with an Apple Developer ID). Enter your Mac password and choose **Always Allow**.

## 5. Sign in to your Parachute

Type your Parachute's address (your hub's, like `your-hub.example`; a vault's address works too), say whose it is
(**Mine**, or **Someone else's** for an org's or a friend's: [OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)), and press
**Sign in with your key**. If you run the hub, Parachute first asks which of its vaults are yours (all ticked; untick
another person's) and which one is your home. The hub's own page asks "Approve Parachute?" once, to read your home
vault (it may call Parachute a third-party app). Press **Approve**, and you're back in Parachute. Your other vaults
are counted in Settings, under your Parachute; a tap shows a line each (**Open letters**): each asks your hub when you open it, and an applet asks for more
when you allow it ([design/SCOPES.md](design/SCOPES.md)).
Add another Parachute later from **Add a Parachute** at the foot of the launcher.

- A hub on your tailnet needs Tailscale running on the Mac.
- If the hub says it doesn't know your key, send its owner the `npub1…` it shows.
- **Other ways to sign in** (and **Use Parachute Cloud instead**) open the hub's own sign-in: a password, or Cloud's
  emailed link. Without your key the hub asks twice: to show Parachute which vaults are yours, then to read your home.

## If something goes wrong

- **"Parachute is damaged and can't be opened":** the download was changed or cut short. Download it again, or run the
  `xattr` line above.
- **An applet says "Parachute can't reach … your home vault":** Parachute's own applets (Journal, Notes, Capture, Vault,
  Connect, Home) run in your home vault, and this Mac can't reach the Parachute that holds it: it is off, or this Mac
  kept a home from an older install whose address is gone. Settings → Your bundle → **Home vault**: pick the vault you
  use (it lists only the vaults this Mac holds; open another under your Parachute first). The list of applets says the
  same in one line ("Can't reach recipes just now.") for any vault it can't reach.
- **To remove the key:** Settings → Your key → **Remove from this device**, or delete `computer.parachute.app` in Keychain Access.
- **To uninstall:** drag Parachute from Applications to the Bin. Its data is in
  `~/Library/Application Support/computer.parachute.app` and `~/Library/WebKit/computer.parachute.app`.
