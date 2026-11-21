# Parachute Simplified

For a person who keeps notes on Parachute (Parachute Cloud, most often) and wants them on their phone: their vaults
and notes, a journal, a quick way to get something in, and a way to connect their AI. No rooms, keys or approvals. It
is the same Parachute app with a smaller set of screens, and Settings switches between the two. Its id stays `simple`.

**Which applets, and why.** Parachute's own applets ([design/PARACHUTE-SOURCE.md](design/PARACHUTE-SOURCE.md)): they
come with the app, run with no card and write nothing into a vault to be added. It leaves out **Rooms** and approval
cards (they need a relay, a key and an agent), **Mail** (a mail gateway that checks a key's signature; a Cloud account
has neither), the agent's applets (accounts, areas), Matrix, and the key and pairing screens. An applet the person or
their AI writes into their home shows on Notes under **Your applets**, where its card asks.

## What a person sees

| | Where | What it does |
|---|---|---|
| **Notes** | the home (`/`) | Every vault's newest notes in one list, a search across all of them, the vaults as tabs, **New note** (its first line names it), and the applets in the home. A note opens where notes open: in Vault (Parachute's own applets claim no notes), or an applet of the person's that claims it. Each vault the sign-in didn't read is a line in Settings, not here. |
| **Journal** | the bar | The Uni app's Journal: a line a day or many, written or said, kept by day in the home vault's `Journal/`. |
| **Capture** | the bar | Write a line, or **Say it** (the app's own recorder): it lands in the home vault's `Inbox/` as a note of its own, and a voice note gets its words from the hub's transcription. |
| **Vault** | the bar | Parachute's own viewer ([VAULT.md](VAULT.md)): each vault's types and counts, a type's records as a table, a record's fields (changed where they stand), words (**Edit words**), links and history. |
| **Connect** | the bar | Each vault's connector address (`https://…/vault/<name>/mcp`) with **Copy**, and how to add it to Claude and ChatGPT. |

Each is one of Parachute's own applets (`applets/notes`, `journal`, `capture`, `vault`, `connect`), at
`/v/<home>/a/parachute:<name>`. Settings is ⋯ on each screen; it has **Your bundle: Parachute Simplified / Everything**,
and a line for each vault the sign-in didn't read (**Open letters**).

On a phone's first run the first choice is **Sign in with Parachute Cloud** (an email, no key); the key's ways come
after it.

## Who gets it

`parachute.bundle` in the settings note (`Parachute/Settings` in the home vault, [NAVIGATION.md](NAVIGATION.md)) says
which bundle the person's devices open: `"simple"` or `"everything"` (and `app`, its older name, until 2026-12-20).
Absent means everything, as before.

A person new to the app on Parachute Cloud gets `"simple"`: a first sign-in, on a device that had no home, to a hub whose
descriptor says `door: "cloud"`, whose home was read and holds no settings note. The sign-in holds the home at write
([design/SCOPES.md](design/SCOPES.md)), so the settings note with `bundle: "simple"` and their list of Parachutes is
written then. A settings note already there is never changed this way. Settings changes it, and so can their agent.

## What it is made of

- **The applets** load from the Parachute source (`src/applet/parachuteSource.ts`): the copy built into the app, or a
  newer one signed with Parachute's release key. Each runs sealed in its frame and is held to its manifest like any
  applet; only the card goes. Notes, Vault and Connect see every vault this device holds through the `vaults` word
  (`src/applet/modules/vaults.ts`); Connect copies on a tap with `copy`; Notes and Vault open a note with `open`.
- **The home** `/` goes to Notes when the open bundle's `look` is `"notes"` and it keeps Parachute's source
  (`src/shell/App.tsx`). `/?with=vault` is the frame's own Notes (`src/frame/views/NotesHome.tsx`), the way back if
  Parachute's Notes won't run.
- **Editing** is Vault's **Edit words**, saved with `if_updated_at`: if an AI changed the note meanwhile, it says so,
  reads it again and keeps the person's words; Save again keeps them. The shell's editor (`src/views/NoteEdit.tsx`,
  **Keep mine / Use theirs**) stays for the plain note view (`?with=vault`).

## As a bundle record

Parachute Simplified is a bundle record the app ships (`src/shell/default-bundles.json`, id `simple`), read like any
other ([NAVIGATION.md](NAVIGATION.md#bundles)): `"look": "notes"`, `"everywhere": true`, `"publishers"` naming
Parachute's source, and a `bar` of `{"screen": "home"}`, `{"shipped": "journal"}`, `{"shipped": "capture"}`,
`{"shipped": "vault"}`, `{"screen": "connect"}`. A record `Parachute/Bundles/simple` says only what it changes;
`"publishers": []` leaves Parachute's own applets out (the bar then keeps Notes, the frame's).

## What this replaces (subtract)

| Was | Now | Goes |
|---|---|---|
| Notes as the frame's screen (`NotesHome.tsx`) | Parachute's Notes applet | now; the frame's stays only at `/?with=vault` |
| Connect as a shell screen (`src/views/Connect.tsx`) | Parachute's Connect applet | now (deleted) |
| **Add Capture / Add Journal / Add Vault**: a write into the home, then a card (`shipped.ts`, `ShippedEntry`) | Parachute's own, no write, no card | now (deleted) |
| The first Save asking the hub for write, then "do it again" | the home held at write from the sign-in | now |
| A note opening plain, with **Edit** | Vault, with **Edit words** | now; plain at `?with=vault` |
