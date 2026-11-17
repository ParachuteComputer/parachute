# The Uni app, rebuilt as applets: what is here

Every feature of the Uni app (`uni-app-pipeline`, 0.5.1) a person uses, and where it is in Parachute: **built** (with
how it was tested), **part** (what is missing), or **left** (and why). Tests named `e2e/…` run in the browser against
the web build; "real relay" and "real mail" mean our Buzz relay with production's auth settings and a Stalwart behind
the Uni app's mail gateway (e2e/services/README.md); "CI" means it runs on every pull request.

## Rooms (applets/rooms.tsx)

| Feature | State | Tested |
|---|---|---|
| Room list: your rooms (NIP-29 membership), newest first, glyph, time, last line "who: text" | built | e2e/rooms.spec.ts, real relay |
| Unread count and "@" when you are named, from the Uni app's own read markers (kind 30078, sealed to you); a room with no marker yet shows no count, as in the Uni app | built | rooms.spec: a mention after you read shows "1 new, mentions you"; the marker on the relay is sealed |
| "Wants you" on a row for an open ask | built | rooms.spec |
| Search across rooms | built (the relay's NIP-50 search) | by hand on the real relay; not in a spec |
| Messages: markdown (bold, italics, strike, code, fences, quotes, lists, tables, headings, rules), day lines, grouping, "New" line | built | rooms.spec (bold in a message) |
| Links | part: shown, underlined, with the address on hover; a tap doesn't open them (an applet can't open the web yet) | by hand |
| Threads: "N replies", the thread pane, replying in it | built | rooms.spec: the reply carries the root `e` tag; the count shows |
| Reactions: chips with counts, yours marked; add 👍 ❤️ ✓, take yours back | built | rooms.spec: kind 7 on the relay, the chip "including yours" |
| Edits shown "(edited)"; deletions hidden | built (shown) | not in a spec |
| Editing or deleting your own message (Delete asks for a second tap) | built | rooms.spec: the edit (kind 40003) and the deletion (kind 5) on the relay; the message gone from the room |
| Mentions: "@" lists the people in the room, picks one, notifies them (`p` tag) | built | rooms.spec: bob's `p` tag on the message |
| Typing ("X is typing…") | built | not in a spec (ephemeral) |
| Pictures: drawn from the relay's media server (read auth), sent from the device without their metadata | built | rooms.spec: bob's picture drawn at its size; alice's sent and drawn |
| Video | built (plays in the frame) | services.spec plays blob media; not with a real video |
| Voice notes: playback | built | rooms.spec: the voice note's duration read |
| Voice notes: recording | left: an applet frame has no microphone (the manifest's `reach: microphone` is refused). Needs a shell-owned recorder | — |
| Files other than pictures, video and voice: shown by name and size | part: no Open or Save (a sealed frame can't download) | — |
| Uni's ask cards (choose, do, tell, look): the buttons, the answer posted as the Uni app posts it, ended cards folded | built | rooms.spec: "North bed" picked; the answer's `q` tag and `uni-answer` block on the relay |
| Asks that approve or give (signed answers) | left on purpose: shown, "answered on a card in the Uni app" (an applet never approves) | — |
| Hermes's command prompts: Approve once, Deny (posts `/approve`, `/deny`); settled ones marked | built | rooms.spec: `/approve` on the relay |
| Uni's sealed credential cards (`uni-sealed-approval`) | left on purpose: shown with "answer it in the Uni app". Approving needs a screen the shell owns (SERVICES.md) | — |
| Secret requests (`uni-secret-request`) | left: same reason (gift wraps are never an applet's) | — |
| Quick replies (Yes / No / Not now under a question) | left | — |
| Load older messages | built | not in a spec |
| Drafts kept per room | left | — |
| Notifications and a badge when the app isn't open | left: an applet runs only while open | — |
| Uni's turn status line, Stop Uni, Uni listening/muted | left | — |

## Mail (applets/mail.tsx)

| Feature | State | Tested |
|---|---|---|
| Inbox, Drafts, Sent, Archive, Junk; unread count on Inbox | built | e2e/mail.spec.ts, real mail |
| Reading a thread (text, or the words of an HTML message; never its HTML), marked seen | built | mail.spec: bob's message read, then shown as seen |
| Search | built (JMAP text search) | mail.spec |
| Write, reply: save the draft, review exactly what will go, send | built | mail.spec: the reply reaches bob's inbox and is in Sent |
| Open and send a draft; discard | built | not in a spec |
| Flag, archive | built (when the gateway allows them) | not in a spec (a fresh mailbox has no Archive) |
| Attachments: shown by name | part: no download, no attaching | — |
| Uni's mailbox, held sends (approve or decline a send Uni parked) | part: a second mailbox is switchable; held sends aren't drawn | — |
| Later, Waiting (the Uni app's triage places) | left: the gateway has no triage yet | — |

## Journal (applets/journal.tsx)

| Feature | State | Tested |
|---|---|---|
| Write a line: a note in `Journal/YYYY/MM-DD/HH-MM <first words>`, tagged journal | built | e2e/journal.spec.ts, CI (core 0.8 and 0.9) |
| Entries by day, voice entries marked, a tally of the last four weeks | built | journal.spec |
| Voice entries (record, upload, transcribe) | left: no microphone in an applet (as voice notes) | — |
| Offline outbox | left: the applet saves when the vault answers | — |

## The rest of the Uni app

| Feature | State | Why |
|---|---|---|
| Home (the rooms list) | built: the Rooms applet is the home in the Uni layout (scripts/install-applets.ts) | — |
| Settings, the key, pairing a device | built in Parachute already (steps 3 and 7) | — |
| Vault browser and notes | built in Parachute already (the launcher, the vault view) | — |
| Search across the journal and vaults | part: each vault's search in the app; no one search across rooms and vaults | — |
| Calendar | left: the calendar door speaks NIP-98, so a calendar applet can declare it as a service; not written yet | next |
| Decisions | left | niche |
| Areas, To Post, Studio, Arcade, Usage, Route suggestions | left | niche or experimental in the Uni app |
| Messages over Matrix | part: applets/matrix.tsx reads and writes a homeserver's rooms with a token the person gives the app (e2e/matrix.spec.ts, a real homeserver). The Uni app's bridged networks (Signal, WhatsApp…) behind its Matrix door are not linked from here | — |
| Updates over the air | left: Parachute updates as an app | — |
| Unlock before powerful approvals | left with the approvals themselves | — |
