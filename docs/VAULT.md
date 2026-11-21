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
| A vault | its types, each with how many records it has and its fields; its tags; the newest records; a search; **New type**; **Changes**; **Sharing** |
| A type | its records as a table: the type's fields are the columns, a header's tap sorts by it, the first column stays in view as the rest scroll across. **Filter** (a field's value), **Group** (by a field), **List** or **Table**, a search. Saved views as tabs. **New …** adds a record of the type. A record opens beside the table on a computer, in its place on a phone |
| A record | its fields, changed where they stand (a choice from the type's list, a box for yes or no, a number, a date), its types and tags, its words (rendered; **Edit words**), what it links to and what links to it, its history (each change, by whom: an AI by its key's name; tap one for its before and after, and **Put it back**), and **Publish** |
| Changes | what changed in the vault in the last 7 days (**Older changes** reaches back further), newest first, each writer's run of changes together under its name (`claude`, or "You, in Parachute here"). Each change says what it did ("serves 2 → 4, the words") and opens to its before and after: fields, the words line by line, a move, links added or gone. **Put it back** for one change, or **Put all 4 back** for a writer's run: each record goes back to how it was before the run's first change to it, a record the run made is taken away, and one it deleted comes back. When a record changed again after, it says so first. Home says it in a line: "claude changed 4 things today", with **See what changed** |
| Sharing | what reaches the vault: this app (reads, or reads and changes; **Read only**), the applets allowed there on this device (**Revoke**), what is published, and the address your AI connects at. **Publish**, **Revoke** and **Read only** each ask on the app's own sheet first, naming the record's path or the applet, and the vault's host |

What an AI writes shows as it lands: the type's table, an open record and Changes follow the vault's live changes (the
hub's subscription, not a timer).

## Changes

Notion names the gate to letting agents write: "no good way to preview or audit changes". Changes is one view over the
history the vault already keeps, not a second record of it (`src/applet/changes.ts`):

- **A change** is a kept version: version *k* holds the record as it was before write *k*, stamped with that write's key
  (`via`: `key:claude`) and person, so its after is version *k+1*, or the record as it is now. A burst of writes by one
  key within 15 minutes is one version (core's burst rule), so it shows as one change. A record made since is a change
  of its own (no version before it); a deleted one is its tombstone, found through `GET /history/deleted` (write
  access may list it since core T-476).
- **Putting back is a change too.** One change: `POST …/restore` to the version before it (`vaults.restore`), to the
  record as the hub has it now; a record the AI made is deleted (`vaults.remove`; its tombstone is kept). The vault
  records it as a restore by this app's key, so the record's history shows "Put back by You, in Parachute here" beside
  the AI's change. Nothing in history is rewritten.
- **Names.** A writer is shown by its key's name. `key:claude` is `claude`; this device's Parachute (its key is named
  for its client id) is "You, in Parachute here"; an app approved over OAuth is named by the hub for its client id, so
  it shows as "An app (0f8a6c2e)" until the hub can say its name (gap 8).
- **What it reads:** the 20 records changed most lately, each with its versions, and the 12 deleted most lately,
  six reads at a time; **Older changes** reads the next of each (one read costs at most 34 of a frame's 60 reads in ten
  seconds, charged before the first read). A change's two sides as it shows them (`vaults.compare`), the first ten behind
  the list, kept until the record changes. While an AI writes, the list is read again at most every eight seconds. Home's
  line is lighter: per vault, one read of what changed today, one of what was deleted, and six deletions' tombstones at
  most (six vaults fit a frame's reads); it waits four seconds at most, then shows no line rather than hold the notes
  back, and a vault it couldn't read makes its count "4+".
- **What it shows of the app's own records.** An applet's code, settings, approvals or saved views changed by another
  writer (an AI with a write key) show, marked the app's own, and aren't put back here. This device's Parachute keeping
  them isn't shown; another device's Parachute keeping them is (it signs in as another app: gap 8). Home's count leaves
  out the app's own keeping, on any device; an applet's code an AI changed counts.
- **What putting back can't do.** It never overwrites a write made after the list was read: the record's `updatedAt`
  must still be what the list saw, else it says "It changed again since you looked" and reads the list again. Putting a
  record back restores its words, fields and extension, not its place (core keeps a later move); it says so. A deleted
  record comes back at its tombstone's place, or not at all when another record is there now ("another record is at its
  place now"). Taking away a record is a plain delete, and `vaults.remove` does only that: a record another app or AI made
  (its `createdVia` is a writer other than this device's Parachute), or one a put back re-made from deletion, in a vault
  that keeps history; never the person's own records made here. Core's DELETE takes no `if_updated_at`, so a write in
  the moment between the check and the delete goes with it (its tombstone keeps it). Which change a later put back
  undid isn't kept by the vault, so a change shows "put back since" when the record's very next change undid it, or this
  device put it back.
- **Refused as in a change** (`vaults.update`): code, an applet's, a component's or the app's own records are never put
  back here; what comes back published, or a change to a published record, asks on the app's own sheet first.

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
| A record's history as a list of versions, each read as it was ("As it was before …") | the same versions as changes, each with its before and after and **Put it back** (one view: Changes and a record's History are the same rows) | now |

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
8. **An app's name beside its key.** A key minted with a name (`parachute keys new claude`) writes as `key:claude`, which
   is a name. An app approved over OAuth is a key the hub names for its client id (core `keys.ts` `baseName`), a random
   id, and the vault can't read the client's name (`client_name` is the hub's). Changes shows it as "An app (0f8a6c2e)".
   Proposal for core: gap 1's access list, giving each key its client's name and keeping it after a revoke, so old
   writes still read; the v1 attribution contract (`app:<client id>`) is the stamp, and the list is where its name is.
9. **Types and tags aren't in history.** A kept version holds the words, fields, path and extension, not the record's
   types or tags. So Changes can't say a type was added, and a deleted record comes back without its types and tags
   (core: "re-creates it … untagged"); Changes says so before it is put back. Core 0.9.4's revisions (core #114) keep
   types, tags and links on each version and its undo by write set (#115) puts them back; Changes reads them from a
   version when they are there.
10. **Cloud.** Parachute Cloud runs an older engine: it lists deleted records only once it pins core T-412, and to write
   access only once it pins T-476, so Changes on Cloud shows edits and new records, and says deleted records aren't
   listed. A record put back from deletion reads as changed then only from core T-476 (before, it kept its old
   `updatedAt`, and Changes would lose sight of it).
11. **Who made a deleted record** isn't kept (its row is gone; versions keep when, not who). So a record an AI made and
   then deleted comes back with "Put all back" of that run, with nothing said on the run; opened alone, the deletion says
   when the record was made, if that was the same day. Core 0.9.4's write sets
   (#114/#115) know what a set made, and undo leaves it deleted.
12. **A hub with history off** keeps no versions: Changes shows only records made since, and taking one away can't be
   undone. History is on by default.
