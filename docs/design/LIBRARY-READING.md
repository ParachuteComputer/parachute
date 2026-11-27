# Reading a book at several depths (Library, T-531)

**In one line:** read any book from one paragraph down to its full text, on the book's own shape, and never lose your
place moving between the levels.

**For you:** is one verse (a sūtra with its commentary) its own record, or a marked place inside a reading piece?
**Default: a place inside the piece** (`Verses 1–5` holds five verses, each findable as `#v3`). Records stay few,
reading flows, and a quote or a Languages word can still point at one verse. Say "own record" if you want to link,
summarise or schedule single verses on their own.

| Level | What you see | Made by | Where it lives |
|---|---|---|---|
| Book | one paragraph | AI, after import | `summary` of the book |
| Part / chapter | three or four lines | AI, after import | `summary` of each part and chapter |
| Unit (one verse and its commentary) | the verse, its gloss, one line of what the commentary says | AI, after import | a line in the piece's summary, by verse number |
| Full text | the book's own words | the import | the `chapter` record (a piece of a few thousand words) |

## What changed

Imported books now read cleanly: Contents entries are single clean links, headings carry no stray asterisks, ornaments
before every verse are gone, short front matter is one record, and a very long part is cut at its verses into pieces
of about 2,500 words. Before and after screenshots are in [library-reading/](library-reading/). A book imported
before this keeps its old records until the importer runs again with `--prune`, which removes the old ones it still owns.

## More

### Moving between levels without losing your place

- Zoom is one control above the text: **Book · Part · Verses · Text**. Zooming out keeps the current verse
  highlighted in the summary list; tapping any line zooms back in to that spot.
- The place is the existing `at` field (`chapter#p12`), plus an optional verse (`chapter#v7`). When the import
  renumbers, Library already finds a chapter again by its title.
- The book page lists parts with their summary line under each title, so the Contents is itself level two.

### Following the book's real shape

The importer finds the natural unit from the text, not from the EPUB files: numbered verses (`**12. …**`) here; for
other books, numbered sections, dated entries (a journal), recipes (a cookbook's second contents level), or plain
chapters. Each unit should get an anchor at import (not built yet), so summaries, quotes and words can all point at it.

### How summaries get made

After an import finishes, Library leaves a `job` (`kind: summarise-book`, the book's path) the same way Add a book does.
The AI door (#parachute's job) takes it and writes `summary` records with `of`, `by` and `made`, bottom up: units, then
chapters, then parts, then the book. Library needs from the door: (1) take jobs by kind, (2) read a chapter's body, (3)
write `summary` records, (4) say on the job how it went. Library shows a summary with who made it, and never puts it
inside the book's text.

### Highlights, quotes and words to learn

- A quote already records chapter, paragraph, and the words before and after; it gains `verse` when there is one.
- **Words to learn:** in a verse's gloss line (`**yoga** = union;`), tapping a word offers **Learn this word**. That
  writes a Languages `word` record (`gloss` from the line, `from` pointing at the verse, `language` from the book),
  and the Languages applet makes its cards. The book's glossary (`***term*** — meaning`) is a ready list to offer the
  same way, in bulk.
- This follows the 11-23 "One web of records" proposal: Writing, reading, study, languages and kitchen work on shared
  records rather than copies, so a word, a quote and a verse are one record linked to the others, not three exports.

### Visual pass

The verse view should be bold, not bland, with the bar set by real reading apps: the verse line set larger, the gloss
smaller beneath it, the commentary at reading size. Use `ui-taste` and the Emil Kowalski skills; `remove-animations`
by default, with motion only on zoom.

### Not decided here

Per-verse records (see **For you**), summaries for books in other languages, and how long a piece should be for a
chapter with no numbered units (today it stays whole up to 400 KB).
