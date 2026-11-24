# The Uni app, rebuilt as applets: what is here

The readiness gate for switching (what is done daily, its test, its status) is [SWITCH.md](SWITCH.md); this is the full list.

Every feature of the Uni app (`uni-app-pipeline`, 0.5.1) a person uses, and where it is in Parachute: **built** (with
how it was tested), **part** (what is missing), or **left** (and why). Tests named `e2e/…` run in the browser against
the web build; "real relay" and "real mail" mean our Buzz relay with production's auth settings and a Stalwart behind
the Uni app's mail gateway (e2e/services/README.md); "CI" means it runs on every pull request; the real-server tests run in the Services workflow (daily, and on every pull request but a docs-only one).

## Rooms (applets/rooms.tsx; a room is applets/room.tsx)

The list, search and read state are the Rooms applet; a room itself (messages, threads, the composer, cards, Uni's turn)
is the Room component, which Rooms and every area's applet import (`import Room from "component:room"`), so a fix to a
room reaches both.

| Feature | State | Tested |
|---|---|---|
| Room list: your rooms (NIP-29 membership), newest first, glyph, time, last line "who: text" | built | e2e/rooms.spec.ts, real relay |
| The list paints at once when Rooms opens: as it was last shown on this device (its share of `storage`, 64 KB), then the relay read again, its queries side by side, in its place | built | rooms.spec: the list shows with the relay held away |
| Unread count and "@" when you are named, from the Uni app's own read markers (kind 30078, sealed to you); a room with no marker yet shows no count, as in the Uni app | built | rooms.spec: a mention after you read shows "1 new, mentions you"; the marker on the relay is sealed |
| "Wants you" on a row for an open ask | built | rooms.spec |
| Search across rooms | built (the relay's NIP-50 search); a hit opens its room at that message, marked | rooms.spec: "seed potatoes" found, the room opened at it |
| Messages: markdown (bold, italics, strike, code, fences, quotes, lists, tables, headings, rules), day lines, grouping, "New" line | built | rooms.spec (bold in a message) |
| Links | built: a tap opens http, https and mail links in the browser, through the shell (`app.openLink`, the `links` line on the card, KEYRING.md) | e2e/devices.spec.ts: the shell's open called with the link |
| Note links | built: `uni:<ULID>` (any `<vault>:<ULID>` of a vault the person has), a note's address and a `[[wikilink]]` open the note in the app, through the kit (`Link`, `Linked`, `Note`; the `open` line on the card); a vault name they don't have stays text | e2e/notelinks.spec.ts; e2e/roomlinks.spec.ts (a real relay) |
| Threads: "N replies", the thread pane, replying in it | built | rooms.spec: the reply carries the root `e` tag; the count shows |
| Reactions: none shown, none sent (Aaron, 11-18: "I don't really use them"); Uni's 👀 still drives "Uni is working" | removed on purpose | rooms.spec: no React buttons, a reaction draws nothing; the working test |
| Edits shown "(edited)"; deletions hidden | built (shown) | not in a spec |
| Editing or deleting your own message (Delete asks for a second tap) | built | rooms.spec: the edit (kind 40003) and the deletion (kind 5) on the relay; the message gone from the room |
| Mentions: "@" lists the people in the room, picks one, notifies them (`p` tag) | built | rooms.spec: bob's `p` tag on the message |
| Typing ("X is typing…") | built | not in a spec (ephemeral) |
| Pictures: drawn from the relay's media server (read auth), sent from the device without their metadata | built; picked on the shell's own picker (`app.pick`, `attach`) | rooms.spec, devices.spec: bob's picture drawn at its size; alice's picked, sent and drawn |
| Video | built (plays in the frame) | services.spec plays blob media; not with a real video |
| Voice notes: playback | built | rooms.spec: the voice note's duration read |
| Voice notes: recording | built: the shell's own recorder, at the foot of the screen with the applet still scrolling above it (`reach: [voice]`, `voice.record`), recording from the one tap as the Uni app's does (2 taps idle to sent, as there; T-476, on the emulator: 1.34 s → 0.13 s from the tap to recording, a machine tapping as fast as the recorder allowed), sent as the Uni app sends one. Not ported: Pause and its sections. Not on Linux desktop (the webview's media is off there) | e2e/devices.spec.ts: Chromium's fake microphone; the note on the relay with its imeta, played back. e2e/voice.spec.ts: recording within a moment of the one tap, stopped and kept on going to the background, Cancel lets the microphone go; the room and the journal scroll under a finger while it records (devices, voice) |
| Files other than pictures, video and voice: shown by name and size, Save | built: Save puts it in Downloads through the shell (`app.save`); no Open | e2e/devices.spec.ts: the download, with bob's bytes |
| Uni's ask cards (choose, do, tell, look): the buttons, the answer posted as the Uni app posts it, ended cards folded | built | rooms.spec: "North bed" picked; the answer's `q` tag and `uni-answer` block on the relay |
| Asks that approve or give (signed answers) | built: answered on Uni's sealed card in the same room (below) | e2e/approvals.spec.ts |
| Hermes's command prompts: Approve once, Deny (posts `/approve`, `/deny`); settled ones marked | built; only with the approvals grant, on a tap (until Hermes takes sealed answers, KEYRING.md) | rooms.spec: `/approve` on the relay; approvals.spec: refused without the grant |
| Uni's sealed credential cards (`uni-sealed-approval`, morning cards): checked as the Uni app checks them, Approve / Hold to approve (powerful) / Deny, answered with the approval key (gift wrap, rumor 46042) | built (KEYRING.md): the `approvals` grant line, keys trusted on this device, the device unlock for powerful ones, a grace of 300 s for routine ones on Android | e2e/approvals.spec.ts (real relay, the answer opened as Uni checks it); cargo `approvals` (the Uni app's tests, and Uni's own verifier run locally); the emulator |
| Secret requests (`uni-secret-request`): typed on the app's own sheet, sealed (rumor 46040); "ask Uni to forget it" (46041) | built (KEYRING.md) | e2e/approvals.spec.ts: the value reaches Uni sealed, never the frame |
| Quick replies (Yes / No / Not now under a question) | built: under the room's newest message when it is someone else's yes-or-no question (the Uni app's rule), none while an ask waits or Uni works; a tap posts the word, naming Uni only while it listens | rooms.spec: Yes posted, with Uni's `p` |
| Load older messages | built | not in a spec |
| A room opens at once (from the messages the list read, as the relay signed them; its own read fills in, and it is placed at its foot again then, for browsers without scroll anchoring), and where you left it; the list keeps its scroll | built | rooms.spec: the newest line within 1.5 s with the room's read held 4 s; at its foot after the read with anchoring off; back at the same distance from its foot |
| Drafts kept per room and per thread | built: on this device, in the shell's storage for the applet (`storage`, 256 KB), as the Uni app keeps them: the text and the @names it settled on; a send clears it only if you didn't write more meanwhile | devices.spec: back after leaving and reopening; rooms.spec: back after another room, its mention still naming Bob when sent |
| Notifications and a badge when the app isn't open | built on Android through UnifiedPush (ADDENDUM-PUSH, SERVICES.md "Notifications through an open push service"): the rooms service's `notify` names a push gateway (services/push-gateway, its own key, run beside the relay), which pushes a sealed "a message for you" (room and message, no words, no author) through the phone's distributor (ntfy from F-Droid; no Google). A tap opens Rooms at that message after Open. Signals (APP-RECORD.md): an applet's count on the bar unless it is the screen in front (Ideas: notes someone else adds, counted live by the open app; Rooms: counted by the gateway; Mail: its own unread) and on the phone "Ideas · 2 new" through the same gateway. Without a working distributor (GrapheneOS with nothing installed): Parachute's own connection, on by default, with **Get ntfy** offered first in Settings. Google's FCM and Apple's APNs are left for later (Aaron, 11-17: GrapheneOS first; what each needs is in SERVICES.md). Desktop: nothing while closed | services/push-gateway: unit tests and an e2e (relay → gateway → throwaway ntfy); the emulator (de-Googled path): with ntfy installed, and with ntfy removed (the own connection), Parachute swiped away each time; signals: e2e/signals.spec.ts (real hub), signalBook.test.ts, and the emulator (badge with Ideas closed; "Ideas · 2 new" with Parachute swiped away, through ntfy) |
| Uni's turn status line, Stop Uni, Uni muted | built: Uni's 👀 on your message starts one quiet line ("Thinking it through · 42s", or what its newest ping says it is doing), its "⏳ Working" pings are one quiet line (folded after an hour), Stop Uni posts `/stop` naming Uni; Uni hears every room and nothing says so (the Uni app's "Uni listening" switch is gone, Aaron 11-22); a room muted by an older build says "Uni muted", its messages don't name Uni, and a tap lets Uni listen again. Uni is the key the rooms service answers cards from (`approvals.from`, else `notify.from`). Not ported: the "Passing it to Uni" wait before its 👀, and the "Worked 41s" receipt | rooms.spec: the line from bob's 👀 and ping, `/stop` with Uni's `p`, no listening line, a muted room's message without it and with it after the tap |

## Mail (applets/mail.tsx)

| Feature | State | Tested |
|---|---|---|
| Inbox, Drafts, Sent, Archive, Junk; unread count on Inbox | built | e2e/mail.spec.ts, real mail |
| Reading a thread (text, or the words of an HTML message; never its HTML), marked seen | built | mail.spec: bob's message read, then shown as seen |
| Search | built (JMAP text search) | mail.spec |
| Write, reply: save the draft, review exactly what will go, send | built | mail.spec: the reply reaches bob's inbox and is in Sent |
| Open and send a draft; discard | built | not in a spec |
| Flag, archive | built (when the gateway allows them) | not in a spec (a fresh mailbox has no Archive) |
| Attachments | part: a message's files are listed with their size, and **Save** puts one in Downloads (its bytes from the gateway's `raw`, the shell's `save`). Attaching a file to a message written here is left (the gateway's `draft.save` takes attachments; the shell's `attach` is there to use) | mail.spec: bob's file saved, with his bytes |
| Uni's mailbox, held sends: **Waiting** (approve or decline a send Uni parked, the whole draft shown first) | built: Approve is signed with the approval key (the mail service's `approve`, KEYRING.md), behind the device unlock in the app; Decline with the everyday key. The gateway still decides by the key it maps until it is told the approval key | mail.spec: one approved (bob gets it), one declined (nobody does); real gateway copy |
| **Later** (the Uni app's \$flagged triage; Inbox hides a Later thread until something new comes in) | built | mail.spec: Later puts a thread off and Not later brings it back |

## Journal (applets/journal.tsx)

| Feature | State | Tested |
|---|---|---|
| Write a line: a note in `Journal/YYYY/MM-DD/HH-MM <first words>`, tagged journal | built | e2e/journal.spec.ts, CI (core 0.8 and 0.9) |
| Entries by day, voice entries marked, a tally of the last four weeks | built | journal.spec |
| Voice entries (record, upload, transcribe) | built: recorded on the shell's sheet, written as the Uni app writes one, the recording attached with transcribe asked (`vault.attach`); "Transcribing…" while the hub works, read again ten times | e2e/devices.spec.ts on core 0.8 and 0.9: the attachment and the hub's transcribe mark |
| Offline outbox | built: a line the vault can't be reached for is kept on the device (written to disk at once), listed under "Waiting to be saved", and sent in order under the minute it was written when Journal starts or is shown again, the app comes back, or on Try now (which says when it still can't reach the vault); one sent before whose answer was lost counts as sent, not saved twice; a refusal by the app itself (scope, bad words) is said and the words stay. The app answers any failure at the hub as one 502, so a line the hub itself refuses waits too | journal.spec: offline, a line waits and survives a restart; a second queues behind; Try now offline says so; back online, both go in under their minutes; a write that landed with its answer lost is one note |

## The rest of the Uni app

| Feature | State | Why |
|---|---|---|
| Home (the rooms list) | built: the Rooms applet is the home in the Uni layout (scripts/install-applets.ts) | — |
| Applets from the Uni app's drawer (a note tagged `applet` in any vault: Recipes in its own vault `recipes`, made with uni-ops `applet publish`) | built: they run as they are. Parachute's kit is the Uni app's contract 2 (`window.uni`, the same manifest and vault calls), and the Applets list takes applets from every vault on the device (in a bundle, those its `source` allows: the Uni layout's is `*`); the person signs in to that vault and allows the applet once. Not covered by a test: its search box (`queryNotes` with `search`) | e2e/drawer.spec.ts: published as `applet publish` writes it, in a vault that isn't home: listed, allowed, a recipe read, marked made and edited (each update conditioned on what the last answered; one made after a change elsewhere is refused, in the applet's words), one added and opened by the id answered, each checked in the vault (CI: a fixture with Recipes' controls and calls; with UNI_APPLET_DIR the real Recipes, green 11-21) |
| Settings, the key, pairing a device | built in Parachute already (steps 3 and 7) | — |
| Vault browser and notes | built in Parachute already (the launcher, the vault view) | — |
| Search across the journal and vaults | part: each vault's search in the app; no one search across rooms and vaults | — |
| Calendar | part: applets/calendar.tsx over the calendar door (a service, NIP-98, signed by the shell): the next two weeks by day, an event's detail (place, notes, who), Add, Move and Cancel (one day of a series), the last two weeks kept on the device for when the door can't be reached. Left in the Uni app for now: the week grid and dragging, editing a series or its words, invites, who can see it, conflicts | e2e/calendar.spec.ts (CI: a fake door with the door's own checks; locally against `uni-cal serve` on a throwaway vault); cargo `calendar_door` (the native signer against the real door, run by hand) |
| Decisions | left | niche |
| Areas | part: an applet per area (applets/area.tsx: its room with Uni beside its notes, its grant one room and one folder; WRITE-AN-APPLET.md "An applet for an area"). The Uni app's area screens are not ported one by one | e2e/area.spec.ts |
| To Post, Studio, Arcade, Usage, Route suggestions | left | niche or experimental in the Uni app |
| Rooms' session view (a project's sessions: working now, how each ended, its steps; T-302/T-304/T-319) | part: applets/sessions.tsx, per room rather than per project, from the same run notes and steps notes, with the same redaction rules and cases (src/applet/redaction-vectors.json) and cost once mts writes it on the note; read again when shown or pulled (the Uni app read every 10 s); the 50 sessions changed last, the most the kit reads at once (the Uni app read 60 days) | e2e/sessions.spec.ts |
| Messages over Matrix | part: applets/matrix.tsx reads and writes a homeserver's rooms with a token the person gives the app (e2e/matrix.spec.ts, a real homeserver). The Uni app's bridged networks (Signal, WhatsApp…) behind its Matrix door are not linked from here | — |
| Updates over the air | built differently: the Uni app swaps its screens over the air and offers a new APK to download; Parachute offers each newer build (the APK, or the Mac's dmg) from its build's feed, above the bar and in Settings → Updates, and the system installs it (docs/LAUNCH.md §3) | src/shell/updates.test.ts; the emulator (an older build offered the newer one, and Android installed it over) |
| Claude accounts ("New workers use": Auto / A until reset / B until reset; #systems 11-17) | part: applets/accounts.tsx shows each account's use (week, Fable week, session; paused at the launcher's stop, a stale reading said so) and which one new workers use, from the launcher's note `System/Claude accounts`, on its own screen and as a section of Settings (`fields.settings`, 11-22). Setting it is left: the flag is that note's metadata, and an applet's `vault.update` writes a note's text only (the contract shared with the Uni app). Until a narrow metadata write exists, `mts prefer` sets it | e2e/accounts.spec.ts |
| Joining a private network (WireGuard with a Nostr-signed member list, ~/Code/mesh) | the app's half built (a `join` op signed after the passcode and unlock, KEYRING.md "Joining a network"); the enroller and the tunnel are #systems' | services.rs |
| Unlock before powerful approvals, and its grace | built: Android BiometricPrompt (biometric or screen lock), macOS LocalAuthentication, a native OK/Cancel on Linux and Windows. The grace (300 s, routine only, per applet, ending when the screen goes off) is on Android only: the desktop asks every time (the Uni app watches the screen lock there; not ported) | emulator (PIN); approvals.spec (the web build's stand-in) |
| Security levels per action (none, unlock, passcode), the idle lock (APP-RECORD.md "Security levels") | built, native on every platform. The idle lock counts every touch on Android; on a computer, the touches the shell's window sees (a tap or a key in an applet counts, reading and scrolling there alone don't). A browser tab has neither (no key, no unlock) | levels.rs, levels.test.ts, levels.spec; emulator |
| A separate approval key; keys trusted for approvals | built: Settings → Approvals (make one, copy its enrollment for Uni, use the everyday key again; trust or stop trusting a key) | emulator |
