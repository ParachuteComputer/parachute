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
| A vault | its types, each with how many records it has and its fields; its tags; the newest records; a search; **New type**; **Add a pack** (**Packs** once it has types); **Import from Notion**; **Changes**; **Sharing** |
| Packs | **Installed packs** (version, when, **Update** when the app ships a newer one), and Parachute's own to add with one tap (Core types; Clients and sessions; Reading list): what each adds, then **Add**. What it added, and what it left as the person had it, said in plain words ([PACKS.md](PACKS.md)) |
| A type | its records as a table: the type's fields are the columns, a header's tap sorts by it, the first column stays in view as the rest scroll across. **Filter** (a field's value), **Group** (by a field), **List** or **Table**, a search. Saved views as tabs. **New …** adds a record of the type, starting from its default template when it has one ([PACKS.md](PACKS.md)). A record opens beside the table on a computer, in its place on a phone |
| A record | its fields, changed where they stand (a choice from the type's list, a box for yes or no, a number, a date; a reference, to another record, shown by that record's name and not changed here), its types and tags, its words (rendered; **Edit words**), what it links to and what links to it, its history (each change, by whom: an AI by its key's name; tap one for its before and after, and **Put it back**), **Make this a template**, and **Publish** |
| Changes | what changed in the vault in the last 7 days (**Older changes** reaches back further), newest first, each writer's run of changes together under its name (`claude`; "You, in Parachute here"; "You, in another app" for a write for your own account by a key with no name; "Someone else on your hub"; or "An app without a name", with a line saying the hub doesn't tell which). Each change says what it did ("serves 2 → 4, the words") and opens to its before and after: fields, the words line by line, a move, links added or gone. **Put it back** for one change, or **Put all 4 back** for a writer's run: each record goes back to how it was before the run's first change to it, a record the run made is taken away, and one it deleted comes back. The number counts records, so when a run has more changes than that, a line says why ("Put all 6 back covers 6 of these 9 changes. Not counted: 2 already put back, 1 more change to a record already counted"). When a record changed again after, it says so first. Home says it in a line: "claude changed 4 things today", with **See what changed** |
| Sharing | **Who reaches** the vault, in one list: **Connect an AI** (its address, or **Give an AI a key**: its name; read, or read and change; every type or some; the secret shown once with its address on the app's own sheet) and **Invite someone** (a link to send) at the top; then **AIs and agents**, **People** (you, each person by the name you gave them, invites nobody took yet with **Take back**), **Apps and devices** (this app, **Read only**; the applets allowed here on this device, **Revoke**; Parachute on your other devices; app keys), and what anyone with a link can read. Each row says what it reaches (reads; reads and changes; to which types; until when; when last used) and has **End**; what was ended stays in the list, said so. AIs, other devices and app keys show after **Show them all**; people show at once to the vault's owner. **Invite someone**, **Show them all**, **Make the key**, **End**, **Publish**, **Revoke** and **Read only** each ask on the app's own sheet first, naming what they grant or take and the vault's host |

What an AI writes shows as it lands: the type's table, an open record and Changes follow the vault's live changes (the
hub's subscription, not a timer).

## Who reaches a vault

Sharing answers "who and what reaches this vault, and how do I stop it" in one list, and ends any of it with one tap
(T-476; core's 1.0 grants slice, `docs/SPEC-1.0-grants.md` §7.3 and S10 in parachute-core). Parachute's usual case is
you and your AIs and agents, each with its own key, so they come first; then people; then apps and devices.

- **Asking.** The app holds no admin anywhere ([design/SCOPES.md](design/SCOPES.md)). **Show them all** asks the hub,
  once (the app's own sheet, then the hub's page or its key door), for the vault's admin, and holds it in this tab's
  session only, for Vault alone: never as the vault's token, never refreshed, and ended at the hub (its access and
  refresh tokens) when the person leaves Sharing, when the shell leaves or hides Vault, when the page goes, or after the
  hub's 15 minutes (`src/vault/manage.ts`).
- **The list** is the hub's (`GET <hub>/account/vaults/<v>/statements`): every credential that reaches the vault is a
  row, by name: a key made here, an AI or app connected by OAuth (with the name it registered), this app on another
  device, a key that reaches several vaults. Each says what it may do (reads; reads and changes; manages; downloads a
  backup), to which types (every type, or the ones named) and until when, and when it was last used. The hub says who
  each is for (`kind`): a key made with **Give an AI a key** is an agent's, so it is listed under AIs and agents, as
  is anything that connected at the AI address by OAuth (Claude, ChatGPT: any app but Parachute itself). A key or
  token someone you share with made says whose it is ("Wes's · …").
- **A person is one row.** Someone you shared the vault with is one row (`by: "self"`, their key), by the name you
  invited them by, with every sign-in of theirs in it: their Parachute on each device is never a row of its own. The
  vault's owner sees people at once (read with their key, `vaults.people`); the hub's list adds when each last used it.
- **Nothing twice.** Each person, key and app is in one group, once.
- **A key for an AI.** Its name (its writes read `key:<name>` in Changes), read or read and change, every type or some.
  The vault keeps the grant and checks every request against it: a key for `recipe` reads and adds recipes and gets
  nothing of a `journal` record, by id, search, links, counts, files or history (`POST <hub>/account/keys` with
  `types`). The secret is shown once, with the vault's own MCP address, on the app's own sheet: the applet that asked
  (Vault, or any applet with `sharing`) never sees it.
- **End** revokes it at the hub and ends the vault's grant: its next request is refused, its live socket closes, a file
  ticket it was given is spent no more (`DELETE <hub>/account/vaults/<v>/statements/<id>`). On a person it ends their
  membership, not one sign-in: every credential of theirs for the vault, and they can't sign in to it again (as
  `revoke-access`). The row stays in the list, said ended, until you leave Sharing.
- **A hub without the list** (an older core, Parachute Cloud for now): Sharing asks the hub, with no credential, whether it
  has the list, and where it doesn't keeps the line that the hub lists them, offering nothing it can't do.
- **Not yet:** a key can't be narrowed after it is made (end it and make another); one key reads and writes the same
  types (no read-one-write-another); a key that writes on behalf of others is the owner's to make, on the hub; a grant
  sees no history until versions record their types (core #114/#115); Parachute Cloud has no typed keys or list yet
  (core `deliberate.json` `typed-keys`); an app older than level 6 says to update before it opens Vault.

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
  it shows as "An app (0f8a6c2e)" until the hub can say its name (gap 8). In a vault shared with someone, their writes
  read as their name ("Bo"), and an AI key's writes for them as "Bo's claude": the hub names a vault's people by the
  stamp their writes carry (`/account/vaults/<v>/names`; changes.ts `writer`, [design/SHARING.md](design/SHARING.md)).
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
- **A tap in an applet on such a record** (a row's `link.open`, a note link) goes straight to Vault's address: the shell
  decides it at the tap as the note's route would (`open/resolve.ts`), from what this device read before (the copies,
  `vault/readCache.ts`), so the record shows without the note's route starting first. Only for Parachute's own Vault
  (its code is the app's), and only when no applet claims the record as the copies have it: a stale copy can then only
  show the record in Vault, never run an applet. A record an applet claims, a choice to ask, or a line to show goes
  through the note's route, which reads the applets as the hub has them now (`e2e/openwith.spec.ts`, "a tap in an applet").
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

1. **Who can reach a vault.** Built (T-476): "Who reaches a vault" above. Left: Parachute Cloud's twin.
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
8. **An app's name beside its key.** A key minted with a name (`parachute keys new claude`) writes as `key:claude`, which
   is a name. An app approved over OAuth is a key the hub names for its client id (core `keys.ts` `baseName`), a random
   id, and the vault can't read the client's name (`client_name` is the hub's). Changes shows it as "An app (0f8a6c2e)". A write by a key with no name at all (`api` or `mcp`) is stamped with the channel and the person it was for, not which key: Changes says "You, in another app" for your own account, "Someone else on your hub" for another account's, else "An app without a name". It can't give that key's creation date or offer to name it, because the stamp doesn't say which key it was; the key's name is given where it is made (`parachute keys new <name>`).
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
