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
| `source` | `string` | Where the record came from (an import, a list); the story of meeting is `how_we_met` |

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
| `keep_in_touch` | `string` | How often to be in touch: `"every week"`, `"every 2 weeks"`, `"every month"`, `"every 3 months"`, `"every 6 months"`, `"every year"`. People also reads `"monthly"`, `"quarterly"`, `"yearly"` and a number of days (`45`, `"45 days"`) |
| `talked` | `string[]` | Times you were in touch that left no note of their own, newest first: `"YYYY-MM-DD"` or `"YYYY-MM-DD: what about"` |
| `how_we_met` | `string` | How you met, in your words |
| `met` | `string` | When you met: `"YYYY-MM-DD"`, `"YYYY-MM"`, or `"YYYY"` when that's all you know |

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
    "keep_in_touch": "every month",
    "talked": ["2026-11-20: tea at the studio; she'll send the glaze notes"],
    "how_we_met": "At the pottery studio open house",
    "met": "2023-06-10",
    "ways_of_working": ["Prefers voice notes over long emails"],
    "source": "Met at pottery studio open house"
  },
  "body": "## Memories and moments\n\nHiked Green Mountain together in October.\n"
}
```

## In touch: last connection, keep in touch, timeline

People keeps no counter of its own. **The last time you were in touch** is worked out when the list loads, from what the
vault already holds: the newest of a `talked` entry and a note in `Meetings/`, `Journal/` or `Notes/` that links the
person. A linked note counts on **its own day** (a `date`, `start`, `when` or `day` field, a time read as the day it was
here; else a date in its path such as `Journal/2026-11-10` or `Meetings/2026/10-02 Kiln`; else the day it was made), never
the day it was last edited: tidying an old meeting note isn't being in touch. A day after today (next week's meeting)
isn't contact yet. An organization's card that lists them isn't contact (it shows on the timeline); another person's card
that links them shows as "People linked".

- **Contacts** sorts A–Z or **Recent** (most recently in touch first, no connection yet at the end), and the filters
  narrow by **Last in touch**: this week, this month, 3 months, longer ago, never.
- **We talked** on a person's card adds today (or an earlier day) and an optional line to `talked`. A call, a walk, a
  message: anything that left no note. Tap a talk on the timeline to put it right or remove it.
- **Keep in touch** (`keep_in_touch`, set in Edit details) is how often you want to be in touch with someone. The **In
  touch** tab lists who it's time to reach out to (never in touch counts), then who comes up this week, earliest first.
  Below, everyone else you haven't been in touch with for 30 days, 90 days or a year, and those with no connection yet.
  The tab shows no count and nothing turns red: it's a short list to look at, not a backlog
  ([design/PEOPLE-CRM.md](design/PEOPLE-CRM.md) says why).
- **Timeline**, on each card, newest first: talks, the meetings, journal entries and notes that link them, how you met
  (`how_we_met`, `met`). It replaces the old "Everything that mentions them" list.

Room messages on a relay don't count yet: People reads the vault only. A room's talk counts once it is kept as a note in
`Meetings/`, `Journal/` or `Notes/` that links the person.

## Why `groups` is a person-field list

A group could be either a list field on each person (`fields.groups: string[]`) or a separate `Groups/<Name>` record. People uses a **person-field list** because:

1. **Additive schema fit:** `groups` lives right beside `tags` as a plain `string[]` on the `person` record.
2. **Least-privilege permissions:** No extra `Groups/` folder grant is needed on the applet's access card.
3. **No split-brain sync:** Renaming, adding, or removing a person's group updates one record atomically, with zero orphaned group links.
4. **Direct vCard & AI ergonomics:** Maps 1:1 to vCard `CATEGORIES` on import/export, and an AI updates a person's groups in a single `update-record` call.

## Access and level

- **`access`:** Read/create/update on `People/`, plus read-only on `Meetings/`, `Journal/`, `Notes/`, and `Organizations/` so `vault.getRecord(id, { includeLinks: true })` and `vault.queryRecords({ pathPrefix: "People/", includeLinks: true })` surface backlinks (the timeline) and the last time you were in touch, without asking for whole-vault `vaults` access.
- **`opens`:** `{ "type": "person", "path": "People/" }` — tapping a `person` record in Parachute opens their contact card in People, and records created in People get the `person` type.
- **`app`:** `["open", "links", "save", "attach", "copy"]` — open linked notes, open `mailto:` / `https://` links, save exported `.vcf` files, pick `.vcf` files and contact photos, and copy phone/email/address.
- **`needs`:** `4` (uses kit `Fields` at level 3 and `Drawer` at level 4; degrades gracefully if `vault.file` or `onBack` is absent on older builds).
- **Photos (`vault.file`):** Uses the folder-scoped `vault.file(id, path)` read (checked against the applet's `vault.read` folders and the record's image attachments, per `docs/design/PICTURES.md`).
- **Install:** `node scripts/install-applets.ts … --applet people` puts it in a vault (`Applets/People`); it takes no `--set` values.

## Thousands of people

The list reads `People/` in pages of 50, oldest made first (`orderBy: "created_at"`), so a person changed while it
reads moves nowhere and a new one lands at the end. Each page asks for the offset the last one ended at, so the app goes
on reading from there (a few rows back: up to five records deleted or moved out of `People/` meanwhile push no one past it; past five, one person is missed for
each until the list is read again, and records People can't see count here too) instead of reading everyone before it again: one read a page. Then one page newest-changed first brings in anyone changed while it read. A 0.8 hub,
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

## On the phone (CardDAV)

`services/carddav` serves `People/` to a phone as one CardDAV address book (DAVx5 on Android syncs it into Contacts),
read-write, straight from the vault: the vault stays the only copy. Only card facts cross (phones, emails, address,
birthday, links, groups, summary, photo); the body and every other field never leave. A phone edit replaces the card
facts and keeps the rest; a name changed on the phone doesn't rename the note. It adds four fields to a record:

| Field | Type | Notes |
|---|---|---|
| `uid` | `string` | The card's UID, for a person made on the phone (one made in the vault uses its record id) |
| `href` | `string` | The card's file name on the phone, kept only when it isn't the UID |
| `vcard_extra` | `string[]` | Raw vCard lines the phone sent that People has no field for (`ORG`, `TITLE`, `NICKNAME`, `X-…`), sent back as they came |
| `on_phone` | `boolean` | `false` keeps the person off the phone (deleting a contact on the phone sets it); remove it or set `true` to bring them back |

How to run it, what maps to what and why: [services/carddav/README.md](../services/carddav/README.md).
