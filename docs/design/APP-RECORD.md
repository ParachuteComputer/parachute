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
note names. An org's app is followed live (`live`): read from their vault each time. A record made for a newer
Parachute says so with `needs`, and an older one then opens the next app it can and says to update; a key it doesn't
know in a place is left out (docs/design/VERSIONS.md).

## Running needs a signed approval

On a device that holds the person's key, **Allow is an approval for every device**. The app asks the passcode (when
this device's level for approving code says so, "Security levels" below), then the device unlock, then the native side (`src-tauri/src/approve.rs`) signs a kind 30479
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
every device gets the same one; and of what that device left out of its card (an applet in a vault that is someone else's
there gets no server; a server at one of its own hubs is refused), so a device that reads more into the note than the
one that approved asks for itself.

**Which keys count.** Without a root key (most people, and Aaron today): the person's key this device holds. With the
root key's public half put on the device (Settings → Approving code → Root key): the keys on the newest list in
`Parachute/Keys` that the root signed (kind 30480), and before one is read, the root itself. Rotating keys is #systems'
(T-487); the app only reads and checks the list.

**On each device.** A device that finds an approval for the exact code it is about to run allows it there too (its own
grant, which ends when the approval does), when it already holds what the applet needs at the hub; otherwise its card
says "You approved this exact version on …", and **Continue** asks the hub, as on the first device. Changed code finds
no approval for its hash, so its card shows on every device until one approves the new version. **Revoke** on any
device (the applet's menu, or Settings → Applets) signs a taking back (`"approved": false`), and every device that reads
it stops the applet.

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
approved until its year ends). A device that already allowed an applet starts it at once and reads the signed
approvals in the background. A taking back made on another device stops it only when that read lands: the next open,
or when a kept screen is shown again. It does not stop it while the home vault can't be reached. Reading before every
start would close this, at the price of a vault read on every open (found in review, T-476; not built).
A brand-new device served last month's code with last month's approval runs it: code
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
- a record can raise the security levels, never lower them ("Security levels" below): each device keeps its own
  natively and takes from the open app's record only what is stricter, so a record that later says less, breaks, goes,
  or is replaced by another app that says less (named in the settings note) leaves them as they are; an app someone
  else offers, followed live, asks each level as the stricter of theirs and the person's own record for it. Lowering is
  the person's signed approval from an unlocked device.

Tests: `src/shell/appTrust.test.ts` (each field, raised never lowered, the live merge) and `e2e/thinshell.spec.ts` (a hostile
record opens the home on its card, its pin asks, nothing is granted). A record that doesn't load leaves the plain list
with *Your app record didn't load* and Settings ([NAVIGATION.md](../NAVIGATION.md#a-way-back)).

## Security levels

Aaron (11-18): "the app itself should be able to have specified levels of security… require a password to do anything
if I haven't touched it for X many minutes", and "for some things the key + a passcode would be nice… to get onto my
personal wireguard". One small gate the shell keeps natively (`src-tauri/src/levels.rs`), not a policy engine: a level
per action, the idle lock, and the grace. The web side never says which level holds or that the person unlocked.

| Action | Choices | Default | What it covers |
|---|---|---|---|
| `approvals` | none, unlock, passcode | unlock | Uni's routine approval cards and held sends (KEYRING.md). A powerful card always asks at least the unlock, fresh |
| `code` | unlock, passcode | unlock | approving an applet's code (above). Never below the unlock; taking an approval back asks only the unlock |
| `join` | none, unlock, passcode | passcode | asking to join a private network: an http service's `join` op (KEYRING.md "Joining a network") |
| `idle` | minutes, 0 = off | off | untouched this long, Parachute is covered until the device unlock |

**none** is the tap alone; **unlock** the device unlock (KEYRING.md "Unlock"); **passcode** this device's passcode,
then the unlock. The passcode is a secret of the person's own, not the phone's PIN, set in Settings → Security, kept
only as a salted hash of many rounds in the app's data folder and checked natively (five wrong and it waits a minute; the count is kept on disk, so swiping the app away doesn't reset it).
A passcode level on a device with no passcode is refused, never passed with the unlock alone. Every leveled action
asks it each time; no grace covers it.

**The grace**: 5 minutes after an unlock, routine approvals in the applet that earned it go through without another
(each one says so over the applet). It ends when the screen goes off (Android), when the idle lock engages, and when
the app is swiped away. Desktop gives none yet (PARITY.md).

**The idle lock**: the native side keeps the last touch: the shell's own input, an applet's call while the browser
says the person is acting (that activation reaches the shell's window from any frame, and a page can't make it up),
and on Android every touch the activity gets, scrolling inside an applet included, with the longest quiet gap between
two. Past the minutes, a cover goes over everything (applets kept below, untouchable) and the device unlock opens it;
a touch never does, every unlock-gated call refuses meanwhile, and any grace ends. The last touch is kept on disk, so
a restart past the minutes starts locked. No polling: one timer to the moment it would lock, and a check when the app
comes back to the front. A browser tab has no idle lock (it has no key and no unlock to ask).

**In the app record**, `security` names any of them:

```json
"security": { "approvals": "passcode", "code": "unlock", "join": "passcode", "idle": 10 }
```

**A record only raises.** Each device keeps its own levels (`levels.json` in the app's data folder). Reading the open
app's record, it takes what is stricter (a shorter idle lock is stricter; off is the loosest) and nothing else. An
unknown word is left out, never read as "none"; the record's older `approve` means `code`.

**Lowering takes the person's signed approval from an unlocked device**, the same as approving code. Settings →
Security: a stricter choice is a tap (kept on the device at once and written to the record, so the person's other
devices follow). A looser one, or the idle lock turned off, asks the passcode (when the device keeps one) and the
unlock; then the key signs a kind 30479 approval of exactly the new levels (subject `security-<app id>`, applet
`security`, `code` = `levels:v1:approvals=…,code=…,join=…,idle=…`), kept at `Parachute/Approvals/<host>/<vault>/security-<app id>`,
and the record's `security` is written. Another device whose levels are stricter than its record takes the record's
only when that approval checks (`decide`, then Rust again: signed with the key this device holds, newer than its own
last change, levels exactly the record's). So someone who can write the vault can raise a device, never lower it
(`levels.rs` and `levels.test.ts`: an unsigned edit, an edited or foreign signature, an older approval put back,
another app's moved over).

| Who | Tries | Result (test) |
|---|---|---|
| A vault writer (a token, an agent, the hub) | `security` edited looser | Nothing changes (`levels.test.ts`, `levels.spec.ts`) |
| | With an approval of their own key, or an edited one | Refused (`levels.rs`, `levels.test.ts`) |
| | With the person's approval for another app | Not taken: the web side's `decide` checks the record names this app (`levels.test.ts`); Rust checks it is a lowering's record signed by the person |
| | An old lowering put back after a raise | Refused on a device that applied the raise: dated before its last change (`levels.rs`). A device that never saw the raise (offline, or new) takes it: the person's older choice, said below |
| | `approval_sign` (code's gate) used to sign a lowering | Refused: an applet's approval never names a `security-` record or levels (`approve.rs`); a lowering counts only with that record (`levels.rs`) |
| Someone holding the unlocked phone | Approves at a passcode level with the unlock | Refused (`levels.rs` `a_passcode_level_refuses_the_device_unlock_alone`, `levels.spec.ts`) |
| | Turns the idle lock off, or a level down | Needs the passcode (when kept) and the unlock |
| Someone picking up the phone later | Uses the app past the idle lock | Covered; a touch doesn't open it (`levels.rs`, `levels.spec.ts`) |

**Gaps, said plainly.** A device that never read a raise (offline, or installed since) can take an older lowering of
the person's that the vault serves it: a vault writer can put back an older signed choice, never make one. Signing
raises too would not close it (the vault can hold back the newer signature as well) and would make every stricter tap
ask the unlock. A device with a root key and a key list takes only lowerings signed with its own key (lower there
too). Desktop and the web side see touches the shell's window sees: reading in an applet for longer than the idle
lock without a tap or a key can lock it on a computer (Android counts scrolling).

## Saved state (docs/WRITE-AN-APPLET.md "Saved state")

What an applet gives the kit (`useSaved`, `parachute.saved`) reaches the shell 250 ms after the last change and is
written to a file of its own on the device (synced, then renamed); it comes back in `ready` before the first paint,
after a hide, an unload, the app closing or a reboot. Revoke, and signing out of its vault, remove it. Keep-alive is then speed only: 6 on a phone, 12 on a computer, or
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
| The gateway | Which of its registered keys have signals, an opaque id per applet, the signal ids, the counts and when they move | Any note, message or mail. Which applet, vault or hub, unless the gateway's operator also reads the hub (the id is an unsalted hash of hub, vault and record, so known records match it; T-476) |
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
| `security.approve` in a record, and "a passcode set here means approving code asks it" | `security.code` and the levels (a device that kept a passcode before keeps `code: passcode`) | now: `approve` is still read as `code` until no record says it (Uni to check Aaron's, then drop the alias) |
| The passcode under Settings → Approving code | Settings → Security | now |
| The grace ending when the app leaves the screen | ending when the screen goes off (Aaron, 11-18) | now |
| `src/shell/appFloor.ts` (#73: a web-side, per-home floor for `security.approve`, raised by every app record in the home) | the native levels (device-wide, raise-only, lowered only by a signed approval), raised by the app a device opens: a record of an app this device doesn't open raises nothing here | now (its `parachute.app.floor.v2` key is no longer read; #73 was in no release) |
| Rooms' message notifications as the only thing heard while closed | signals (the message push stays: it opens the room) | nothing removed; `notify` stays the relay's declaration a signal points at |
