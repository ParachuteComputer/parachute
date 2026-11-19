# How an applet asks

One card per applet, on the screen where it would run. Nothing runs until Allow, and only a real tap counts. The card
has a short face and, under **Show details**, every exact line.

## How it looks (11-19, after Techne's consent page)

One screen, a few rows. At the top, where it comes from ("From your vault journal on uni.example"); an applet from
someone else's vault adds a tinted line: *Not made by you. Only continue if you trust the people who made it.* Each
row has a mark, a plain name (*Read Journal*, *Write in Journal*, *Act as you on relay.example*, *Small things*), the
face's own line under it, and **?**, which opens the exact detail: for notes, a table of the folder against Read,
Create, Update and Delete, and the hub scope it needs (`vault:journal:write`), towards which vault on which Parachute;
for a server, every line about it. The buttons are **Back**, **Deny** and **Allow**. On a device with your key, Allow
is an approval for every device ([APP-RECORD.md](APP-RECORD.md)); a device that finds one already says *You approved
this exact version on …* and **Continue** asks only its hub.

## The face (`src/applet/face.ts`)

It says what the applet would do by what it means to a person:

- **What it does as you on each server**, one line per server, with the key it signs with and that what it reads can go
  there: *As you on buzz.example.org (your everyday key): posts messages, reactions, edits and typing in your rooms,
  deletes what you posted, and uploads and opens files. What it reads can go there.*
- **The approval key**, its own line: *High risk, with your approval key: answers approval cards and secret requests
  from Uni there (your approval key is your everyday key for now). Powerful ones ask for your device unlock.* An
  approver this device doesn't trust is named by its whole key.
- **Notifications** (bold when a push gateway learns your public key and how to reach the phone), **links out**,
  **the newest titles in every vault**, **things from someone else's vault on its page**, **code from someone else's
  vault**: each its own line.
- **Its notes**: each folder it reads or changes, as the details say it.
- **Also**: the small everyday asks on one line: the microphone when you press record, files you pick, saving to
  Downloads, 256 KB for drafts, opening notes of a type you tap, your bar.
- **Someone else's vault** is said at the top, and on Android the card ends with *On this device an applet could send
  what it reads to the internet: allow only code you trust.*

Risk is marked by bold words and the words themselves (*High risk*, *As you*), never by colour alone.

The rule (`face.test.ts`): every line the details stress keeps its facts on the face (hosts, keys, the rooms an
applet names, an untrusted approver's key, the gateway). Only unstressed lines fold away: private notes, the note on
what an approval card shows, tagging, components from the applet's own vault.

**Show details** sits beside the buttons. On a page, opening it never moves Allow; on an embed's sheet (which grows upward) Allow settles again after each toggle, so a tap meant for something else can't land on it. It holds the old card,
word for word: every line from `grantLines`, the full closing sentence, when the grant ends, and its fingerprint.

## The hub's step

When the person's hub must be asked for more than the device holds of the applet's vault (its manifest adds or changes
notes, and the app reads that vault only), the card says so above its buttons: *Then your hub (uni.example) asks you to
let Parachute change notes in letters: only this vault.* Allow goes to the hub's page, and the grant is kept only when
the hub says yes ([SCOPES.md](SCOPES.md)). Revoke gives that write back to the hub when nothing else allowed there needs
it.

## Asking again

The card says why before anything else:

| Why | Heading | Line |
|---|---|---|
| Code changed, same asks | «Rooms» changed | …Only the version you allow runs (on Android: new code could send what it reads to the internet). *It asks for no new permissions.* Only when its card was kept, no line on it reads differently, no code from someone else's vault is new, and the device's mode held. |
| It asks for something else | «Rooms» asks again | It now asks for something other than what you allowed. What is new is marked **New** (on the face, or under Show details when only a detail changed). What it no longer asks isn't listed: a reworded or widened line would read as gone while it still holds. |
| Its year ran out | Allow «Rooms» again? («Rooms» changed, with Allow this version, when its code changed too) | A year has passed since you allowed it, so it asks again. |
| The device moved to approved code only | Allow «Rooms»? | You allowed it when applets here were sealed… (also said beside changed code or a year run out) |
| Changed since it was brought in from another vault | «Rooms» changed | techne changed «Rooms» since you brought it in. |

To mark what is new, a grant now keeps what its card said (`face`: the face's lines and every detail line) and its imports from someone else's vault
(`others`). A grant made before has neither: its card says plainly that it changed, and marks nothing.

## What didn't change

The grant's key (`grantKey`, v3), what is enforced at runtime, the manifest format, the unlock for powerful approvals,
the settle time on an embed's sheet. Every grant made before still holds; no applet record needs changing.
