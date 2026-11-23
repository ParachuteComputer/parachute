# Parachute app: privacy policy

Last updated 2026-11-23. This covers the Parachute app for Android, Mac and the web, made by Open Parachute, PBC.
Questions: hello@parachute.computer.

## The short version

The app keeps nothing about you for us. It has no analytics, no ads, no trackers and no crash reporting. It talks only
to the places you sign in to or add: your Parachute (a hub you run, or one an org or a friend runs, or Parachute
Cloud), and the relays, push services and sites your applets name. What you write goes there and nowhere else.

## Where your data goes

- **Your Parachute.** Your notes, journal, files, pictures, voice notes, people and rooms live in vaults on the
  Parachute you sign in to. The app reads and writes them there, over https. Whoever runs that Parachute holds them:
  you, your org, a friend, or us if you choose Parachute Cloud. What Parachute Cloud stores, and how to delete it, is
  in its part of https://parachute.computer/privacy/.
- **Rooms and messages.** Messages go to the relays your rooms use, signed with your key.
- **Notifications while the app is closed (Android).** If an applet asks for them, the app registers this phone's push
  address with the push service that applet names, through the UnifiedPush app on your phone (ntfy or another). The
  push service learns that address, the relay, and which rooms and keys to tell you about; what it sends holds no words. If you
  have no UnifiedPush app, the app keeps its own connection to the relay instead, and Android shows that it is running.
- **Pairing.** When you pair your key from another device, it comes over the relay named in the pairing link,
  encrypted end to end. The relay can't read it.
- **Applets.** An applet can reach only the services you allowed on its card, and it asks before it uses a new one.
- **Parachute's own applets** (Notes, Journal and the rest) come inside the app; nothing is fetched for them. If a later
  version checks parachute.computer for newer signed copies, this page will say so first.
- **Updates (only builds downloaded outside the app stores).** Such a build may check its update list on the site it
  came from. That request carries nothing about you. Builds from Google Play or Apple are updated by the store.

We never sell data, never share it with advertisers, and never use it to train AI.

## What stays on your device

Your Nostr key is kept by the device's own key store (Android Keystore, or the Mac's Keychain), and leaves only when
you pair it to another device of yours. The app also keeps, on this device only: which Parachutes you signed in to and
their sign-in tokens, drafts, your passcode's hash, the approvals you gave, and settings. None of it goes into Android's
backup or a device-to-device transfer. On Android, uninstalling the app removes it. On a Mac, moving the app to the Bin
leaves it behind: also delete the folder `~/Library/Application Support/computer.parachute.app` and, in Keychain
Access, the item `computer.parachute.app`.

## Permissions

- **Microphone:** only while you record a voice note, after you press Record.
- **Camera:** only to scan a pairing QR code. The picture isn't kept or sent.
- **Notifications:** to tell you about messages, when you allow it.
- **Files you pick:** read only when you choose them, to add them to your vault.
- **Biometrics or device unlock:** to confirm an approval, if you turn that on. The app never sees your fingerprint.

## Deleting your data

Your vaults are yours to delete on your Parachute. On Parachute Cloud, deleting a vault or your account deletes what it
held (https://parachute.computer/privacy/, "Deleting your data"); or email hello@parachute.computer. Data on this device
goes when you sign out or uninstall the app.

## Children

The app isn't made for children under 13, and we don't knowingly hold their data.

## Changes

If this changes in a way that matters, we update the date above and say so in the release notes. The app's code is
open: https://github.com/ParachuteComputer/parachute.
