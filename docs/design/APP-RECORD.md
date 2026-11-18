# The app record: one record says what your app is (design)

Status: a proposal, nothing built. It answers T-476: which applets an app loads, where they sit, who approved them,
what they keep, and how they tell you something is waiting. Schemas, examples that validate, an attack play and three
mockups are in [app-record/](app-record/). Two fresh reviewers read it; what they found is in
[The reviews](#the-reviews). Made-up names and hosts throughout (Aaron, Techne, `uni.example`), as in
[EMBED.md](EMBED.md).

**The short read:** the picture, the three screens, and the three questions at the end. The layers in between are
for whoever builds it.

## The picture

```
 YOUR HOME VAULT  (follows you to every device)          EACH DEVICE  (stays there)
 ┌───────────────────────────────────────────────┐      ┌────────────────────────────────────┐
 │ Parachute/Settings     your Parachutes, and   │      │ which app is open here             │
 │                        the app a new device   │      │ whose each vault is                │
 │                        opens                  │      │ your approval key's public half,   │
 │ Parachute/Apps/uni     AN APP: where applets  │─────▶│   and the newest approval it saw   │
 │      DISCOVERY         come from, the bar,    │ read │ microphone, notifications, unlock  │
 │                        start, what opens what,│      │ what each applet saved: drafts,    │
 │                        signals, theme         │      │   where you were                   │
 │ Parachute/Approvals/…  one per applet: this   │─────▶│ how many applets stay running      │
 │      RUNNING           exact code, these asks,│check └────────────────────────────────────┘
 │                        SIGNED BY YOUR         │
 │                        APPROVAL KEY           │         ONE device holds the approval key
 └───────────────────────┬───────────────────────┘         and signs, after its unlock.
                         │ an app lists applets; it never runs one
                         ▼
   everything in home  ·  Seed log from garden  ·  Events from techne.example (someone else's)

 PUSH GATEWAY (named by the applet, on its card): counts what is waiting while nothing runs ──▶ badge, notification
```

1. **An app is a record** in your home vault. It lists where applets come from (one applet, a whole vault, a whole
   hub) and how they are laid out. That is discovery: it decides what you are offered. You can have several apps;
   each device opens one.
2. **Running needs your approval.** An applet runs only when a record says "this exact code, asking exactly this",
   signed by your approval key on a real device, after its unlock. One device approving is enough; the others check
   the signature, hash the code themselves, and run it. A vault or hub that is broken into has no key, so it can't
   make your everyday key sign anything new.
3. **An applet can stop at any moment and lose nothing.** The kit saves drafts and where you were as you go. How many
   applets stay running is then only about speed.
4. **An applet says what counts as "something for you".** A server counts it while the applet is closed. The same
   count is the badge on the bar and the notification on your lock screen.

## What a person sees

From [app-record/mockups/mockup-app.html](app-record/mockups/mockup-app.html) (`?screen=picker`, `settings`,
`approve`).

| Your apps | One app's settings | Approving a change |
|---|---|---|
| ![Your apps](app-record/mockups/01-your-apps.png) | ![Uni's settings](app-record/mockups/02-app-settings.png) | ![Approve a change](app-record/mockups/03-approve-a-change.png) |

**What to judge.** First: does "an app" read as a thing you pick, and is *Everything* a fair name for how it works
today? Second: do the three "Applets from" lines say wildcards in words you would use? (Hidden applets, what opens
what, theme and servers are behind **More**.) Third: is the card clear that one approval covers every device, and is
"Approve it on your Pixel" acceptable on a device without the approval key? That last is open question 1.

## Two ways to say which applets an app has

| | **A. One list** | **B. Links** |
|---|---|---|
| The shape | One app record holds everything: sources (with wildcards), bar, start, opens, signals. | The app record is a title. Each applet in it is its own pointer record linked to the app, with its place on the bar and its signal choice. |
| "Every applet in home" | One line. A new applet is offered by itself. | No wildcard. A button writes nine pointers; the tenth applet needs a tenth. |
| Reorder the bar | One write. | Up to twelve writes that must all land. |
| Two devices change it at once | The second write is told to read again (`if_updated_at`, as Settings does now). | Small records rarely collide, but the bar can end up half one order, half the other. |
| Your agent sets up an app | Writes one record. | Writes one per applet and keeps them in step. |
| Seen in the vault | One note to read. | The graph shows which apps use an applet. |

**Recommendation: A.** Aaron's words ask for wildcards, and B can't have them. Either way the version you trust is not
in the app at all: it is in the signed approval, one per applet, which is the only thing that lets code run. So
listed or linked matters less than it first looked. Listing is discovery; the signed hash is trust.

**Do graph links add anything?** One thing, and it comes free: each approval record is its own note per applet, so
the app can link it to the applet's note where both are in the same vault, and the vault's graph then shows what you
approved. Nothing reads those links to decide anything. An applet in Techne's vault can't be linked from yours; it is
named by address, as the bar names it today.

## Layer 1: the app record

`Parachute/Apps/<id>` in your home vault, tagged `parachute-app`, everything under `fields.app`
([schema](app-record/app.schema.json)). The type is called an app; the tag carries the prefix because a plain `app`
tag is one people already use for their own notes. Applets can't write the record: their writes change a note's
words, never its fields, and `parachute-app` and `parachute-approval` join the tags whose notes an applet may not touch
(`GUARDED_TAGS`, `src/applet/modules/vault.ts`). Your agent can write it. That is the point, and it is safe because
nothing in it grants.

| Key | What it says |
|---|---|
| `id`, `name`, `glyph`, `note` | What the picker shows. |
| `sources` | Where applets come from (below). |
| `hide` | Applets a wildcard brings that this app leaves out. |
| `bar`, `start` | As in `Parachute/Settings` today: up to 12 places, and the home applet. Open-on-start still needs this device's tap, per app (`start.ts`, unchanged). |
| `opens` | Which applet opens a type of note in a vault when more than one can, or `null` for the plain vault view. Applets still declare what they *can* open; this picks among them. |
| `services` | The servers this app's applets reach, as Settings lists them today. |
| `theme`, `frame` | Which theme and frame record this app wears. |
| `keep` | How many applets stay running: `"auto"` or a number (layer 3). |
| `signals` | Which applets badge, notify or stay quiet (layer 4). Choices only; no server address. |
| `based_on` | Set when you added an app someone else offers: where the copy came from. |

**Sources.** One shape, `{ hub?, vault, applet }`, the same as a place on the bar. A `*` widens it:

```json
"sources": [
  { "vault": "home", "applet": "*" },
  { "vault": "garden", "applet": "Applets/SeedLog" },
  { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events" },
  { "hub": "https://uni.example", "vault": "*", "applet": "*" }
]
```

Every applet in a vault; one applet; one applet in someone else's vault; every vault on a hub. No hub means the hub
your home vault is on. There is no "every hub" and no "this applet in every vault".

**How the app reads it**, each time it shows the launcher:

1. Pick the app: this device's choice, else `Settings.app`, else the only one, else the picker.
2. For each source, list what this device can see. A hub it isn't signed in to is one line with **Sign in**, as now.
3. Take away `hide`. Group as now: by Parachute, then vault; someone else's is marked.
4. `bar`, `start`, `opens` and signal rules that name an applet outside the list are skipped, not errors.
5. Tap one. It runs if a signed approval covers this exact code and these exact asks. Otherwise its card.

**Wildcards and changed code.** A wildcard decides what is *offered*. An approval decides what *runs*.

| What happens | What you see |
|---|---|
| A new applet appears in a vault you listed with `*` | "New: Ideas in playground. Tap to look." Its card on first open. Nothing of it has run. |
| An applet's code changes | It stops running on every device. "«Rooms» changed" (third mockup). One approval, on one device, and all of them run the new version. |
| It asks for something else | The same, headed "«Rooms» asks again", with what is new marked. |
| It is in someone else's vault | The same rule. It stays marked, gets nothing from the app, and never opens by itself ([EMBED.md](EMBED.md) otherwise unchanged). |

**Several apps.** Each is one record: *Uni* for every day, *Techne* for the shop. A device remembers which one it has
open. A new device opens `Settings.app`. The picker is the launcher's title, tapped. A vault that no source of the
open app names is reached through *Everything* or Settings.

**An app someone else offers.** Techne can keep an app record in its own vault. Your launcher offers **Add**. That
copies it into your home vault with `based_on`, its sources rewritten to name Techne's hub. The copy is yours: when
Techne changes theirs, the picker says so and shows what differs. Someone else's vault never moves your bar. (The
other answer, an app that follows Techne, is open question 2.)

**What stays in `Parachute/Settings`:** what is yours rather than one app's. `hubs` (your Parachutes) and `app` (the
app a new device opens). [Schema](app-record/settings.schema.json).

## Layer 2: running needs a signed approval

Aaron: "Code change should definitely wait for a yes… If the parachute gets compromised, we need to make sure that a
real client (could just be one client, doesn't need to be all) approves a code change. Otherwise a compromised
parachute vault could mean your nostr key starts getting used in a lot of places you don't want it to."

Today an Allow lives in one device's `localStorage` (`src/applet/grants.ts`). That already stops a broken-into vault
from running new code, but every device asks about every applet from nothing, and the Allow is a tap with no key
behind it.

**The rule.** An applet's code starts only when the client holds an approval that:

1. is signed by **your approval key** (the key, not the vault, is what a thief would need);
2. names **this applet** (hub, vault, record);
3. names **the hash of this exact code** and **the hash of its manifest and everything it asks** (folders, what it
   opens, app words, servers and what it may sign there, signals, embeds), both of which the client computes itself
   from what it is about to run;
4. is **not older than the newest approval this client has seen** for that applet;
5. has not run out (a year at most) and was made for this device's mode and this device's say on whose the vault is.

Anything else, and the applet shows its card instead of running.

**The record.** One per applet: `Parachute/Approvals/<host>/<vault>/<applet's record id>`, tagged
`parachute-approval` ([schema](app-record/approval.schema.json)). It holds one Nostr event, never sent to a relay.
Each new approval of the same applet carries a counter one higher (`n`) and the id of the one it replaces
(`supersedes`). Taking an approval back is the next one in line, saying `"approved": false`.

**Approving** (third mockup). The card is today's card. **Approve** asks for the device unlock, then native code
signs with the approval key. So a changed applet costs one unlock, once, on one device. The other devices need
nothing: they run it the next time they read the vault.

**A device without the approval key** can check and run, but not approve. It says "Rooms changed. Approve it on your
Pixel." KEYRING.md gives the approval key no pairing today, so today that means one approving device. Whether it
should be one or several is open question 1.

**How a client knows your approval key.** Not from the vault: a thief would write their own. It gets the public half
when it is paired, from a device you hold, together with the newest counter that device has seen for each applet.
It keeps both on the device. A client with no key at all (a browser tab) has nothing to check against, never reads
approvals, and keeps asking for itself as today.

### Tested against attacks

[attacks.mjs](app-record/attacks.mjs) plays the rule with real keys and signatures: 21 attempts, each with what the
client decided. Two of the checks were then broken on purpose to see the play fail, and restored.

| Who | Tries | Result |
|---|---|---|
| Someone who can write your vault (a token, an agent, the hub itself) | New code, approval left alone | Doesn't run: the hash differs. |
| | New code, and the hash inside the approval edited to match | Doesn't run: the signature breaks. |
| | New code, approved with a key of their own | Doesn't run: not your approval key. |
| | Same code, wider asks (another server, another folder) | Doesn't run: the asks' hash differs. |
| | Rooms' approval copied onto another applet | Doesn't run: it names Rooms. |
| | **Rollback:** last month's approval and last month's code put back | Doesn't run on a client that saw the newer one, or was paired from one that did. |
| | An approval you took back, put back | The same. |
| | Deleting approvals | Applets stop and ask. A nuisance, not a breach. |
| Someone who also holds your **everyday** key | Signs an approval with it | Doesn't run, **if your approval key is a separate key.** |
| Techne (someone else's vault) | Changes an applet you approved | Doesn't run until you approve the new hash. Same rule, same record. |

**The gap that remains, stated.** A client that was given your key by pasting, not pairing, has no counters. Shown an
old approval and matching old code, it runs them. That is code you did approve once, asking what you approved; it is
never new code. Pairing closes it.

**The precondition, stated.** Today, for most people, the approval key *is* the everyday key (KEYRING.md: "until the
person makes a separate approval key"), and the everyday key is also held by other software, the Uni app among them.
While that is so, whoever holds the everyday key can approve code. This design means what it says only once the
approval key is its own key. So making a separate approval key becomes part of setting this up, not an option in
Settings.

### A compromised or lost device

The approval key on it is the root: whoever holds it can approve anything, and no record can out-vote it. What
getting out looks like:

1. On a device you trust, **Make a new approval key**.
2. Pair your other devices to it again, one by one. That hands them the new public half. From that moment every
   approval signed by the old key is void on them.
3. One screen lists what you had approved; one unlock signs them again with the new key.
4. Anything sealed to the old approval key (the credentials Uni holds) is sealed again, as KEYRING.md already says of
   losing it.

Nothing in the vault can announce a new approval key, on purpose: if a record could, a thief could. The offline root
key in KEYRING.md could sign such a change one day; it signs nothing in the app today, and this design doesn't need
it.

### Three things the code needs for this to hold

1. **The asks' hash must be the same on every client.** Today it isn't: `grantKey` takes this device's own name for
   the vault (`home`, or `home@host` when two hubs share a name) and what this device says of other vaults. A new
   version hashes the hub's address and the vault's name.
2. **Approvals need an event kind of their own.** The native signer already signs kind 30078 for applets, under a
   prefix the applet declares (`private_save`, `src-tauri/src/services.rs`). Approvals use another kind (30479 in
   the examples), signed by one native command no applet call reaches, with a test that the applet path refuses it.
3. **Native code signs what the web shell hands it.** The card is drawn by the shell. So the unlock prompt itself,
   which the system draws, should name the applet and the first characters of the hash. A shell broken on the
   approving device is a compromised device, as above.

### What stays on each device, and why

| Stays per device | Why |
|---|---|
| The approval key's public half, and the newest counter seen per applet | They are what a client checks the vault *against*, so they can't come from the vault. |
| The microphone, notifications | The phone's own permission. Nothing we store can answer for it. |
| The approval key itself and the device unlock | The unlock means a person is holding this device now ([KEYRING.md](KEYRING.md)). |
| Whose each vault is | The person's say on the app's own screen. Unchanged. |
| Sealed or approved-code mode | A fact about this device's sandbox. An approval names the modes it was made for. |
| Which app is open, open-on-start, "Always open with", the keep-running override | Choices about this device. Each wins over the record here. |

**A new device:** pair it from one you hold, and sign in to your home hub (whose each vault is, is asked then, as
now). It reads Settings, your app and your approvals, checks them, and your applets run. It asks nothing about code
you already approved. The microphone and notifications ask when first used.

## Layer 3: an applet's state survives everything

Aaron: "if I'm journaling and then hop to mail then messages and then rooms, I don't want to lose my journal entry.
Even if I close my app or turn off my phone."

Today an applet may ask for `storage` (256 KB in `localStorage`), and three hidden applets stay running (`KEEP = 3`,
`src/shell/kept.tsx`). Nothing is saved when a fourth pushes the first out. A draft survives only if the applet's
author thought to save it.

**The guarantee.** What an applet gives the kit to save is on this device's disk within 300 ms of changing, and is
handed back before the applet's first paint, whether it was hidden, unloaded, the app closed or the phone restarted.

```tsx
<textarea {...saved("draft:" + roomId)} />                  // a text box that can't lose its words
const [tab, setTab] = useSaved("tab", "inbox");             // where you were
```

- **Saved as you go, not on the way out.** The kit sends each change to the shell, at most 300 ms late. Nothing
  depends on an exit running, which is the only promise that survives the phone killing the app.
- **One last flush, where there is a moment for it.** The kit flushes when its frame is hidden, when the app goes to
  the background (`visibilitychange`, `pagehide`), and when the shell is about to unload it. That last now covers
  every applet, not only kept ones. The shell waits up to 250 ms for the answer, then unloads anyway.
- **Handed back at start.** Saved values arrive in the message that starts the applet, so it paints its draft at
  once. The kit also saves, for free, the screen the applet was on and its main scroll position.
- **Only what goes through the kit.** A plain `useState` box is lost as today. So step 1 of the migration converts
  our own applets: Journal's entry box, Rooms' and Mail's composers. WRITE-AN-APPLET.md makes `saved()` the way to
  write a text box.
- **Every approved applet gets it,** without asking: it is the applet's own data on your own device. The `storage`
  word stays and means the same store.
- **The store** moves out of `localStorage` (5 MB for the whole app) into the app's own data: a file per applet on
  phone and desktop, IndexedDB in a browser. 1 MB per applet, of which 256 KB is held back for drafts, so a cache
  can't crowd one out. A full store refuses the write and the kit tells the applet. Keyed hub + vault + applet
  record, on this device. **Forget this vault** clears it, and each applet's settings get "Clear what it saved";
  neither happens today. Taking an approval back does not clear it: a card asking again must not cost you a draft.

**Local or synced: two answers.** (a) Saved state is this device's only. A draft that should follow you is saved by
the applet as a real note in its own folder, as Journal does with an entry. (b) The kit offers a synced flavour and
the shell writes it to your home vault. **Lean (a):** no new mechanism, and a half-written message turning up on
another device is a surprise. This is open question 3.

**Then keep-alive is only speed.**

- **Default `"auto"`: a count by device.** 6 hidden applets on a phone, 12 on a desktop, and all but the newest
  dropped when the system says memory is short. A count, not measured memory, because a web view can't reliably say
  what one frame costs (inferred, not measured).
- **The setting:** `keep` in the app record (`"auto"`, or 0 to 12), with an override on each device.
- A running applet keeps its connections open. That is the cost, and why an old phone might choose 2.
- What may be kept at all (own code, no embeds, no note handed in) stays as `kept.tsx` has it.

## Layer 4: "something for you"

Today only Rooms reaches you while closed. Its relay service carries `notify: { mentions, from, gateway }`; the push
gateway watches the relay and pushes "a message for you", no words, no count. Nothing shows a badge.

**The applet declares its signals** in `fields.signals`, beside its manifest
([schema](app-record/signals.schema.json)): an id, a name in plain words, how it counts, where from, and the gateway
that counts it.

```json
"signals": [
  { "id": "for-you", "name": "mentions and messages from Uni", "count": "new", "via": "https://push.example/",
    "from": { "service": "rooms", "mentions": true, "authors": ["3f1c…2b4d"] } }
]
```

| `from` | Counts | Who counts while the applet is closed |
|---|---|---|
| a relay service the applet declared | events naming you, or from keys this device trusts; `new` since you last looked | The gateway, as today, in the rooms it has been added to. |
| an http service it declared (`feed`) | a number that server reports | The server tells the gateway. The gateway never holds your mail login. New on both sides. |
| its own vault (`path`, `type`, `where`) | how many notes match now | Later: needs the hub to tell the gateway when a query's answer changes. Until then the app counts it each time the launcher shows. |

The gateway stays on the applet, as `notify.gateway` is today, so it is on the card and in what you approved: a
rewritten record can't send your phone's address to a stranger's server, and two relays can use two gateways.

**The gateway keeps one number** per person, applet and signal.

**The app shows it without running the applet.** At start, on each push, and when the window comes back to the
front, the shell asks the gateway for your counts in one signed request. The bar and launcher draw them.

**The applet's own number wins while it runs.** Rooms knows what you have read; the gateway only knows what arrived.
Running, the applet sets the number and the shell tells the gateway, which tells your other phones, so a badge read
on one clears on the others.

**The same signal is the notification.** The push says which applet, which signal and the count. The phone words it
from the applet's own record: *Rooms · 3 new: mentions and messages from Uni*.

**In the app record**, `signals` holds your choices only:

```json
"signals": {
  "default": "badge",
  "rules": [
    { "vault": "home", "applet": "Applets/Rooms", "signal": "for-you", "show": "notify" },
    { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events", "show": "off" }
  ]
}
```

`notify` is a badge and a notification; `badge` is quiet; `off` isn't registered at all. A device registers the
signals of the app it has open. One exception to "a record can turn it off": a signal that carries approval requests
can only be silenced on the device, so an agent can't quiet its own approval cards.

**What it costs, said plainly.** The gateway already knows your public key and your rooms. It would also learn which
applets you use, your mail's unread count, when you open the app and roughly when you read. It never sees words. A
desktop gets no push while closed (as today), so its badges are fresh at start and when you come back to the window,
not live. A room the gateway hasn't been added to never counts.

## Worked examples

All in [app-record/examples/](app-record/examples/), checked by [validate.mjs](app-record/validate.mjs).

- [app-uni.json](app-record/examples/app-uni.json): the everyday app in the mockups (below).
- [app-everything.json](app-record/examples/app-everything.json): today's behaviour as an app; what migration writes.
- [app-techne.json](app-record/examples/app-techne.json): an app added from Techne's vault, with `based_on`.
- [settings.json](app-record/examples/settings.json) and
  [settings-while-devices-overlap.json](app-record/examples/settings-while-devices-overlap.json).
- [approval-rooms.json](app-record/examples/approval-rooms.json): Rooms' second approval (new code), naming the first.
  [approval-events-from-techne.json](app-record/examples/approval-events-from-techne.json): an applet in someone
  else's vault. [approval-scratch-withdrawn.json](app-record/examples/approval-scratch-withdrawn.json): one taken
  back. Real signatures, from a key made for the examples and thrown away.
- [signals-rooms.json](app-record/examples/signals-rooms.json),
  [signals-mail.json](app-record/examples/signals-mail.json),
  [signals-tasks.json](app-record/examples/signals-tasks.json): the three kinds of signal.
- [examples/invalid/](app-record/examples/invalid/): 22 records that must be refused, and are: every hub, a hub with
  a `*` in it, one applet in every vault, a version pin or `allowed` slipped into a source, a gateway slipped into
  the app, a theme that points at the approvals, a forged approval, an unsigned one, a ten-year one, one moved onto
  another applet.

```json
{
  "path": "Parachute/Apps/uni",
  "tags": ["parachute-app"],
  "fields": {
    "app": {
      "contract": 1,
      "id": "uni",
      "name": "Uni",
      "glyph": "◉",
      "note": "everyday: journal, mail, rooms",
      "sources": [
        { "vault": "home", "applet": "*" },
        { "vault": "garden", "applet": "Applets/SeedLog" },
        { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events" }
      ],
      "hide": [{ "vault": "home", "applet": "Applets/Scratch" }],
      "bar": [
        { "vault": "home", "applet": "Applets/Journal" },
        { "vault": "home", "applet": "Applets/Mail" },
        { "vault": "home", "applet": "Applets/Rooms" },
        { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events" }
      ],
      "start": { "vault": "home", "applet": "Applets/Home" },
      "opens": [
        { "type": "journal", "vault": "home", "applet": "Applets/Journal" },
        { "type": "task", "vault": "home", "applet": null }
      ],
      "services": [
        { "name": "Rooms", "kind": "nostr-relay", "url": "wss://relay.example" },
        { "name": "Mail", "kind": "http", "url": "https://mail.example/mail/" }
      ],
      "theme": "Parachute/Theme",
      "keep": "auto",
      "signals": {
        "default": "badge",
        "rules": [
          { "vault": "home", "applet": "Applets/Rooms", "signal": "for-you", "show": "notify" },
          { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events", "show": "off" }
        ]
      }
    }
  }
}
```

What an approval's signed content says (in the record it is one string, which is what the signature covers):

```json
{
  "v": 1,
  "subject": { "hub": "https://uni.example", "vault": "home", "record": "01M7ROOMSAPPLET", "applet": "rooms" },
  "n": 2,
  "supersedes": "<the id of approval 1>",
  "approved": true,
  "code": "tsx:9b13cccc…",
  "scope": "5d2caaaa…",
  "modes": ["sealed"],
  "whose": "mine",
  "at": "2026-11-18T09:30:00.000Z",
  "expires": "2027-11-18T09:30:00.000Z",
  "face": ["As you on relay.example (your everyday key): posts messages, edits and typing in your rooms…", "…"],
  "others": [],
  "device": "Pixel"
}
```

## From today to this

1. **Saved state first.** It is the sharpest pain and touches nothing else. Move `storage` to the new store (copy
   `parachute.applet-storage.v1:*` once), add `saved()` and `useSaved`, the flushes, the wait before unload; convert
   Journal, Rooms and Mail; raise the keep-running default.
2. **Apps, read only.** With no app record, the app behaves exactly as now: it reads Settings as an unwritten
   *Everything* app (every hub in `hubs`, `*`, with its bar, start and services).
3. **Apps, written.** The first change (a pin, a new app) writes `Parachute/Apps/everything`. While old and new
   devices overlap, the new app keeps Settings' `bar`, `start` and `services` in step with the app named in
   `Settings.app`, and remembers what it last wrote there. If it finds Settings different, an old device changed it,
   and that change is taken into the app record. `install-applets.ts` learns `--app`.
4. **Opens.** A device's "Always" choices stay on the device and keep winning there. The app record's `opens` is
   offered them once ("Use these on your other devices too?") for types it has no choice for.
5. **Applet pointers.** Each `Parachute/From/…/applet-*` pointer is read as a one-applet source. Its pinned hash is
   what the approval now carries, signed. The pointer records stay in the vault until the overlap ends, so an old
   device keeps its brought-in applets. Component pointers stay for good; embeds own them.
6. **Approvals.** First, a separate approval key, if there isn't one, and the other devices paired to it. Then one
   screen on the approving device, "Sign what you allowed here, so your other devices have it", with one unlock.
   Until a device has been paired to the approval key it keeps its local grants and asks for itself, as today, so
   nothing stops working on the day of the update.
7. **Signals.** Rooms' `notify` becomes a signal; the gateway learns counts. Rooms asks once more, because what it
   asks is worded anew. An applet with no signals keeps its approval.

**Subtract** (what this replaces, and when the old one goes):

| Old | Replaced by | Goes |
|---|---|---|
| `bar`, `start`, `services` in `Parachute/Settings` | the app record | when no device of yours runs the old app; the app can see that from who last wrote Settings |
| Applet pointers (`Parachute/From/…/applet-*`) | a source, and the code hash in the signed approval | same day |
| Grants in each device's `localStorage` (`parachute.applets.grants.v1`) | signed approvals in the home vault | per device, when it is paired to the approval key; a browser tab with no key keeps them |
| "Your approval key is your everyday key for now" (KEYRING.md) | a separate approval key, made at step 6 | at step 6 |
| `parachute.applet-storage.v1` | the saved store | at step 1 |
| `KEEP = 3` | `keep` | at step 1 |
| `services[].notify` | `fields.signals` | one release after step 7 |
| "The launcher is for everything" (NAVIGATION.md rule 2) | the launcher is your app; *Everything* is one | at step 3 |
| "Always open with: never in a note" (`src/open/defaults.ts`) | still true per device; the record adds a default | at step 4 |

## What I did not verify

- That pairing can carry the approval key's public half and the counters. I read `Pair.tsx`'s description (the key
  comes over encrypted after a 6-digit check), not `pairing.rs`.
- That the system's unlock prompt can show a line of our choosing on every platform. KEYRING.md says desktop Linux
  and Windows get a plain OK/Cancel.
- That the hub can tell a server when a query's answer changes. I did not read the hub's code. Vault signals wait on
  it.
- That a web view can't measure one frame's memory. It is why I chose a count.
- That kind 30479 is free in the Nostr kind list. I did not look it up; any unused kind does.
- A mail server reporting a count to the gateway does not exist yet, on either side.
- "The app can see that no device runs the old app" needs each device to leave its version somewhere. Not designed.

## Open questions for Aaron

1. **Does the approval key live on one device, or can you pair it to several?** One (say, the phone) is the strongest:
   a stolen laptop can't approve anything. But then a changed applet waits for the phone, and a lost phone means a
   new key and re-approving. Several is easier day to day, and each one is a place the key can be taken from. I lean
   **two: the phone and one more you choose**, each behind its unlock. KEYRING.md has no pairing for this key yet, so
   "several" is new work.
2. **Can an org's app be live, or only a copy?** Techne could hand you an app that follows their changes: they add an
   applet, it is offered on your launcher. I lean **copy only**: it is yours once added, and you are told when theirs
   changes. Live is easier for Techne and gives them a hand on your screen. (Either way their code waits for your
   approval.)
3. **Do drafts follow you between devices?** Start a journal line on the phone, finish it on the laptop. I lean
   **no, saved on the device**; an applet that wants this saves a real note. Yes means the kit writes drafts to your
   vault for every applet that asks.

## The reviews

**First review** (a fresh Fable reviewer, not the author; first draft): NO-SHIP. Then Aaron's steer on approvals
arrived (code changes wait for a yes, signed on a real client, one client is enough), and layer 2 was rebuilt on it.
The objections, and where each stands now:

| Objection | Answer |
|---|---|
| A device with no key has nothing to check a signature against; a token holder could sign with their own key. | The approval key's public half comes by pairing, never from the vault. A client without it never reads approvals. |
| What you took back could be undone by putting an older record back; order was by wall clock. | A counter and `supersedes` in each signed approval; clients remember the newest seen, and pairing hands the counters on. The gap left (a pasted key, no counters) is stated. |
| The asks' hash differs between devices (`grantKey` takes the device's vault key and its *whose*). | Confirmed in `useApplets.ts` and `vault/store.ts`. A new hash over hub and vault name; the approval names modes and *whose*. |
| The native signer already signs kind 30078 for applets under any declared prefix. | Confirmed in `services.rs`. Approvals get a kind of their own that the applet path refuses, with a test. |
| "Built by the native side from the card on screen" can't be promised. | Dropped. The system's unlock prompt names the applet and hash; a broken shell on the approving device is a compromised device, with its own section. |
| The everyday key is also the Uni app's identity, so any holder could sign. | Approvals are signed by the approval key, and a separate one becomes part of setup. Said as a precondition. |
| The draft guarantee was opt-in, flushed only for kept frames, promised "before hidden" over async messages, and said nothing of a full store. | `saved()` for text boxes, our applets converted in step 1, flush on background and before any unload with a 250 ms cap, a full-store rule, the promise reworded to what holds. |
| The gateway moved into an agent-writable record. | Moved back onto the applet's signal (`via`), so it is in what you approve. The app schema refuses a gateway. |
| Signals: privacy costs unstated; "no polling" untrue on desktop; other devices' badges; approvals could be silenced; the trusted-keys filter dropped. | "What it costs, said plainly"; desktop said honestly; the gateway tells other phones; a record can't turn off approval signals; the filter kept. |
| Migration: the settings schema refused the dual-write; old devices drift; removing pointers breaks old devices; "Always open with" is per device and can mean the plain view. | Schema allows the overlap; a reconcile rule; pointers stay through the overlap; `opens` takes `null` and the device's choice wins. |
| Schemas allowed `https://*`, an id unlike its path, a theme pointing at the signed records or climbing out, URLs with logins, duplicates, `../` in a signal path, an end date in year 9999. | All refused now, each with an example in `examples/invalid/` shown to fail for that one reason. `start` in someone else's vault can't be said in a schema; the app checks it, as today. |
| The tag `app` is too generic to guard. | `parachute-app`. |
| A wrong citation, a name clash (`useKept` exists), too long, mockups not matching the examples. | Fixed; what we borrow moved to the appendix; mockups redone. |

SECOND_REVIEW

## Appendix: what we borrow

| From | What it does | What we take | What we leave |
|---|---|---|---|
| **Android** | Apps declare shortcuts and notification channels; the person pins and mutes them. Permissions are asked at use, per device. A process can die at any time, so state is saved as you go. Dots on icons come from notifications. | Signals are channels: the applet declares, you choose. Badge and notification are one signal. Layer 3 is Android's rule: being killed is normal. | A launcher whose layout lives apart from the apps. |
| **PWA manifest** | One JSON: `start_url`, `shortcuts`, `file_handlers`; a badge set from a push. | What an applet opens is declared by it and chosen by you. A push sets the badge. | One manifest per app, with no way to compose several. |
| **Tauri capabilities** | Files apart from the config say which windows (by glob) get which permissions. | Wildcards choose what is in scope; permission is a separate file. That is sources and approvals. | Permissions fixed at build time. |
| **Obsidian** | `community-plugins.json` in the vault is a plain list of enabled plugins, and syncs. A device still asks once whether to trust the vault's plugins. | The list lives in the vault, and each device asks once. | No code hash: a synced plugin update runs unasked. We pin. |
| **Nostr NIP-89** | An app publishes "I handle kind K"; a person signs "for K, I use this one". | The same split: an applet's `opens` says what it can open; yours picks. | Publishing it to relays. |
| **Nostr NIP-78, NIP-51** | Signed, replaceable events hold an app's data and a person's lists. | The envelope for an approval. | Relays as the store. Ours is the vault. |
