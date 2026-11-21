# Parachute's own applets: trusted out of the box

Aaron (11-20): *"what if there are applets that are loaded directly from parachute.computer servers, which ensures they
are more trusted? And we have default applets in here that give you more default experiences of navigating your
knowledge vault."*

## The rule

An applet is Parachute's when the shell loaded it from **the Parachute source**, and for no other reason. The source is
the copy built into the app, plus updates published on parachute.computer and signed with Parachute's release key, whose
public half is built into the app. Nothing in a vault makes an applet Parachute's: not an id, a path, a name, a tag, a
field or a hash. Parachute's applets never load from a vault, so a vault (or the hub, or an AI that can write it) has
nothing to swap.

| | Where its code comes from | Card |
|---|---|---|
| Parachute's own: Notes, Journal, Capture, Vault, Connect, Home | the app's copy, or a signed update newer than it | none |
| The person's own, an AI's, someone else's | a note in a vault | asks, as before; again when the code changes |

**Why no card for Parachute's own.** The person trusted Parachute's code when they installed the app: the shell that
draws every card is that code. A card for Parachute's own applets asks them to judge what they have already trusted,
and teaches them to tap Allow without reading, which is the habit the card exists to stop. What an applet may do is
still enforced the same way: each runs sealed in its frame, and the shell checks every call against its manifest
(folders, app words). Only the asking goes. Their notes still need the hub's yes: the home is asked at write when
Parachute signs in (docs/design/SCOPES.md).

## Where they run

At `/v/<home>/a/parachute:<id>`, in the home vault. `parachute:` can't be a note id (the hub makes ULIDs), and the
applet screen decides by the address before it reads anything from a vault: the hub is never asked for a note of that
name. Elsewhere than the home, the address goes to the home's. Their saved state, counts and drafts are kept as any
applet's, under that address. They start without a tap (the person's own code waits for one), and whatever the
sandbox self-test found (it guards against code the person hasn't trusted), but not while it runs: its probes' escapes
would stop any frame beside them, so a device's first start waits those few seconds. The Everything list shows them
first, in the home; a vault's own list doesn't (they aren't in it).

## Updates

`https://parachute.computer/applets/index.json` is a signed event (kind 30481, `d` = `parachute-applets`), signed by a
key on the app's list (`PARACHUTE_KEYS`, `src/applet/parachuteSource.ts`). Its content names each applet's version,
the oldest app level it needs, its record (path, fields) and the sha256 of its code, which sits beside it at
`<sha256>.<extension>`. The app reads it once each time it starts, and takes an update only when:

- the signature holds and its key is on the list;
- its number `n` is higher than the highest this device has taken (an older index put back is refused);
- the applet's version is higher than the app's own copy (`version` in `applets/<name>.json`), and its level is one
  this app has (`needs`, VERSIONS.md);
- its code hashes to the index's sha256, and it imports and embeds nothing (nothing of a vault comes into a frame with
  no card).

The update is kept on the device with its index, and checked again (signature and hash) each time it loads. Anything
that fails leaves the app's own copy. `scripts/publish-applets.ts` writes the index and code from `applets/` and signs
with the key in a file named on its command line.

**The release key.** None is listed yet, so this app runs its own copies and asks parachute.computer for nothing. The
key is Aaron's to make, on a machine that runs no agents; its public half goes in `RELEASE_KEYS`, which takes an app
release. Whoever holds it can ship code that runs as Parachute's, the same power as an app update.

## In the bundle

The source is an entry in the bundle record: `"publishers": [{ "url": "https://parachute.computer/applets/" }]`. Both
bundles the app ships say it. A record that says `"publishers": []` leaves Parachute's own out: not listed, not on the
bar, not where a record opens, and their addresses say so (`src/shell/bundles.ts` `parachute`). A record that says
nothing takes its default's; a bundle of the person's own with no default (Aaron's `uni`) offers them only once it names
them. A record can only name the source or leave it
out: a key in it is read as nothing, since Parachute's keys are the app's own (`bundleTrust.test.ts`).

**Someone else's source, not built yet.** The index and its checks are written for any publisher and key, so Techne or
a company can publish the same way; what is missing is the person's yes to a new key: one card naming the address and
key and listing its applets and what each asks, after which its signed updates run without asking, unless one asks for
more. Until then, a `publishers` entry other than Parachute's is read as nothing.

## What it holds against

| Who | Tries | Result (test) |
|---|---|---|
| Someone who can write the vault | A note at `Applets/Capture` (or any path), tagged applet, with Capture's manifest id and name | Ordinary applet: its card asks (`e2e/parachute.spec.ts`) |
| | A note whose id is `parachute:capture` | Never read: the address decides first (`parachuteSource.test.ts`, e2e) |
| The hub, or anyone on the network | A forged index | Refused: not signed by a listed key (`parachuteSource.test.ts`) |
| | An index signed by the release key, put back after a newer one | Refused: its number is not higher |
| | Code that doesn't match the index's hash | Refused; the app's copy runs |
| | An update an older build can't run | Not taken (`needs`) |
| | An update that imports a component from the vault | Refused (`e2e/parachute.spec.ts`) |
| Whoever holds the release key | Any code, as Parachute | Runs. The same power as shipping an app update; the key is kept off every machine that runs agents (open: Aaron's to make) |

## What the shell gave up (subtract)

| Was in the shell | Now | Goes |
|---|---|---|
| Notes (the frame's `NotesHome.tsx`) as Simplified's home | Parachute's Notes applet | now; the frame's stays only at `/?with=vault`, the way back |
| Connect (`src/views/Connect.tsx`, its own copy button) | Parachute's Connect applet; `copy` an app word, on a tap | now (deleted) |
| **Add Capture**, **Add Journal**, **Add Vault**: a write into the home, then a card (`src/applet/shipped.ts`, `src/views/ShippedEntry.tsx`) | Parachute's own, no write, no card | now (deleted); `/capture`, `/journal`, `/vault`, `/connect` lead to the applet |
| A note opening in the plain note view, Edit in the shell's editor (`NoteEdit.tsx`, Keep mine / Use theirs) | Vault, Edit words (a conflict reads the note again and keeps the words) | now; plain view and editor stay at `?with=vault` |
| A vault's address opening the plain vault view | Vault | now; plain at `?with=vault` |
| "Add Vault" in the list, and the line over plain views that adds it | nothing to add | now |
| The bundle notices on Notes ("Your bundle didn't load") | the list's (Everything) only | now: Simplified no longer says it (gap) |
| The first write ask in the home (a hub page, then "do it again") | the home at write from the sign-in | now; other vaults still ask, and the person saves again after (gap) |
| Copies already in a vault (`Applets/Capture`, `Applets/Vault`, Aaron's too) | stay the person's own applets, with their card; Notes labels them "your copy of Parachute's Capture". The bar now leads to Parachute's own, whose drafts are its own: a draft kept by the copy stays with the copy | their call |
| A vault's address and a note opening in the plain views, for Everything too | Vault, wherever the open bundle keeps Parachute's own; a bundle that leaves it out uses a Vault copy in the home, as before | now |

## What a newcomer on Parachute Cloud sees

Until Cloud runs its PR (the Parachute app's reserved client, ParachuteComputer/parachute-cloud): its two pages, *see
your vaults* and *read and write your home*, say "Connect Vault app" under "Unverified app", because the app registers
itself there. With it, they say "Connect Parachute" and nothing about unverified (the app reads Cloud's
`app_client_id`). No card and no third page after that: Capture, Journal and Notes save at once.
