# Vault: Parachute's own viewer

Aaron (11-20): *"a really good default vault viewer applet that ships from parachute … Tana/Notion/Airtable vibes. You can
see the records, their fields, their types, their content … This is where things open by default as well. And sharing
and such can be configured."*

Vault is one of Parachute's own applets (`applets/vault.json`, `applets/vault.tsx`; [design/PARACHUTE-SOURCE.md](design/PARACHUTE-SOURCE.md)):
it comes with the app, runs with no card at `/v/<home>/a/parachute:vault`, and writes nothing into a vault to be added.
A copy the person or their AI keeps in a vault is an ordinary applet, with its card. The study it grew from: `STUDY.md` beside this work (Tana, Notion, Airtable, Obsidian
Bases, Anytype, Capacities).

## What a person sees

| Screen | What is on it |
|---|---|
| Your vaults | every vault on this device (where it is, whether Parachute reads or also changes it), and a search across all of them |
| A vault | its types, each with how many records it has and its fields; its tags; the newest records; a search; **New type**; **Add a pack** (**Packs** once it has types); **Sharing** |
| Packs | **Installed packs** (version, when, **Update** when the app ships a newer one), and Parachute's own to add with one tap: what each adds, then **Add**. What it added, and what it left as the person had it, said in plain words ([PACKS.md](PACKS.md)) |
| A type | its records as a table: the type's fields are the columns, a header's tap sorts by it, the first column stays in view as the rest scroll across. **Filter** (a field's value), **Group** (by a field), **List** or **Table**, a search. Saved views as tabs. **New …** adds a record of the type, starting from its default template when it has one ([PACKS.md](PACKS.md)). A record opens beside the table on a computer, in its place on a phone |
| A record | its fields, changed where they stand (a choice from the type's list, a box for yes or no, a number, a date), its types and tags, its words (rendered; **Edit words**), what it links to and what links to it, its history (each kept version, by whom; tap one to read it), **Make this a template**, and **Publish** |
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
- **Core 0.8** has no types: Vault shows a tag with a schema as a type and a type's change as a tag's. That path is
  unit-tested against 0.8's words (`src/applet/vaults.test.ts`); Vault's e2e runs on 0.9 only (on 0.8 it skips), so it
  is not yet exercised on a 0.8 hub.

## Where things open

- **A record no applet opens** (no applet's `opens` claims its type, or the person's "Always" for its type is the
  vault view) opens in Vault, when Vault is in the home vault and allowed on this device:
  `/v/<vault>/n/<id>` carries on to `/v/<home>/a/<Vault>?vault=<vault>&record=<id>`, which Vault hears as its launch.
  A record an applet opens still opens there; nothing about open-with changed.
- **A vault's address**, `/v/<vault>`, carries on the same way, to that vault in Vault (decided once per visit: a Vault
  the home's read finds late doesn't take over a plain view being read). `/v/<vault>?with=vault` (and a note's `?with=vault`) is
  the plain view, asked for: the way back when Vault itself won't do.
- **Where the open bundle leaves Parachute's own out** (`"publishers": []`, or a bundle of the person's own that doesn't
  name them), the plain views stay. That, and `?with=vault`, is the way back if Vault itself breaks (docs/NAVIGATION.md,
  "A way back").
- **Listed by default**: Simplified's bar has **Vault**, and Everything's list shows it first. Aaron's own bundle gets it
  only after his yes: a bundle with no default offers Parachute's own only once its record names them.

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
2. **Defining a type's fields.** With core #139, `PUT /api/types/<name>` takes the typed work's rule on REST too: write
   may define a new type, and add fields to a type it made. Add a pack uses it ([PACKS.md](PACKS.md)). **New type**
   still makes a type with its first record, and a field is added to a record; changing a field of a type someone else
   made stays admin's.
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
4. **Counts per group**: `aggregate` groups only by an indexed field, so a grouped table counts what it has read.
5. **Someone else's vault.** `vaults` changes records in any vault the app may change, a shared one of someone else's
   too (the card says every vault): what it reads in one vault can be written into another the person shares.
6. **Reads a browser may keep.** The hub answers a record's read with `ETag` and `Last-Modified` and no `Cache-Control`,
   so a browser may serve a read of a moment ago again (heuristic freshness): a record just changed then reads as it
   was, and the next change is refused as a conflict. Vault's reads of the hub ask `cache: "reload"` (never a
   copy, the browser's or the app's), and every check the app makes behind a copy it kept (src/vault/readCache.ts) asks
   `no-cache`; the app's other first reads (the note
   view, the editor) don't yet. Proposal for core: `Cache-Control: private, no-cache` on `/api/*` answers.
7. **What shows first.** Vault shows a record from what this device read before, at once, and asks the hub behind it
   (lists and the types are read from the hub); when the hub's answer differs, the record view reads again (never while you are writing in it).
   A change is judged on the record as the hub has it now, never on the copy.
