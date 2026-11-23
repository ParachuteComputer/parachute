# People: Contacts and relationships in your vault

`applets/people.json` and `applets/people.tsx` turn the `People/` folder into a phone-first Contacts app that grows into a full relationship memory — keeping every existing person field intact and adding contacts, tags, groups, photos, birthdays, vault backlinks, and vCard import/export.

## Record shape (`People/<Name>`)

Records live at `People/<Name>` with type `person` (parent `entity`). All new fields are strictly **additive** and use plain values or string lists so the vault, the applet, and any AI over MCP can read and write the exact same record.

### Existing fields (kept as-is)

| Field | Type | Notes |
|---|---|---|
| `relation` | `"friend" \| "family" \| "collaborator" \| "influence"` | Relationship kind |
| `summary` | `string` | One-line summary shown under the name |
| `email` | `string` | Primary email address (lower-case) |
| `status` | `"new" \| "active" \| "past"` | Current relationship state |
| `ways_of_working` | `string[]` | Collaboration notes / preferences |
| `source` | `string` | Where you met or where the record came from |

### New additive fields

| Field | Type | Notes |
|---|---|---|
| `phones` | `string[]` | Phone numbers, optionally labeled with `label: number` (e.g. `["mobile: +1 555-0142", "work: +1 555-0199"]` or plain `["+1 555-0142"]`) |
| `emails` | `string[]` | Additional lower-case email addresses beyond primary `email` |
| `address` | `string` | Postal or street address (newlines allowed) |
| `birthday` | `string` | ISO date `"YYYY-MM-DD"`, or `"--MM-DD"` (RFC 6350) when the birth year is unknown |
| `links` | `string[]` | Web URLs (`https://…` — personal site, GitHub, etc.) |
| `tags` | `string[]` | Plain, simple words stored on `fields.tags` (e.g. `["boulder", "ceramicist"]`). **Not** vault `types` or record `tags` |
| `groups` | `string[]` | Group names stored on the person record (e.g. `["Close friends", "Techne"]`) |
| `photo` | `string` | Storage path of an image attached to the record via `vault.attach` (e.g. `"2026-11-23/1763...-photo.jpg"`) |
| `favorite` | `boolean` | `true` to pin the person to **Favorites** at the top of the list (omit or `null` when false) |

### Body

Standard markdown, starting with `## Memories and moments` when created in the applet. Links to other notes (`[[…]]` or hub note addresses) open directly inside Parachute.

### Example record (for MCP `create-record` / `update-record`)

```json
{
  "path": "People/Maya Lin",
  "types": ["person"],
  "fields": {
    "relation": "friend",
    "status": "active",
    "summary": "Ceramicist and trail runner in Boulder",
    "email": "maya@example.test",
    "emails": ["maya.studio@example.test"],
    "phones": ["mobile: +1 303-555-0142", "work: +1 303-555-0198"],
    "address": "412 Pine St\nBoulder, CO 80302",
    "birthday": "1991-12-02",
    "links": ["https://mayastudio.example"],
    "tags": ["boulder", "ceramics", "running"],
    "groups": ["Close friends", "Climbing"],
    "favorite": true,
    "ways_of_working": ["Prefers voice notes over long emails"],
    "source": "Met at pottery studio open house"
  },
  "body": "## Memories and moments\n\nHiked Green Mountain together in October.\n"
}
```

## Why `groups` is a person-field list

A group could be either a list field on each person (`fields.groups: string[]`) or a separate `Groups/<Name>` record. People uses a **person-field list** because:

1. **Additive schema fit:** `groups` lives right beside `tags` as a plain `string[]` on the `person` record.
2. **Least-privilege permissions:** No extra `Groups/` folder grant is needed on the applet's access card.
3. **No split-brain sync:** Renaming, adding, or removing a person's group updates one record atomically, with zero orphaned group links.
4. **Direct vCard & AI ergonomics:** Maps 1:1 to vCard `CATEGORIES` on import/export, and an AI updates a person's groups in a single `update-record` call.

## Access and level

- **`access`:** Read/create/update on `People/`, plus read-only on `Meetings/`, `Journal/`, `Notes/`, and `Organizations/` so `vault.getRecord(id, { includeLinks: true })` and `vault.queryRecords({ pathPrefix: "People/", includeLinks: true })` surface backlinks ("Everything that mentions them") and compute "Haven't talked in a while" without asking for whole-vault `vaults` access.
- **`opens`:** `{ "type": "person", "path": "People/" }` — tapping a `person` record in Parachute opens their contact card in People, and records created in People get the `person` type.
- **`app`:** `["open", "links", "save", "attach", "copy"]` — open linked notes, open `mailto:` / `https://` links, save exported `.vcf` files, pick `.vcf` files and contact photos, and copy phone/email/address.
- **`needs`:** `4` (uses kit `Fields` at level 3 and `Drawer` at level 4; degrades gracefully if `vault.file` or `onBack` is absent on older builds).
- **Photos (`vault.file`):** Uses the folder-scoped `vault.file(id, path)` read (checked against the applet's `vault.read` folders and the record's image attachments, per `docs/design/PICTURES.md`).
- **Install:** `node scripts/install-applets.ts … --applet people` puts it in a vault (`Applets/People`); it takes no `--set` values.

## Thousands of people

The list reads `People/` in pages of 50, oldest made first (`orderBy: "created_at"`), so a person changed while it
reads moves nowhere and a new one lands at the end. Each page asks for the offset the last one ended at, so the app goes
on reading from there (a few rows back, so a person deleted meanwhile pushes none past it) instead of reading everyone
before it again: one read a page. Then one page newest-changed first brings in anyone changed while it read. A 0.8 hub,
which can't order by when a record was made, is read newest-changed first (that last page catches one changed while
it read). The app pages to an offset of 5,000 at most: past that the list holds the first 5,050 or so and its
heading says "5050+ people". vCard in and out wait until everyone is listed (and are off past 5,050), so an
import never misses a match.

## vCard (`.vcf`) import and export

- **Import:** reads vCard 2.1, 3.0 and 4.0 exports: folded lines, quoted-printable (with 2.1's `=` soft line breaks),
  UTF-8, Apple `itemN.X-ABLabel` phone labels, several `TEL` / `EMAIL` / `URL`, `ADR`, `BDAY` (also yearless `--MM-DD`
  and Apple `X-APPLE-OMIT-YEAR`), `CATEGORIES` → `groups`, `X-PARACHUTE-TAGS` → `tags`, `TITLE`/`ORG` → `summary`,
  `NOTE`, and an inline base64 `PHOTO` (v3 `ENCODING=b` or a v4 `data:` URI), which is attached and set as `photo`.
- **`NOTE`:** on a new person, a one-line note with no title or company becomes the `summary`; a longer note goes into
  the body under `## Memories and moments`. On a matched person, a note is added to the body unless the body or the
  summary already has it.
- **Matching:** email (primary or `emails`, any case) → phone (digits only; a leading US `1` is ignored) → name (any
  case). Cards within one file match each other too, so a file never makes the same person twice. A match is merged
  additively: an empty field is filled, lists gain what's new, nothing is overwritten or dropped.
- **Preview:** before writing, the import lists each card as New, Merge or Same. It reads the bodies of the people a
  card's note would merge into, so Same means nothing will change: each alone, or the folder in pages when that is
  fewer reads. Cards are matched through one index of emails, phones and names, so a phone's whole address book
  against thousands of people takes no longer than reading it.
- **Export:** vCard 4.0 (CRLF, 75-octet folding, escaped values) for everyone, the filtered list, or one person: phones,
  emails, address, birthday, links, `groups` as `CATEGORIES`, `tags` as `X-PARACHUTE-TAGS`, `summary` as `NOTE`, and
  the photo embedded. Importing an export back changes nothing.
