# The simple app

For a person who keeps notes on Parachute (Parachute Cloud, most often) and wants them on their phone: their vaults
and notes, a quick way to get something in, and a way to connect their AI. No rooms, keys or approvals. It is the
same Parachute app with a smaller set of screens, and Settings switches between the two.

## What a person sees

| | Where | What it does |
|---|---|---|
| **Notes** | the home (`/`) | Every vault's newest notes in one list, a search across all of them, the vaults as tabs, **New note**. A note opens as it always does, with **Edit**. |
| **Capture** | the bar | Write a line, or **Say it** (the app's own recorder): it lands in the home vault's `Inbox/` as a note of its own, and a voice note gets its words from the hub's transcription. |
| **Connect** | the bar | Each vault's connector address (`https://…/vault/<name>/mcp`) with **Copy**, and how to add it to Claude and ChatGPT. |

The bar says **Notes · Capture · Connect**. Settings (the foot of Notes, or ⋯ on the other screens) has **Your app:
Simple / Everything**.

On a phone's first run the first choice is **Sign in with Parachute Cloud** (an email, no key); the key's ways come
after it.

## Who gets it

`parachute.app` in the settings note (`Parachute/Settings` in the home vault, [NAVIGATION.md](NAVIGATION.md)) says
which app the person's devices open: `"simple"` or `"everything"`. Absent means everything, as before.

A person new to the app on Parachute Cloud gets `"simple"`. That is a first sign-in, on a device that had no home, to a
hub whose descriptor says `door: "cloud"`, whose home (the one vault the sign-in reads, [design/SCOPES.md](design/SCOPES.md))
was read and holds no settings note. The sign-in reads the home and doesn't write it, so this device opens the simple
app at once, and the settings note with `app: "simple"` (and their list of Parachutes) is written the first time the
person lets Parachute change notes in their home: their first edit, or adding Capture. A settings note already there
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
- **Home** (`applets/home.json`, `.tsx`) is Parachute Simplified's starter home applet, shipped with the app's other
  records: today's date, a line that lands in `Inbox/` (as Capture names it), your newest notes across your vaults, and
  your pins. It goes in as any applet does (`scripts/install-applets.ts --applet home --start home`), its card asks
  (add notes in `Inbox/`, the newest notes' titles, the bar, going somewhere on a tap), and the settings note's `start`
  makes it open first. It is an ordinary applet: the person or their AI can change it.
- **Connect** is a shell screen (`src/views/Connect.tsx`): each opened vault's address is the vault's own (Parachute Cloud's
  Connect page gives the same one), and copying needs the app's own clipboard.

Why not three applets: an applet reaches only its own vault and only by folder (`fields.applet.access`), and the app
never tells it which vaults the person has. A Cloud person's notes sit at the root of several vaults, so a Notes
applet couldn't see them. Notes needs every vault, and Connect needs every vault's address, so both are the app's own
screens. Capture writes into one folder of one vault, so it can be an applet.

## As an app record

Simple is one of the two apps the app always has ([NAVIGATION.md](NAVIGATION.md#apps)): `Settings.app: "simple"`
names it, the same field with the same value as before. A record `Parachute/Apps/simple` (`"look": "notes"`) changes
it, for instance to put more on its bar; the Notes home, Capture and Connect stay the app's own screens. Its
`sources` don't narrow Notes, which shows every vault this device holds. Capture's code
comes with the app and is written into the vault on a tap; its card then asks as any applet's does.

## What this replaces (subtract)

Nothing old runs beside it. For a new Cloud person, the old launcher's "No applets here yet." chapters and the key-first
first screen are replaced by Notes and **Sign in with Parachute Cloud**. Everyone else's app is unchanged, and **Your
app** switches between the two. The simple app's bar is still drawn by the shell (`src/shell/BottomBar.tsx`) from the
app's `look`; a record can add places after Notes, Capture and Connect.
