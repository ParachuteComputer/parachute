# Parachute Simplified

For a person who keeps notes on Parachute (Parachute Cloud, most often) and wants them on their phone: their vaults
and notes, a journal, a quick way to get something in, and a way to connect their AI. No rooms, keys or approvals. It
is the same Parachute app with a smaller set of screens, and Settings switches between the two. Its id stays `simple`
(the settings note's `app`, the record `Parachute/Apps/simple`), so nothing written before changes.

**Which applets, and why.** The same applets as the full app wherever they make sense for most people, without the
complex ones. From the full app it takes **Journal**, the same applet and code. It keeps its own **Notes**, **Capture**
and **Connect**. It leaves out **Rooms** and approval cards (they need a relay, a key and an agent), **Mail** (it goes
through a mail gateway that checks a key's signature; a Cloud account has neither), the agent's applets (accounts,
areas), Matrix, and the key and pairing screens. A person who has another applet adds it as any applet.

## What a person sees

| | Where | What it does |
|---|---|---|
| **Notes** | the home (`/`) | Every vault's newest notes in one list, a search across all of them, the vaults as tabs, **New note**. A note opens as it always does, with **Edit**. |
| **Journal** | the bar | The Uni app's Journal: a line a day or many, written or said, kept by day in the home vault's `Journal/`. **Add Journal** (one tap) writes it in as `Applets/Journal`, as Capture is added. |
| **Capture** | the bar | Write a line, or **Say it** (the app's own recorder): it lands in the home vault's `Inbox/` as a note of its own, and a voice note gets its words from the hub's transcription. |
| **Vault** | the bar | Parachute's own viewer ([VAULT.md](VAULT.md)): each vault's types and counts, a type's records as a table, a record's fields (changed where they stand), words, links and history. A note no other applet opens opens here. |
| **Connect** | the bar | Each vault's connector address (`https://…/vault/<name>/mcp`) with **Copy**, and how to add it to Claude and ChatGPT. |

The bar says **Notes · Journal · Capture · Vault · Connect**; Journal, Capture and Vault are each added with one tap. Settings (the foot of Notes, or ⋯ on the other screens) has
**Your bundle: Parachute Simplified / Everything**.

On a phone's first run the first choice is **Sign in with Parachute Cloud** (an email, no key); the key's ways come
after it.

## Who gets it

`parachute.bundle` in the settings note (and `app`, its older name, with the same id until 2026-12-20: write both) (`Parachute/Settings` in the home vault, [NAVIGATION.md](NAVIGATION.md)) says
which bundle the person's devices open: `"simple"` or `"everything"`. Absent means everything, as before.

A person new to the app on Parachute Cloud gets `"simple"`. That is a first sign-in, on a device that had no home, to a
hub whose descriptor says `door: "cloud"`, whose home (the one vault the sign-in reads, [design/SCOPES.md](design/SCOPES.md))
was read and holds no settings note. The sign-in reads the home and doesn't write it, so this device opens Parachute
Simplified at once, and the settings note with `bundle: "simple"` (and their list of Parachutes) is written the first time the
person lets Parachute change notes in their home: their first edit, or adding Journal or Capture. A settings note already there
is never changed this way. Anyone else starts as before. Settings changes it, and so can their agent, by writing the
note.

## What it is made of (today's mechanisms)

- **Notes** is the built-in frame's home when `app` is `"simple"` (`src/frame/views/NotesHome.tsx`; the list of
  applets otherwise). It reads every vault this device holds through the frame's reads: the home at
  first, and each other vault once the person taps its **Open** line there (the hub asks to read that one).
- **New note and Edit** are a shell screen (`src/views/NoteEdit.tsx`), not the frame: a frame can be the person's
  own code from their vault, and it still writes nothing. The frame only sends the person there
  (`/v/<vault>/new`, `/v/<vault>/n/<id>/edit`). Edit saves with `if_updated_at`. If the note changed meanwhile (an AI
  wrote to it), the person chooses: **Keep mine** saves their words over the new version, and **Use theirs** drops their
  changes. There is no Edit on code or on the app's own notes. The first Save in a vault Parachute only reads asks
  first (*Let Parachute change notes in …?*, then the hub's page), and the person saves again after.
- **Capture** is an ordinary applet: `applets/capture.json` and `.tsx`, shipped with the app. **Add Capture** (one
  tap, on the bar's Capture place) writes it into the home vault as `Applets/Capture`. Its card then asks, as any
  applet's does: read, add and change notes in `Inbox/`, the microphone through the app, and to open the notes you tap
  in it (a capture opens in the app, where it can be edited). It uses the kit only
  (`vault`, `voice.record`, `vault.attach` with `transcribe`, `Link`).
- **Journal** is the Uni app's own applet (`applets/journal.json` and `.tsx`), the same code. **Add Journal** writes it
  in as `Applets/Journal`; its card asks for `Journal/` (read, add, change), the microphone through the app, and
  opening the entries you tap. Both one-tap adds are one module (`src/applet/shipped.ts`) and one screen
  (`src/views/ShippedEntry.tsx`, at `/capture` and `/journal`).
- **Home** (`applets/home.json`, `.tsx`) is Parachute Simplified's starter home applet, shipped with the app's other
  records: a greeting, a line that lands in `Inbox/` (as Capture names it), your newest notes across your vaults, and
  your pins. It goes in as any applet does (`scripts/install-applets.ts --applet home --start home`), its card asks
  (add notes in `Inbox/`, the newest notes' titles, the bar, going somewhere on a tap), and the settings note's `start`
  makes it open first. It is an ordinary applet: the person or their AI can change it.
- **Connect** is a shell screen (`src/views/Connect.tsx`): each opened vault's address is the vault's own (Parachute Cloud's
  Connect page gives the same one), and copying needs the app's own clipboard.

Why not more applets: an applet reaches only its own vault and only by folder (`fields.applet.access`), and the app
never tells it which vaults the person has. A Cloud person's notes sit at the root of several vaults, so a Notes
applet couldn't see them. Notes needs every vault, and Connect needs every vault's address, so both are the app's own
screens. Capture and Journal each write into one folder of one vault, so they can be applets.

## As a bundle record

Parachute Simplified is one of the two bundles the app always has ([NAVIGATION.md](NAVIGATION.md#bundles)): the settings note's
`bundle: "simple"` names it (`app: "simple"` before 11-20, still read). A record `Parachute/Bundles/simple` (`"look": "notes"`) changes
it, for instance to put more on its bar; the Notes home, Journal, Capture, Vault and Connect stay its places. Its
`sources` don't narrow Notes, which shows every vault this device holds. Journal's and Capture's code come with the
app and are written into the vault on a tap; each card then asks as any applet's does.

## What this replaces (subtract)

Nothing old runs beside it. For a new Cloud person, the old launcher's "No applets here yet." chapters and the key-first
first screen are replaced by Notes and **Sign in with Parachute Cloud**. Everyone else's app is unchanged, and **Your
app** switches between the two. Its bar is still drawn by the shell (`src/shell/BottomBar.tsx`) from the app's `look`;
a record can add places after Notes, Journal, Capture, Vault and Connect. `src/applet/shipped.ts` and `ShippedEntry` replace
Capture's own `capture.ts` and `CaptureEntry` (11-20): one way to add a shipped applet, not one per applet.
