# How an applet asks

One card per applet, on the screen where it would run. Nothing runs until Allow, and only a real tap counts. The card
has a short face and, under **Show details**, every exact line.

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

**Show details** sits beside the buttons, so opening it never moves Allow under a finger. It holds the old card,
word for word: every line from `grantLines`, the full closing sentence, when the grant ends, and its fingerprint.

## Asking again

The card says why before anything else:

| Why | Heading | Line |
|---|---|---|
| Code changed, same asks | «Rooms» changed | …Only the version you allow runs. *It asks for nothing new.* (only when no code from someone else's vault is new either) |
| It asks for something else | «Rooms» asks again | It now asks for something other than what you allowed. What is new is marked **New**; what went is listed. |
| Its year ran out | Allow «Rooms» again? | A year has passed since you allowed it, so it asks again. |
| The device moved to approved code only | Allow «Rooms»? | You allowed it when applets here were sealed… |
| Changed since it was brought in from another vault | «Rooms» changed | techne changed «Rooms» since you brought it in. |

To mark what is new, a grant now keeps what its card said (`face`) and its imports from someone else's vault
(`others`). A grant made before has neither: its card says plainly that it changed, and marks nothing.

## What didn't change

The grant's key (`grantKey`, v3), what is enforced at runtime, the manifest format, the unlock for powerful approvals,
the settle time on an embed's sheet. Every grant made before still holds; no applet record needs changing.
