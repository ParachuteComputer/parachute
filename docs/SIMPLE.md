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

The bar says **Notes · Capture · Connect**. Settings (⋯, or the foot of Notes) has **Your app: Simple / Everything**.

On a phone's first run the first choice is **Sign in with Parachute Cloud** (an email, no key); the key's ways come
after it.

## Who gets it

`parachute.app` in the settings note (`Parachute/Settings` in the home vault, [NAVIGATION.md](NAVIGATION.md)) says
which app the person's devices open: `"simple"` or `"everything"`. Absent means everything, as before.

A person new to the app on Parachute Cloud gets `"simple"`: their first sign-in on a device that had no home, to a hub
whose descriptor says `door: "cloud"`, where none of their vaults holds a settings note yet, writes it along with
their list of Parachutes. Anyone else starts as before. Settings changes it, and so can their agent, by writing the
note.

## What it is made of (today's mechanisms)

- **Notes** is the built-in frame's home when `app` is `"simple"` (`src/frame/views/NotesHome.tsx`; the launcher
  otherwise). It reads every vault this device holds through the frame's reads, as the launcher does.
- **New note and Edit** are a shell screen (`src/views/NoteEdit.tsx`), not the frame: a frame can be the person's
  own code from their vault, and it still writes nothing. The frame only sends the person there
  (`/v/<vault>/new`, `/v/<vault>/n/<id>/edit`). Edit saves with `if_updated_at`. If the note changed meanwhile (an AI
  wrote to it), the person chooses between **Show their version** and **Keep mine**. There is no Edit on code or on the app's own notes.
- **Capture** is an ordinary applet: `applets/capture.json` and `.tsx`, shipped with the app. **Add Capture** (one
  tap, on the bar's Capture place) writes it into the home vault as `Applets/Capture`. Its card then asks, as any
  applet's does: read, add and change notes in `Inbox/`, and the microphone through the app. It uses the kit only
  (`vault`, `voice.record`, `vault.attach` with `transcribe`, `Link`).
- **Connect** is a shell screen (`src/views/Connect.tsx`): each vault's address is the vault's own (Parachute Cloud's
  Connect page gives the same one), and copying needs the app's own clipboard.

Why not three applets: an applet reaches only its own vault and only by folder (`fields.applet.access`), and the app
never tells it which vaults the person has. A Cloud person's notes sit at the root of several vaults, so a Notes
applet couldn't see them. Notes needs every vault, and Connect needs every vault's address, so both are the app's own
screens. Capture writes into one folder of one vault, so it can be an applet.

## When the app record lands (#50)

The app record design (PR #50, `docs/design/APP-RECORD.md`, a draft) makes "an app" a record, `Parachute/Apps/<id>`, and keeps
`app` in Settings as "the app a new device opens". The simple app moves over as one record. `Settings.app: "simple"`
then names it, the same field with the same value:

```json
{
  "path": "Parachute/Apps/simple",
  "tags": ["parachute-app"],
  "fields": {
    "app": {
      "contract": 1,
      "id": "simple",
      "name": "Simple",
      "glyph": "¶",
      "note": "your notes, Capture, and Connect an AI",
      "sources": [{ "vault": "home", "applet": "Applets/Capture" }],
      "bar": [{ "vault": "home", "applet": "Applets/Capture" }],
      "frame": "builtin:notes"
    }
  }
}
```

What #50 needs for that, beyond what it has:

1. **A built-in frame by name.** `frame` names a frame record in the home vault. The simple app's frame is the app's
   own (its Notes home), so `frame` should also take a built-in name such as `builtin:notes`, which needs no
   approval, because it is the app's code.
2. **The app's own screens on the bar.** A bar place is an applet. Notes and Connect are the app's own screens, so a
   place should also be able to name one (`{ "screen": "notes" }`, `{ "screen": "connect" }`). Until then, the
   simple app's bar is drawn by the shell from `app: "simple"` (`src/shell/BottomBar.tsx`).
3. **An applet the app ships.** Capture's code comes with the app and is written into the vault on a tap. The
   approval is then for the code that was written, as for any other applet. If a later app version ships newer
   Capture code, it should be offered as "Make this mine" offers a newer frame. Today the vault's copy stays as it
   was written.

## What this replaces (subtract)

Nothing old runs beside it. For a new Cloud person, the launcher's "No applets here yet." chapters and the key-first
first screen are replaced by Notes and **Sign in with Parachute Cloud**. Everyone else's app is unchanged, and **Your
app** switches between the two. When #50 is built, `app: "simple"` becomes the record above, and the shell's
special-cased bar (point 2) goes.
