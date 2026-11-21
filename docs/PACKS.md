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

- `vaults.packs(vault)`: Parachute's starter packs and the vault's receipts (`installed`, with `newer` when the app
  ships a newer version). `vaults.addPack(vault, id)`: apply a starter pack; `{ added, kept, notes, changed }`.
  Shell side: `src/applet/modules/packs.ts`. An applet can't hand the app a pack of its own to apply: only the packs
  the app ships.
- The app makes types over REST (`PUT /api/types/:name`) with the write access it holds. That needs core with
  write-may-define-a-type on REST (parachute-core #139). On an older 0.9 server the first type is refused and nothing
  is written ("This vault's server doesn't let Parachute make types yet"); on 0.8 (no types) Add a pack says so.
- Vault: **Add a pack** (or **Packs**, once a vault has types) on a vault; **Installed packs**; **New <type>** from the
  default template; **Make this a template** on a record. Tested end to end: `e2e/packs.spec.ts`.

## For an AI

parachute.computer/docs/build/templates says the same rule in tool calls (`list-types {include_schema: true}`,
`manage-types` per type, `create-record` with `if_exists: "ignore"`, the receipt last). An AI needs the vault's own
address with write: the account door (`<hub>/mcp`) lists `manage-types` only to admin.
