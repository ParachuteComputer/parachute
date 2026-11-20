# Vault: Parachute's own viewer

Aaron (11-20): *"a really good default vault viewer applet that ships from parachute … Tana/Notion/Airtable vibes. You can
see the records, their fields, their types, their content … This is where things open by default as well. And sharing
and such can be configured."*

Vault is an applet like any other (`applets/vault.json`, `applets/vault.tsx`), shipped with the app the way Capture and Journal are (`src/applet/shipped.ts`):
one tap puts it in the home vault as `Applets/Vault`, its card asks once, and from then on it is a record the person or
their AI can read and change. The study it grew from: `STUDY.md` beside this work (Tana, Notion, Airtable, Obsidian
Bases, Anytype, Capacities).

## What a person sees

| Screen | What is on it |
|---|---|
| Your vaults | every vault on this device (where it is, whether Parachute reads or also changes it), and a search across all of them |
| A vault | its types, each with how many records it has and its fields; its tags; the newest records; a search; **New type**; **Sharing** |
| A type | its records as a table: the type's fields are the columns, a header's tap sorts by it, the first column stays in view as the rest scroll across. **Filter** (a field's value), **Group** (by a field), **List** or **Table**, a search. Saved views as tabs. **New …** adds a record of the type. A record opens beside the table on a computer, in its place on a phone |
| A record | its fields, changed where they stand (a choice from the type's list, a box for yes or no, a number, a date), its types and tags, its words (rendered; **Edit words**), what it links to and what links to it, its history (each kept version, by whom; tap one to read it), and **Publish** |
| Sharing | what reaches the vault: this app (reads, or reads and changes; **Read only**), the applets allowed there on this device (**Revoke**), what is published, and the address your AI connects at. **Publish**, **Revoke** and **Read only** each ask on the app's own sheet first, naming the record's path or the applet, and the vault's host |

What an AI writes shows as it lands: the type's table and an open record follow the vault's live changes (the hub's
subscription, not a timer).

## How it is built

- **Two words in `fields.app`** ([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)): `vaults` (see every record in every vault on
  this device, and change records where the person lets Parachute change them) and `sharing` (what reaches each vault;
  and, each after the person's yes on the app's own sheet, which the applet can't draw or answer: publishing a record,
  taking an applet's access back, making a vault read only). Each is a stressed line on the card and part
  of the asks' hash, so adding one asks again. An applet in someone else's vault asks the app for nothing, as before.
  Code: `src/applet/modules/vaults.ts` (what is allowed, checked on every call), `src/shell/vaultsDeps.ts` (the shell's
  answers), the kit's `vaults.*` calls.
- **What it never changes**, whatever its card says: code (HTML, TSX, JSX), a record carrying an applet's, a
  component's or the app's own name (`applet`, `component`, `parachute-*`), or anything in `Applets/`, `Parachute/` or
  `.parachute/`; it never gives or takes away such a name, nor publishes (the `publish`/`published` tag or field: only `sharing`'s
  publish, after the sheet), and a change to a record that is already public asks on the sheet first.
  A change is to the version it was judged on (`if_updated_at` must be the record's as read). Saved views are the one exception it keeps for itself:
  records in `Parachute/Views/<type>/`, tagged `parachute-view`, their settings in one field, `view`.
- **Changing a vault Parachute only reads** is refused before it is sent, and the person is asked (the hub's page), as a
  note's Edit is ([design/SCOPES.md](design/SCOPES.md)).
- **5,000 records**: a type's records are read 100 at a time, sorted and filtered by the hub (a field's sort and an
  `eq` filter work on any field); the table draws only the rows near the screen and reads the next page as its foot
  comes near. Measured: `e2e/viewer5000.spec.ts` (opt-in, `VIEWER_5000=1`).
- **Kit parts** added for it, for every applet: `Table` and `Fields` (`src/kit/parts-data.tsx`).
- **Core 0.8** has no types: Vault shows a tag with a schema as a type and a type's change as a tag's.

## Where things open

- **A record no applet opens** (no applet's `opens` claims its type, or the person's "Always" for its type is the
  vault view) opens in Vault, when Vault is in the home vault and allowed on this device:
  `/v/<vault>/n/<id>` carries on to `/v/<home>/a/<Vault>?vault=<vault>&record=<id>`, which Vault hears as its launch.
  A record an applet opens still opens there; nothing about open-with changed.
- **A vault's address**, `/v/<vault>`, carries on the same way, to that vault in Vault.
- **Before Vault is added, or while it waits for its card** (new, or changed since it was allowed), or where applets
  don't run on this device, the plain views stay, with one line at the top that leads to Vault. That is the way back if
  Vault itself breaks (docs/NAVIGATION.md, "A way back").
- **Listed by default**: Simple's bar has **Vault** (the applet, or the screen that adds it), and Everything's list says
  **Add Vault** until it is there. Aaron's own app record gets it only after his yes (a record of his, not applied here).

## What the shell gave up (subtract)

| Was | Now | Goes |
|---|---|---|
| The plain vault view (`src/frame/views/VaultView.tsx`) as where `/v/<vault>` lands | Vault; the plain view stays only as the fallback above | now |
| The plain note view (`src/frame/views/NoteView.tsx`) as where a record no applet opens lands | Vault, which shows its fields, types, links and history; the plain view stays only as the fallback | now |
| A typed record's fields in the note view (the typed worker's, T-476) | Vault's record view | once Vault is the default everywhere; the note view keeps them as the fallback |

The two plain views are not deleted: a person whose devices haven't allowed Vault yet, or whose Vault won't start, still
reads their notes. They go when Parachute's own applets load from a trusted source and need no card (a later step).

## Gaps, said plainly (proposals for core, not built)

1. **Who can reach a vault.** Core lists tokens and OAuth grants only on the hub, for its operator
   (`/api/auth/tokens`, `/api/grants`: host admin) or for the signed-in person's own tokens (`/api/account/tokens`: the
   hub's session cookie). A vault token, even admin, is refused (checked on a throwaway hub: 403, 401). So Sharing can't
   list the AIs and keys that reach a vault. Proposal: `GET /vault/<name>/api/access` with the vault's admin scope,
   listing each live token and grant that covers the vault (client name, scope, created, last used), and
   `POST …/access/<jti>/revoke`.
2. **Defining a type's fields.** `PUT /api/types/<name>` needs the vault's admin scope; the app holds read or write.
   Vault makes a type with its first record (write may: the hub makes the type as a record names it) and adds a field
   to a record; declaring a field on the type (its kind, its choices) is left to an AI with `manage-types`, or the
   person with an admin key. Proposal: the typed work's rule (write may add a new type and fields to a type it made)
   on REST too.
3. **Per-record sharing** beyond publishing: none in core (`docs/SPEC-1.0-grants.md`: not built). The hub serves a
   record to anyone at `/vault/<name>/view/<id or path>` when it carries the vault's `published_tag` (`publish` unless
   the vault's config names another) or the field `published: true`. Vault publishes with the field (which every vault
   honours), after the app's own sheet; `vaults` refuses to give or take `publish`/`published` or that field, and asks
   on the sheet before changing a record that is already public. **Gap:** a vault whose config names another tag
   (only admin reads the config) isn't known to the app, so that tag could be given by a change without the sheet;
   and tags a tag-scoped key (or `private_tags`) is narrowed by are ordinary tags to `vaults`, so a change can widen or
   narrow what such a key sees. Proposal: the vault's read scope may read its `published_tag` and `private_tags`. A type
   whose schema gives `published` a default would publish what it is given (the hub fills defaults in), so `vaults`
   refuses to give such a type; a field named `__proto__`, `constructor` or `prototype` is refused anywhere.
5. **Someone else's vault.** `vaults` changes records in any vault the app may change, a shared one of someone else's
   too (the card says every vault): what it reads in one vault can be written into another the person shares.
4. **Counts per group**: `aggregate` groups only by an indexed field, so a grouped table counts what it has read.
