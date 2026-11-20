# The app record, signed approvals and saved state

Built from the design in draft PR #50, with Aaron's answers of 11-18, which change it in three places: **one personal
key** (no separate approval key), **a level per action** (nothing, the device unlock, or a typed passcode), and **an
org's app is live** (its changes show; its code still waits for his approval). The root key is recovery only: written
down, it signs the key list and nothing else. Made-up names in examples.

```
 YOUR HOME VAULT                                         EACH DEVICE WITH YOUR KEY
 Parachute/Apps/<id>       what an app offers   ──────▶  shows it (listing never runs anything)
 Parachute/Approvals/…     this exact code,     ──────▶  checks the signature, hashes the code itself, runs it
                           signed by your key
 Parachute/Keys            which keys count,    ──────▶  only with a root key's public half on the device
                           signed by your root key
```

## Apps (docs/NAVIGATION.md "Apps")

An app is `Parachute/Apps/<id>`: where applets come from (one applet, a vault, every vault on a hub), the bar, the
home, what opens which kind of note, how many applets stay running, how careful it is (`security`). Simple and
Everything are always there. Each device opens one (Settings → **Your app**); a new device opens the one the settings
note names. An org's app is followed live (`live`): read from their vault each time.

## Running needs a signed approval

On a device that holds the person's key, **Allow is an approval for every device**. The app asks the passcode (when
this device has one), then the device unlock, then the native side (`src-tauri/src/approve.rs`) signs a kind 30479
event with the person's key and the app writes it to `Parachute/Approvals/<host>/<vault>/<record id>` (tagged
`parachute-approval`). Its content:

```json
{ "v": 1, "subject": { "hub": "https://uni.example", "vault": "home", "record": "01ROOMS", "applet": "rooms" },
  "n": 1794994200, "approved": true, "code": "tsx:<hash of the code and what it imports>", "scope": "<hash of its asks>",
  "at": "2026-11-18T09:30:00.000Z", "expires": "2027-11-18T09:30:00.000Z", "face": ["…what its card said…"], "device": "Android" }
```

**The rule** (`src/applet/approvals.ts` `decide`): code runs from an approval only when its signature holds, its signer
is a key that counts, it names this record and applet, its number is the highest this device has seen for it, it isn't
dated ahead of the clock or past its year, and its two hashes are the ones this device computes now. The asks' hash is
of the applet's fields as written, with the hub, vault name and record id, never a device's own name for the vault, so
every device gets the same one.

**Which keys count.** Without a root key (most people, and Aaron today): the person's key this device holds. With the
root key's public half put on the device (Settings → Approving code → Root key): the keys on the newest list in
`Parachute/Keys` that the root signed (kind 30480), and before one is read, the root itself. Rotating keys is #systems'
(T-487); the app only reads and checks the list.

**On each device.** A device that finds an approval for the exact code it is about to run allows it there too (its own
grant, which ends when the approval does), when it already holds what the applet needs at the hub; otherwise its card
says "You approved this exact version on …", and **Continue** asks the hub, as on the first device. Changed code finds
no approval for its hash, so its card shows on every device until one approves the new version. **Revoke** on any
device signs a taking back (`"approved": false`), and every device that reads it stops the applet.

**What stays as it was.** A device without the person's key (a browser tab) has no approvals: its own Allow, for
itself, as before. The grants already on a device keep working; they are signed for every device the next time the
applet asks (changed code, its year, Revoke and Allow). Kinds 30479 and 30480 are on no applet's signing path: an
applet signs only the kinds the shell names (9, 7, 40003, 5, 20002), and a Rust test says the two can't be among them.

### What it holds against

| Who | Tries | Result (test) |
|---|---|---|
| Someone who can write the vault (a token, an agent, the hub) | New code, approval left alone | Doesn't run: the hash differs (`signed.spec.ts`, `approvals.test.ts`) |
| | The hash in the approval edited to match | Doesn't run: the signature breaks (both) |
| | Approved with a key of their own | Doesn't run: not a key that counts (both) |
| | Same code, wider asks | Doesn't run: the asks' hash differs (`approvals.test.ts`) |
| | One applet's approval moved onto another | Refused: it names its record (`approvals.test.ts`) |
| | Last month's approval put back, or one taken back put back | Refused on a device that saw the newer one (`approvals.test.ts`) |
| | A key list naming their key | Refused: not signed by the root (`approvals.test.ts`) |
| A device's clock, or a thief | An approval dated far ahead, to block later ones | Refused (`approvals.test.ts`) |
| An applet | Asks the shell to sign kind 30479 or 30480 | Refused (`services.rs` test) |

**Gaps, said plainly.** A device can't know of a taking back the vault hides from it (it keeps running what was
approved until its year ends). A brand-new device served last month's code with last month's approval runs it: code
the person approved, never new code. And the person's key has copies in other software (Uni's tools): anything that
holds it can sign an approval. Making the key on the phone with no export, and other devices signing through it, is
the rotation step (#systems, T-487).

## What an unsigned record can change

Anyone who can write the home vault (the person's agent, a token, the hub) can change an app record without a
signature. So the app reads it for three things only: **the home** (`start`), **the pins** (`bar`) and **the list**
(`sources`, `hide`, `opens`, `keep`, `look`). Everything else in it is read as nothing (`src/shell/apps.ts` `appOf`
keeps only those fields), and none of the three runs code:

- the home opens on its card, or waits for Open, until the person allowed that exact code and chose it as home on this
  device (`start.ts`); a pin or an applet in the list asks on its card the first time, and again when its code changes;
- a record can't grant: a word like `grants`, `approved` or `code` in it is not read;
- a record can raise the approve level, never lower it: `security.approve` other than `passcode` reads as `unlock`, and
  once a device has read `passcode` in any app record of a home vault it keeps asking it for every approval in that
  home, whatever any record says later, or if the record breaks, goes, or another app that says less is named
  (`src/shell/appFloor.ts`); an app someone else offers, followed live, can't lower what the person's own record asks.
  Lowering it again is the person's on the device (the signed way comes with the levels work).

Tests: `src/shell/appTrust.test.ts` (each field, the floor, the live merge) and `e2e/thinshell.spec.ts` (a hostile
record opens the home on its card, its pin asks, nothing is granted). A record that doesn't load leaves the plain list
with *Your app record didn't load* and Settings ([NAVIGATION.md](../NAVIGATION.md#a-way-back)).

## Security levels

`security.approve` in an app record: `"unlock"` (always; no level drops it) or `"passcode"`. The passcode is this
device's own secret, set in Settings → Approving code, kept as a salted hash in the app's data folder, checked by the
native side (five wrong and it waits a minute). When a device has one, approving asks it whatever the record says: a
record can ask for more, never less. Not built yet: the idle lock (unlock to open the app after N minutes) and levels
for Uni's routine approval cards, which stay as KEYRING.md has them.

## Saved state (docs/WRITE-AN-APPLET.md "Saved state")

What an applet gives the kit (`useSaved`, `parachute.saved`) reaches the shell 250 ms after the last change and is
written to a file of its own on the device (synced, then renamed); it comes back in `ready` before the first paint,
after a hide, an unload, the app closing or a reboot. Keep-alive is then speed only: 6 on a phone, 12 on a computer, or
the app's `keep`.

## Signals: badges and notifications (docs/WRITE-AN-APPLET.md "Something for the person")

Aaron, 11-18: "are there ways that things can change on the backend and it leads to little badges in the app to show
there's something from that applet?" An applet declares in `fields.signals` what counts as something for the person
(on its card, and in its key and the asks' hash only when declared). The count is the badge on the bar; on a phone the
same count is the notification while Parachute is closed. Nothing of the applet runs to count it.

| Signal | Example | Who counts it | When |
|---|---|---|---|
| a relay service's `notify` | Rooms: mentions and Uni's messages | its push gateway (services/push-gateway): each message it would push adds one | always, the app closed or not |
| notes in its own vault | Ideas: notes someone else adds to `Ideas/` | the app, from the vault's own live subscription (`others`: a note whose `createdBy` isn't this sign-in's) | while the app is open on some device |
| an http service's feed | Mail: unread mail | the applet itself, `signal("unread", n)` while it runs | while Mail runs |
| none | Journal | nobody | never |

**The count lives in the push gateway** when the signal names one (`via`; a relay's goes through its `notify.gateway`):
one number per person, applet and signal. Devices tell it the counts they move (`POST <gateway>signals`, signed NIP-98
by the shell: the applet as an opaque id, a hash of its hub, vault and record; the signal's id; the number) and read
back what it holds, at start, on every change and when the app comes to the front. A change is pushed to the person's
phones, sealed: `{v, kind: "signal", subject, signal, count, to}`. The phone shows "Ideas · 2 new" over the signal's
name; a 0 (opened on another device) takes it away. Opening the applet makes its counts 0 everywhere.

Why the gateway and not somewhere simpler: it already holds the person's push endpoints and watches the relay, so the
relay signal is counted where the messages are already matched, and one place holds the number every device and the
closed phone read. The hub would be the simpler home for a vault signal (it has the notes and the matcher), but today
it can only tell another server about a note by sending the note itself (core's webhook triggers, admin only) or its
preview (the live subscription): either would put words in the gateway. So a vault signal is counted by the open
app and only the number reaches the gateway. **Gap, said plainly:** while every device is closed, a new idea is
counted when one opens, not before; Rooms is counted all the time. The fix is a count-only hub hook (core: a trigger
that sends `{trigger, event}` and nothing of the note, registrable with read scope to a gateway the hub's operator
lists); the gateway then adds one per event. A mail server reporting its own count would close the same gap for Mail.

| Who | Learns | Never |
|---|---|---|
| The gateway | Which of its registered keys have signals, an opaque id per applet, the signal ids, the counts and when they move | Which applet, vault or hub; any note, message or mail |
| The push server | That ~200 sealed bytes arrived | Anything in them |
| The hub | Nothing new: the app's subscription is the person's own sign-in reading a folder it may read | |

## Subtract

| Old | Replaced by | Goes |
|---|---|---|
| A device-only Allow on a device with the key | the signed approval (the grant stays as each device's copy) | now |
| "Make a separate approval key" (KEYRING.md) | one personal key (Aaron, 11-18) | now: not offered; one made before can still be removed |
| `KEEP = 3`, `parachute.applet-storage.v1:*` | `keep`, the saved store | now (copied once) |
| "The launcher is for everything" | the open app | now |
| The launcher's vault chapters, masthead (the week's line, its tally, the hills) and "Lately in" | the list of the app's applets; the home applet for the first page; Settings for vaults | now (11-19, T-476 thin shell) |
| The launcher and the home placed on the bar by the app | the record's pins, then Applets | now (11-19) |
| `bar` and `start` in `Parachute/Settings` | the app record | when no device runs a build from before 11-19 (date for Uni to set) |
| Draft PR #50 | this note | closed 11-19, when #66 merged |
| Rooms' message notifications as the only thing heard while closed | signals (the message push stays: it opens the room) | nothing removed; `notify` stays the relay's declaration a signal points at |
