# The keyring, approvals in applets, and what else an applet may ask of the shell

SERVICES.md let an applet reach servers with the shell signing for it, and kept one thing out: "an applet never
approves". Aaron's steer (11-17) turns that over: the only way to talk with Buzz will be inside applets, so approving
must happen there too, as a separate permission the person grants knowingly, with the device unlock in front of the
powerful ones. This note says how, and adds the shell capabilities the Uni app's rooms need (voice, notifications while
closed, links, files, a little storage). It extends SERVICES.md; everything there still holds unless said here.

## Three keys

**Decided 11-18 (Aaron): one personal key.** No separate approval key is made any more (Settings no longer offers
it); a device that made one before can still remove it. Risky actions take a level instead: nothing, the device
unlock, or a typed passcode ([APP-RECORD.md](APP-RECORD.md) "Security levels"); approving code always takes the
unlock. The root key is recovery only. The table below is how the roles are kept apart in Rust, which still holds.

| Key | Where | Signs |
|---|---|---|
| **everyday key** | this device (the key Parachute has today: Keystore / OS keyring) | sign-ins, chat, reactions, edits, NIP-98, media, private notes: everything SERVICES.md lists |
| **approval key** | this device, its own secure-storage slot; every use is behind the grant and, for powerful answers, the device unlock | answers to Uni's sealed cards (seal of rumor 46042), secret deliveries and forgets (seals of 46040/46041), NIP-98 for the approval ops an http service names; later the second signature #systems uses for root actions and mesh device-adds |
| **root key** | offline. Never in the app | nothing here |

**Until the person makes a separate approval key, the approval key is the everyday key.** Settings and every card that
mentions it say so ("your approval key is your everyday key for now"). The roles stay separate in Rust even then:
`Role::Everyday` signs only what SERVICES.md lists (never a kind 13 seal); `Role::Approval` signs only the seals and
approval requests below. So a missing approval grant means no approval signature, whatever the bytes of the key.

**Making a separate approval key** (Settings → Keys → "Make a separate approval key"): Rust makes it and keeps it in its
own slot (Android: the same Keystore-wrapped store as the everyday key, entry `approval`; desktop keyring entry
`approval`). Settings shows its npub and offers **"Copy the enrollment for Uni"**: the Uni app's own enrollment event
(kind 9, `["t","uni-sealed-enroll"]`, `{"v":1,"seal_pub","for"}`, `h` = the room the person names, `for` = the trusted
key named "Uni" below), **signed by the approval key**, for `sealed enroll` on the box Uni runs on. It goes there
outside the rooms, never as a message here: anything allowed to post as you could post a fake one, which is the gap a
separate key closes (and the approval key need not be a member of the relay). Settings says plainly what switching
costs: every credential Uni holds is sealed to the old sealing key, so each must be sealed again to the new one (Uni's
side, uni-ops owns that migration); until then Uni's cards can't be opened here; and answers signed by the new key are
accepted only once Uni and Hermes check for it (changed separately; nothing here changes them).

**Losing it.** The approval key has no backup and no pairing in this step: a lost phone or a removed key means
re-sealing every credential from source. "Use the everyday key again" removes the separate key only after the device
unlock and a warning that says exactly that.

**The precondition for "no change on Uni's side"**: Parachute's everyday key is the same key as the Uni app's identity
key (paired or pasted from it). Settings shows the sealing public key, so the person can compare it with the Uni
app's.

**The sealing key** is derived from the approval key exactly as the Uni app derives it from its identity key (Uni
app `crates/uni-core/src/sealed.rs`: HMAC-SHA256 "uni-sealed/v1" over the secret, then "uni-sealed-credentials/v1 seal
key" with a counter until a valid scalar). With the default (same key) it is the same sealing key the Uni app already
enrolled, so Uni's cards open here with no change on Uni's side.

## What a grant may say (additions to `fields.services`)

```yaml
services:
  - id: rooms
    kind: nostr-relay
    url: wss://relay.example
    publish: [9, 7, 40003, 5, 20002]
    media: true
    rooms:                          # optional: only these rooms (NIP-29 h), at most 12
      - { id: 3f2a…, name: Garden } # name: the applet's word for it, shown quoted and marked as its own
    approvals:                      # optional, high risk: answer cards and secret requests from these keys
      from: [<Uni's pubkey hex>]    # at most 4; each must be one the person trusts on this device (below)
    notify:                         # optional: notifications while Parachute is closed
      mentions: true                # a message there that names you
      from: [<Uni's pubkey hex>]    # and every message from these keys (at most 4)
  - id: mail
    kind: http
    url: https://mail.example/mail/
    auth: nip98
    approve: { field: op, ops: [send.approve] }  # a JSON body whose "op" is one of these is signed with the approval key
```

And beside the manifest:

- `reach: [voice]` in the manifest (the Uni app's own word, contract 2) now means the microphone: the shell records on
  its own sheet and hands the applet the recording. `reach: [{room, …}]` stays refused: rooms are named on the relay
  service (above), where the posting rights are; one place says "this room".
- `app` gains `links`, `save`, `attach`, `storage` (with `recent`, `pins`, `open`).

Every addition is in the grant's key (only when present, so older grants hold) and on the card.

## Trusted for approvals: a list on this device

Who may ask for an approval or a secret is not the applet's to say. The shell keeps one list on this device, **Settings
→ Keys → Trusted for approvals**: a name and a key each ("Uni"), added by the person (pasting the npub, behind the
device unlock) and removed the same way; Aaron's README says which key is Uni's. Rust keeps it (app data,
`approvers.json`) and the web side only reads it. An applet's `approvals.from` and `notify.from` name keys; the card
shows each by the list's name ("Uni"), and a key not on the list as "a key you haven't trusted on this device
(npub1…): nothing from it is answered until you add it in Settings". Rust answers a card or a secret request only
when its author is in `from` **and** on the list, so a hostile applet that declares its own key gets nothing: no card
of its making shows buttons, and the shell's secret sheet never opens for it.

A fresh install's list is empty. A card from a key the grant names in `approvals.from` but the list doesn't have yet
says so ("This device doesn't trust the key that signed this card yet.", not "Not signed by Uni.") and the Rooms
applet offers **Trust Uni's key…** (`services.trust`): the person's tap, then the shell's own sheet over the applet
(which applet asks, the whole npub, and a name the person types: never the applet's word), then the device unlock
("Let Uni (npub1…) ask this device for approvals and secrets"), adds it to the list (Rust's `svc_card_trust`). It is
offered only for a key the grant names, which the person saw on the grant's card; a card from any other key still
reads "Not signed by Uni." with nothing to tap. A name another key already has is refused (no second "Uni"), here and
in Settings. Which keys sign Uni's cards: Uni's own Buzz key alone (DAY1 notes, 11-18).

## The card

On the card's face ([PERMISSIONS.md](PERMISSIONS.md)) the server's line names the everyday key, and `approvals` is its
own line: "**High risk, with your approval key:** answers approval cards and secret requests from Uni there…". The
lines below are the details. Each relay line now names the key: "**With your everyday key:** sign in to relay.example as you; post as you there:
messages, reactions…". With `rooms`: "…only in «Garden» (3f2a1b…), named by the applet". The id is what is
enforced; the name is the applet's word and marked so, because before Allow the shell has no connection to the relay
to read the room's own name (signing in there is part of what the card asks).
`approvals` is its own line, in bold words, not colour alone:

> **High risk. With your approval key:** answer approval cards and secret requests there from Uni (your approval key
> is your everyday key for now). Powerful ones ask for your device unlock.

("Uni" is the trusted list's name for the key; a key not on the list reads "a key you haven't trusted on this device
(npub1…)".)

`notify`: "Tell you about messages there that name you (and every message from Uni), even when Parachute is closed".
http `approve`: "**High risk. With your approval key:** send send.approve requests to mail.example". With `approvals`,
a note under it: "It sees what each card asks (the job, never a key), and that could reach the servers it uses".
`reach: voice`: "Record from your microphone when you press record (the app shows its own recorder)". `links`: "Open
web addresses in your browser: what it reads could leave in an address it opens" (stressed). `save`: "Save files to
your device's Downloads". `attach`: "Ask you to pick a file or picture to give it". `storage`: "Keep up to 256 KB on
this device for itself (drafts, what it last showed)".

## Approving inside an applet

Every approve, and every secret sheet, needs **a tap in that applet** (the shell's `tappingIn` check, as `app.open`:
live user activation with the focus in its own frame, while its screen is in front), and **a tap pays for one call**: a
second `answer` or `secret` within the activation's few seconds is refused (one call may answer several rows of one
morning card). This check is the web side's, as SERVICES.md accepts. So an applet can't approve on its
own, and can't raise unlock prompts out of nowhere; after a cancelled unlock the same card can't ask again for 5
seconds.

1. The applet finds a card in a room (a kind 9 with a `uni-sealed-approval`, `uni-sealed-morning` or
   `uni-secret-request` block) and hands the **signed event** to the shell: `services.card(id, event)`.
2. Rust checks it as the Uni app does (ported `sealed_card.rs`, `secret.rs`, `sealed.rs`, with their tests): signed,
   kind 9, **author in the grant's `approvals.from` and on the device's trusted list**, the card's `h` in the
   service's `rooms` when it has them, every field, expiry, digests, the box opens with this device's sealing key, the
   class and caps, replay against the answers ledger. It answers with a view: rows (action, credential, class, scope,
   window, uses, payload, request digest, expires, `always_unlock`), or the one-line refusal. Never the data key.
3. The applet draws it and its buttons (a hold for `needsHold`: powerful and `always_unlock`, as the Uni app).
4. `services.answer(id, event, decision, rids)`: Rust checks the card again; for an approve, **the device unlock**
   unless a grace covers it (routine only); records each answer in the ledger (on disk before anything goes out), builds
   the gift wrap (rumor 46042 `[["e", card]]` `{dek?, v, rid, request_digest, decision}`, seal signed by the approval
   key, both layers NIP-44 v2 to the request's `rpk`, wrap `p` = the card's author, `expiration` = the card's), and
   hands back only the wrap. The wrap never enters the frame: the shell's web side publishes it on the applet's relay
   connection (Buzz takes a 1059 whose signer isn't the signed-in key; the wrap carries no `h` and is not an applet
   event) and tells Rust it was taken on the relay's OK. A retry sends the same wrap while it is under 10 minutes old.
   One answers ledger per approval key, shared by every applet on this device.
5. Secret requests: `services.secret(id, event)` opens a **shell sheet** (outside the frame) showing who asks, the
   label, purpose, where it is kept and for how long, with a masked field. The value is typed there and sealed by Rust
   (rumor 46040 `{value, v, rid, name}`, tags `e`, `p`); the applet learns only "sent" or "cancelled". "Ask Uni to
   forget it" is 46041 to the requester's own key. The requester must be in `approvals.from` and on the trusted list
   (the Uni app's pin, made explicit).

**Unlock**, decided natively and never from a flag the web side sends: Android BiometricPrompt with
`BIOMETRIC_STRONG | DEVICE_CREDENTIAL` (a PIN, pattern or password counts; a phone with no screen lock can't approve a
card that needs the unlock, and the card says to set one); macOS LocalAuthentication `DeviceOwnerAuthentication`;
Linux and Windows a native OK/Cancel dialog (as the Uni app: a click, not a biometric). **What an approval asks** is
this device's level for approvals ([APP-RECORD.md](APP-RECORD.md) "Security levels", `src-tauri/src/levels.rs`): the
tap alone, the unlock (the default), or this device's passcode then the unlock; the passcode is typed on the shell's
own sheet over the applet, never in its frame. A powerful row asks at least the unlock, fresh. **Grace**: 300 seconds
after a passing unlock, for routine approvals only, **for the applet that earned it** (its grant), ended when the
screen goes off (Android's screen-off broadcast; Aaron, 11-18: "ends on screen lock"), by the idle lock, and when the
app is swiped away; it never stands in for a passcode. (Android 14 may hold the screen-off broadcast back from an app
frozen in the background; the app also counts a stop with the screen off, and getting back into a locked phone takes
its unlock anyway.) Never granted on desktop (the Uni app watches the screen lock
there; this step asks every time instead, said in PARITY.md). Each approval that a grace let through shows the shell's
own line over the applet ("Approved: cloudflare-dns · 1 h") and is written to the signing log. `always_unlock` (the Uni
app's rule: a powerful key unless a small one; any `mint.` or long-lived child) always asks. Deny never asks. While the
idle lock covers the app, every unlock-gated call is refused.

**Held sends** (mail): `approve: {field, ops}` on an http service. A request whose body is a JSON object with `field`
one of `ops` is signed with the approval key, behind the same level, unlock and grace (and a tap). Everything else that service
is sent (no body; JSON without that field, or with another op) is the everyday key's. What a gateway might read
differently is refused, so the split fails closed: a body that isn't plain JSON (a byte-order mark, NaN, another
encoding), a key named twice, or the field holding anything but a string. The mail gateway still decides by the key it
maps; the separation is complete once it is told the approval key (with Uni and Hermes, outside this repo).

## Joining a network

"To get onto my personal wireguard, I want a key plus a passcode" (Aaron, 11-18). The WireGuard side is #systems'
(the mesh's signed member list, `~/Code/mesh`); the app builds only the signing. An http service may name **join ops**
beside (or instead of) approve ops:

```yaml
services:
  - id: mesh
    kind: http
    url: https://enroll.mesh.example/
    auth: nip98
    join: { field: op, ops: [mesh.join] }
```

A request whose body is a JSON object with `op` one of the join ops is sent only after **a tap in the applet**, then
this device's `join` level: by default **the passcode** (typed on the shell's own sheet), **then the device unlock**,
every time, never a grace. It is signed with the person's key as NIP-98: an `Authorization: Nostr <base64 event>`
header whose event is kind 27235 with `["u", <the full URL>]`, `["method", "POST"]`, `["payload", <sha256 hex of the
body>]`, a nonce, and **`["parachute", "join", <the op>]`**, `pubkey` the person's key. Only a join op's event carries
that last tag: the same key signs the service's everyday requests (and any applet's that names the enroller's address
without a `join` line), and those never have it; no applet signs kind 27235 itself (a `services.rs` test). The body is the applet's (#systems'
choice; for example `{"op":"mesh.join","mesh":"home","device":"phone","wg":"<the phone's WireGuard public key>"}`).
The same field can't name an op as both approve and join, and the split fails closed as held sends do. The card says
"High risk, joins a network as you: asks enroll.mesh.example to let this device join (mesh.join), each time after your
passcode and unlock (Settings → Security)."

**What #systems calls and checks.** An applet of theirs declares the service above and calls
`parachute.services.fetch({service: "mesh", path: "join", method: "POST", body: JSON.stringify({op: "mesh.join", …})})`
from a button. Their enroller checks the NIP-98 event as NIP-98 says (signature, kind 27235, `u` and `method` equal
to the request, `payload` equal to the body's hash, `created_at` within a minute, the nonce once) and that its
`pubkey` is the owner's personal key, **and that the event has `["parachute", "join", op]` with `op` the body's op and
one of its join ops**; a request without the tag is refused (it went out as an everyday request, with no passcode
asked). Then it adds the device to the member list it signs. A passing request means Parachute on one of the person's
devices sent it after that device's join level (the passcode and the unlock, unless the person lowered it, which is
itself signed). That is the app's promise, not a proof: other software holding the same key (Uni's tools) could sign
the same tag; making the key on the phone with no export is the rotation step (#systems, T-487).

**Hermes's command prompts** (a plain kind 9 `/approve` or `/deny` today) stay as they are until Hermes moves to sealed
answers (separately). Meanwhile the everyday key signs a kind 9 whose text, leading whitespace trimmed and case ignored, starts with
`/approve` or `/deny` only for an applet holding the `approvals` grant, during a tap; SERVICES.md's "Left, said plainly" is updated to say so.

## Room scope

With `rooms`: every event the applet publishes carries exactly one `h` tag, in the list (checked in the web side and
again in Rust); a reaction, edit or deletion's target is read first and must be in one of those rooms (web side: Rust
sees no relay reads). A card's `h` must be one of them too. Every filter the applet sends must carry `#h` within the list, or be a room-metadata read (kinds
39000–39003 with `#d` within the list), or a profile read (kind 0 only, by `authors`); `search`, `ids` and `authors`
alone are refused. Not room-scoped, said on the card's notes: media on that relay's media server, and private notes.

## Voice, files, links, storage

- **Voice** (`reach: voice`): `voice.record()` opens the shell's recorder sheet over the applet (Record, a running time,
  Stop, Send, Cancel; nothing pulses). The shell records with MediaRecorder (`audio/webm;codecs=opus`, 32 kbit/s, as the
  Uni app) in its own document, never the frame; Send hands the applet `{bytes, type, duration}`. The applet uploads it
  with `services.upload` (the production relay takes WebM Opus) and posts a kind 9 with an audio `imeta` and an empty
  body, as the Uni app. Rooms aren't transcribed by the app (Uni transcribes on its side, as now). A voice journal entry
  goes to the vault as an attachment with `transcribe: true` (`vault.attach`), as the Uni app's journal does; the hub
  transcribes.
- **Links** (`links`): `app.openLink(url)`: http, https and mailto only, at most one a second, opened in the browser by
  Rust.
- **Save** (`save`): `app.save(name, bytes, type)`: Android MediaStore Downloads; desktop the Downloads folder, a free
  name. At most 25 MB.
- **Attach** (`attach`): `app.pick({accept, multiple})` shows the shell's own file picker; the applet gets the files the
  person picked (`{name, type, bytes}`, at most 25 MB each).
- **Storage** (`storage`): `storage.get(key)` / `storage.set(key, value)`, kept by the shell per applet on this device,
  256 KB in all; a value goes as JSON text in bytes (`params.bytes`, read only once it is within the 256 KB), so one
  call keeps a whole list. Why not the two places that already keep an applet's state: drafts are written at every pause in
  typing, belong to this device, and shouldn't sync; a relay's private note is a signed event per write, and a vault
  note would show up as a note and sync everywhere.
- **Vault attachments** (new call `vault.attach(noteId, bytes, type, {transcribe})`): adds a file to a note the applet
  may `update` (its access rule governs it), through the hub's own upload and attach routes; `transcribe` asks the hub
  to transcribe audio.
- **Save** names are reduced to a bare file name (no separators, no leading dot, at most 100 characters); one file a
  second.
- As built: `voice.record({max_s})` (1–600 s, default 600); `app.pick` gives at most 10 files; `storage.keys()` lists
  the applet's keys. A voice note's `imeta` carries no `duration`: the relay refuses it on audio ("only valid for
  video/mp4"), as the Uni app found; Chromium's WebM has no length in it either, so a player may show none until it has
  played. Linux desktop can't record: the shell turns media off for the whole webview there (`seal_webview`), and the
  sheet says so. The microphone goes only to the shell's own page: frames get `allow="microphone 'none'"`, and Android's
  webview grants audio capture to the shell's origin alone.

## Notifications while closed

`notify` on a relay service. The shell keeps one list of what granted applets asked for (relay, your public key, the
service's `rooms` or none, `mentions`, the `from` keys on the trusted list, its push `gateway`, which applet) and hands
it to Rust, which checks it and has the native side keep it in the app's private preferences.

**The main path is push** (SERVICES.md, "Notifications through an open push service"): the applet's push gateway
watches the relay and sends a sealed push (room and message ids, no words) through the person's UnifiedPush
distributor (ntfy from F-Droid, or another); `PushService.kt` shows "A message for you in <room>". Rust signs the
gateway registration; on the push path the phone holds no relay connection of its own.

**The fallback**, on unless the person turns it off in Settings ("Parachute's own connection, for what no push service
delivers"), for a phone without a working distributor (GrapheneOS with nothing installed yet, or ntfy removed, noticed the next time Parachute opens): a foreground service (type `remoteMessaging`, with its quiet ongoing line "Listening for
your rooms") that holds its own relay connection (Kotlin, OkHttp), and signs the relay's NIP-42 challenge through one
JNI entry point in the app's Rust library, which it loads itself (so it works after Android restarts the service
without the app): the service opens the everyday key from the Keystore-wrapped store as the app does, hands it to that
entry point, and gets back only a kind 22242 for the relay it names. It serves only what no push registration serves.
Rooms: the service's `rooms` when the grant has them, else the person's rooms read from the relay (kind 39002 `#p`
you), read again on reconnect and every 15 minutes. It subscribes one room at a time, and posts a notification for a
new kind 9 that names you (`p`) or comes from a `from` key, never your own. It shows who and the first words. The newest
message shown per room is kept, so a restarted service doesn't show it again.

Both paths post through `MessageNotices.kt`: one notification per room, a group summary with the count (the launcher's
badge). A signal push (APP-RECORD.md "Signals") is one more notification per applet's signal, "Ideas · 2 new", sounding
only when the count rises (a relay's never: its message already did), gone when the count is 0; its tap opens the applet, not a message. Tapping opens `parachute://notify?…`: the applet's screen at that message. The applet waits stopped there, with
its Open button (one more tap): a link from outside the app never starts an applet by itself, and the shell can't yet
tell its own notification's link from any other app's. What was shown is cleared, and the badge with it, when the app
comes back to the front (not when that applet opens). Nothing is shown while the app is in front. "Closed" means swiped
away from recents; Force stop kills any service and stops a distributor's deliveries, as Android means it to. Nothing
is shown when no grant asks or the key is removed. Android asks for the notification permission when the first such
grant is allowed. Desktop: not in this step (the app notifies only while running there); said in PARITY.md.

## Threat model, additions

| Threat | What stops it |
|---|---|
| An applet declares its own key as an approver | `from` counts only for keys on the device's trusted list, added by the person behind the unlock. |
| An applet approves on its own | Every approve needs a tap in its frame; the grace belongs to the applet that earned it and each use shows the shell's line. |
| An applet posts Hermes's `/approve` | Only an applet with the `approvals` grant, during a tap, until Hermes takes sealed answers. The text is read as leniently as Hermes reads it (white space, controls, invisible characters and leading mentions such as `@Uni` dropped first). **Not closed:** while Hermes waits on a prompt it also takes bare words ("yes", "ok", "approve", 👍) as an approval, and refusing those would stop ordinary chat; any applet that may post in that room can say them. This ends when Hermes takes only sealed answers from the approval key. |
| A "tap" that isn't one | A tap is the browser's user activation in the applet's frame: a keystroke counts too, so a hostile applet with the grant can spend the person's typing on an answer (one per activation, and a powerful one still asks for the unlock). |
| An applet without the grant gets an approval signature | `Role::Approval` signs only through `services.answer`/`secret` and http `approve` ops, each refused without the grant line; tested with a separate key (its pubkey never appears) and with the same key (no kind 13 is ever signed). |
| An applet asks to join a network on its own | A tap in its frame, then the device's join level (the passcode and the unlock by default) on the shell's own sheet and prompt, every time; the applet never sees the passcode. An applet that only names the enroller's address gets everyday requests, without the join tag the enroller requires. |
| A vault writer lowers the levels | A record only raises; lowering is a signed approval from an unlocked device (APP-RECORD.md "Security levels"). |
| An applet approves a card the person didn't see | The grant says it may; the card says "high risk". Powerful ones need the device unlock, which shows the shell's own words (credential, action, window, uses, the job's digest), not the applet's. |
| A forged card (another key, a replayed real box) | Author must be in the grant's `from` and on the device's trusted list; the request digest binds every field; the ledger refuses a replayed `rid` or `rpk`. |
| The data key or a secret reaches the applet | The view never carries `dek`; secrets are typed on the shell's sheet and sealed in Rust. |
| An applet scoped to one room posts or reads elsewhere | `rooms`: one `h` in the list on every event (web side and Rust), targets checked, filters refused without an in-scope `#h`. |
| Posting rights approve a held send | The everyday key never signs a body whose `field` is an approve op, and a body read two ways is refused (fails closed); full separation needs the gateway to know the approval key (said). |
| A notification leaks a message | Pushed: no words reach the gateway's push, the push server or the screen ("A message for you in <room>"). Fallback listener: who and the first words, on the lock screen as Android's settings allow. |
| A push is forged or sent in someone's name | Sealed to the phone's push keys (RFC 8291): one that doesn't open is dropped; the gateway takes a registration only signed by the key it registers. |
| An applet exfiltrates through a link or a saved file | `links` is stressed on the card; a saved file goes where the person's own files are. |

## Testing

- **cargo**: the ported card, secret and seal tests; roles (no seal by the everyday role; no approval signature without
  the grant, with a separate and with the same key); a wrap opened by Uni's own verifier (`uni-ops/sealed`, run from its
  path locally, never copied here); room scope on `svc_sign_event`; http approve ops refused with the everyday key.
- **Playwright** (web build, test signer): the rooms applet answers a card (the flow and the wire shape), the secret
  sheet, a scoped applet refused elsewhere, voice recorded (Chromium's fake microphone), sent and played back, a link
  opened, a file saved, a file attached.
- **Emulator** (the real app): a powerful card approved with the PIN asked; the answer opened and checked by Uni's
  verifier; with ntfy as the distributor and the push gateway on the host, a mention while the app is swiped away posts
  a notification, and tapping it opens the room.

## Subtract

This replaces SERVICES.md's "an applet never approves" and the rooms applet's "answer it in the Uni app" lines; nothing
in Parachute did approvals before. It is the second home of the Uni app's sealed cards and secret desk; the Uni app's
goes when Aaron has approved from Parachute for two weeks of daily use (target 2026-12-08, his call). One way each: rooms are named on the relay service only (the manifest's `reach: room` stays
refused); the microphone is the manifest's `reach: voice` only.
