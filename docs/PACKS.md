# Templates and packs

T-476. Two words: a **template** starts one record; a **pack** adds a set (types, their templates, saved views).
People see **Add a pack**, **Installed packs** and **Update**. The record that remembers what a pack made is plumbing.

## A template

A record of type `template` at `Templates/<type>/<name>`. Its body is a new record's starting body. Three plain fields:
`for` (the type it starts), `default` (the one **New** uses) and `guide` (a sentence for an AI on how to fill it in).

- **New <type>** in Vault starts from that type's default template (else its first), with the template's body as it is
  now. The new record keeps no link to the template: it is the person's.
- **Make this a template** on a record writes `Templates/<type>/<its name>` with the record's headings. It is the
  default when the type had none.

## A pack

One block of JSON, `"parachute_pack": 1`, on a page (parachute.computer/docs/build/packs/<id>) or shipped with the app
(`src/kit/packs/*.json`, the same block). Its shape and checks: `src/kit/packs.ts` (`checkPack`). Applying it, the same
rule for the app and for an AI (`applyPack`):

1. **Types.** A type nobody has defined yet is made with the pack's fields. A type the vault already has keeps every
   field it has; the pack adds only the fields it lacks, and where the server says that needs admin (a type made by
   someone else), nothing is added and the person is told. A plain tag of the same name stays a tag. A field another
   type already declares with another kind is left out, and said.
2. **Records**, each only at a free path (`if_exists: "ignore"`). A taken path is the person's, and is left as it is.
3. **The receipt, last**: `Parachute/Receipts/<id>`, tagged `parachute-receipt`, its one field `receipt`: the pack's
   id, name, version and source, what this pack made (`made.types`, `made.records`), and what it left (`skipped`).
   Written only when something was made, or the version is newer than the one recorded.

Applying twice changes nothing. Nothing is renamed, retyped, replaced or deleted. Applying a newer version is the same
call: it adds what is new and keeps the rest (the **Update** button). Comparing versions further (a template the pack
changed, which the person also changed) is not built.

## In the app

- `vaults.importNotion(vault)`, during a tap: the app's own picker for a Notion export, applied as a pack (From Notion,
  above): `{ picked: false }`, or `{ name, found: {pages, tables, rows, files}, under, made, attached, types, notes, left, changed }` (`under`: the folder it
  landed under).
- Parachute's starter packs (`src/kit/packs/*.json`, each the block of its page at parachute.computer/docs/build/packs/<id>):
  **Core types** (person, project, meeting, task), **Clients and sessions** (client, session, follow-up: a practice, a
  coach's or a tutor's) and **Reading list** (book). Each has a template per type and a saved view; all three go into one
  vault together, in any order, with every field (`src/kit/packs.test.ts`).
- `vaults.packs(vault)`: Parachute's starter packs and the vault's receipts (`installed`, with `newer` when the app
  ships a newer version). `vaults.addPack(vault, id)`: apply a starter pack; `{ added, kept, notes, changed }`.
  Shell side: `src/applet/modules/packs.ts`. An applet can't hand the app a pack of its own to apply: only the packs
  the app ships.
- The app makes types over REST (`PUT /api/types/:name`) with the write access it holds. That needs core with
  write-may-define-a-type on REST (parachute-core #139). On an older 0.9 server the first type is refused and nothing
  is written ("This vault's server doesn't let Parachute make types yet"); on 0.8 (no types) Add a pack says so.
- Vault: **Add a pack** (or **Packs**, once a vault has types) on a vault; **Installed packs**; **New <type>** from the
  default template; **Make this a template** on a record. Tested end to end: `e2e/packs.spec.ts`.

## From Notion

**Import from Notion** on a vault (Vault) opens the app's own picker for a Notion export (in Notion: Settings, Export,
**Markdown & CSV**; the .zip as Notion gives it, up to 200 MB). The app reads it (`src/kit/zip.ts`, `src/kit/notion.ts`)
and applies it as a pack, by the rule above, under one folder, `Notion/` (`Notion/<workspace>/` when the export names
its workspace, as Notion's `index.html` does, so two workspaces' pages never meet at one path):

- a **database** becomes a type named for it (Reading List → `reading-list`), one field per column, its kind found from
  the values (dates, numbers, yes/no, lists, links to other rows as references: written as the export's relative paths,
  or, as exports since about 2023 write them, notion.so links found by the page's id); its `_all.csv` is read, so rows a view
  filtered out come too. A record at the table's place says where its rows went.
- a **row** becomes a record of that type at `Notion/<workspace>/<its place>/<title>`: the columns are its fields, its page (less
  its title and property lines) its words. A page is matched to its row by title, else by its property lines (Notion
  heads a date's page "@Today" where the CSV says the date), so a row is never two records.
- a **page** becomes a record at its place in the tree; links between pages become wikilinks.
- **images and attachments** in the export become vault attachments on the record they belong to, with links in the
  record's body rewritten to `/api/storage/…`. 25 MB a file and 150 MB of files in all (the export may unpack to
  350 MB in all, where it was 200 MB before files came in): a file over either, an empty one, or one no page holds is
  skipped with a plain message in the summary and body; a link to a linked view (a .csv the export doesn't hold) is said to be missing. A file that
  couldn't be uploaded is said in the summary and on the record; importing the same export again doesn't retry it.
  Vault's view of a record shows where a picture is in its words ("Image: owl sketch") but doesn't draw it yet: the
  kit's `Note` has no reader for a vault's files.
- **names stay clear of the vault's own types and tags in use, and workspaces stay apart**: a Notion "Book" beside your
  own `book` type is `book-2`. A type an import made is described `From Notion (<workspace>): <title>.` (or
  `From Notion: <title>.` when no workspace name is in the export), so a newer export of the same workspace adds to it,
  while a same-titled table from another workspace gets its own type named by workspace (`personal-tasks` beside Work's
  `tasks`). Two tables of one title in one workspace each find theirs again in name order (`tasks`, `tasks-2`).
- **a column whose kind changed between exports** keeps its existing field type on the vault type for values that fit;
  any value that doesn't fit goes to a text field (`<field>_text`) with a note in the import summary, never silently
  dropped and never written with the wrong type. A column one of your other types declares as another kind (or indexed)
  gets a name of its own, `date_2`, and keeps it in a newer export.
- a comma column is a list when a choice repeats across rows, or when it is named like one (Tags, Labels, Categories,
  Topics); "Le Guin, Ursula" alone stays one name. A value with a leading zero ("02134") keeps a column text.
- a column named alike in two tables but of two kinds is text in both (a vault takes one meaning per field); a title a
  vault path won't take ("notes.js", a path over 200 characters) is changed just enough to land.

The receipt is `Parachute/Receipts/notion-<id>`, the id from the export's file list: choosing the same export again
changes nothing, and **Installed packs** lists it. Checked against a made-up workspace shaped like a real export
(`e2e/fixtures/notion-export.zip`, from `scripts/make-notion-export.py`; `src/kit/notion.test.ts`, `e2e/notion.spec.ts`)
and a real export of a test workspace (Obsidian Importer's `tests/notion/Notion.Test.Export.zip`).

## For an AI

parachute.computer/docs/build/templates says the same rule in tool calls (`list-types {include_schema: true}`,
`manage-types` per type, `create-record` with `if_exists: "ignore"`, the receipt last). An AI needs the vault's own
address with write: the account door (`<hub>/mcp`) lists `manage-types` only to admin.
