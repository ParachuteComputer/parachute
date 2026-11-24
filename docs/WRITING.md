# Writing applet

The Writing applet (`applets/writing.json`, `applets/writing.tsx`) is a quiet writing surface where pieces live beside the references, quotes, and research materials Uni prepares for each piece.

## What it does

- **Pieces by stage**: Lists pieces in `Writing/Pieces/` (the folder unforced.org reads) grouped by `stage` (`draft`, `seed`, `ready`, `published`), last touched first, with search and stage tabs. `Ready` shows only when a piece is in it.
- **Quiet editor**: Writes directly into the piece's body with debounced saves and local draft recovery (`saved`), keeping the editor memoized so typing never re-renders the page or the Beside-it panel.
- **Beside it**: On wide screens (`>= 900px`), a sticky column beside the editor; on phones, a kit `Drawer` opened from the page header. Lists `reference` records whose `piece` names the open piece, newest first. Each reference can be inserted as a Markdown blockquote with a link to its source, opened at its source, or opened on its own Reference page.
- **Reference page**: Shows the quote, where it came from, and Uni's line on why it fits, with **Keep** and **Let go** actions (and **Insert as quote** when opened from a piece).
- **Ask Uni**: A one-line field on the piece creates a new `reference` record, `References/Ask <date time> <first words>`, with `state: "asked"` and `piece` set to the piece's name (a second ask alike in the same minute is `… (2)`). It names no type: the app gives the new record the `reference` the applet opens there, as a type or a plain tag, whichever the vault has (a vault refuses a plain tag sent as a type, and a type sent as a tag). It never writes into the piece's body. An ask can be let go, not kept, so a question never goes into the piece as a quote.
- **Stage and published pieces**: The applet moves a piece between `seed` and `draft` only. `ready` and `published` are the site's: unforced.org publishes a `#piece` whose stage is one of them (with a slug and a date), so the applet never sets them. On a ready or published piece the stage, `slug`, `url` and `published_at` are read-only.
- **What goes into a piece**: a quote is cited with its source's web address when it has one (`source_url`, or a `source` that is one), else with the source in plain words. Never a `[[wikilink]]` (unforced.org won't publish a piece with one) and never a vault's address, the reference's or one given as its source (a published piece is public; the vault isn't). With the piece never touched, a quote goes in at its end.

## Folder scope and permissions

The manifest (`applets/writing.json`) is folder-scoped to `Writing/Pieces/` and `References/` (`read`, `create`, `update`), opens `piece` in `Writing/Pieces/` and `reference` in `References/`, and asks the app only for `open` and `links` (to follow note and source links through the kit).

## Types and additive fields

### `piece` (existing)

A vault that already defines `piece` (for example under parent `writing`, generating `unforced.org`) keeps its exact fields and meanings:

| Field | Kind | Meaning |
|---|---|---|
| `stage` | `string` (`seed \| draft \| ready \| published`) | Where the piece is. unforced.org publishes `ready` and `published` pieces; this applet sets only `seed` and `draft`. (The vault unforced.org is made from declares `seed \| draft \| published`; the applet shows `Ready` only when a piece has it.) |
| `slug` | `string` | Publication slug; shown read-only when published. |
| `url` | `string` | Published URL; shown read-only (as a link) when published. |
| `published_at` | `date` | Publication date; shown read-only when published. |

### `reference` (additive fields)

These fields are additive on an existing `reference` type. Applying them adds only the fields a vault lacks and never changes existing fields:

| Field | Kind | Meaning |
|---|---|---|
| `piece` | `string` | The piece this reference serves, by name: its path inside `Writing/Pieces/` (Ask Uni writes this). An id, a whole path or a `[[link]]` to it also match. Uni already writes `piece` this way on the research it prepares for a piece. Not `for`: in a vault, `for` names the person a thing is for (as on Uni's drafts and research). |
| `used_in` | `string` (`cardinality: "many"`) | Pieces, by name, where this reference was inserted as a quote. |
| `state` | `string` (`asked \| ready \| kept \| let go`) | Workflow state: `asked` (requested via Ask Uni), `ready` (prepared for review), `kept` (accepted for the piece), or `let go` (set aside). |
| `quote` | `string` | Optional explicit quote text (falls back to a blockquote or the record body). |
| `source` | `string` | Where the quote came from (title, book, or publication). |
| `author` | `string` | Author of the source. |
| `source_url` | `string` | Source web URL (`url` is also read). A vault's address here is never cited in a piece: the quote cites the source in words. |
| `why` | `string` | Uni's line on why this reference fits the piece. |

## Writing pack

Not shipped: Writing needs no pack, since `piece` and `reference` are already in the vault it serves, and an applet can't hand the app a pack to apply (PACKS.md). This is the pack Parachute would ship if one is wanted, defining `piece` and the additive fields on `reference` (with templates and a saved view). `src/applet/writingApplet.test.tsx` checks that it is valid and goes into a vault with Parachute's starter packs (`core-types`, `clients`, `reading`) in any order, with no field clashing:

```json
{
  "parachute_pack": 1,
  "id": "writing",
  "name": "Writing and references",
  "version": 1,
  "source": "https://parachute.computer/docs/build/packs/writing",
  "summary": "Pieces by stage (seed, draft, ready, published) alongside references and quotes prepared for each piece.",
  "types": {
    "piece": {
      "description": "A piece of writing tracked from seed to draft to ready to published.",
      "fields": {
        "stage": {
          "type": "string",
          "enum": ["seed", "draft", "ready", "published"],
          "default": "seed",
          "description": "Where the piece is in its lifecycle."
        },
        "slug": {
          "type": "string",
          "description": "Publication slug (read-only once published)."
        },
        "url": {
          "type": "string",
          "description": "Published web address (read-only once published)."
        },
        "published_at": {
          "type": "date",
          "description": "Date the piece was published (read-only once published)."
        }
      }
    },
    "reference": {
      "description": "A quote, source, or research request prepared alongside a piece of writing.",
      "fields": {
        "piece": {
          "type": "string",
          "description": "The piece this reference serves, by name (its path inside Writing/Pieces/), or its id, path or link."
        },
        "used_in": {
          "type": "string",
          "cardinality": "many",
          "description": "Pieces, by name, where this reference has been quoted."
        },
        "state": {
          "type": "string",
          "enum": ["asked", "ready", "kept", "let go"],
          "default": "ready",
          "description": "Review state: asked, ready, kept, or let go."
        },
        "quote": {
          "type": "string",
          "description": "The quoted passage."
        },
        "source": {
          "type": "string",
          "description": "Where the quote came from."
        },
        "author": {
          "type": "string",
          "description": "Author of the source."
        },
        "source_url": {
          "type": "string",
          "description": "Web address or vault link to the source."
        },
        "why": {
          "type": "string",
          "description": "Why this reference fits the piece."
        }
      }
    },
    "template": {
      "description": "A starting point for new records of one type. Its body is the new record's body.",
      "fields": {
        "for": { "type": "string" },
        "default": { "type": "boolean" },
        "guide": { "type": "string" }
      }
    }
  },
  "records": [
    {
      "path": "Templates/piece/Piece",
      "types": ["template"],
      "fields": {
        "for": "piece",
        "default": true,
        "guide": "Start with the core question or angle. Keep slug, url and published_at untouched once published."
      },
      "body": ""
    },
    {
      "path": "Templates/reference/Reference",
      "types": ["template"],
      "fields": {
        "for": "reference",
        "default": true,
        "guide": "Set `piece` to the piece's name, `quote` to the excerpt, `source` and `source_url` to where it came from, and `why` to one sentence on why it fits."
      },
      "body": ""
    },
    {
      "path": "Parachute/Views/piece/In progress",
      "tags": ["parachute-view"],
      "fields": {
        "view": {
          "contract": 1,
          "layout": "table",
          "sort": null,
          "where": [
            { "field": "stage", "op": "ne", "value": "published" }
          ],
          "group": "stage"
        }
      },
      "body": ""
    }
  ]
}
```
