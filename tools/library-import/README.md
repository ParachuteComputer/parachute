# library-import: a book into a Parachute vault

T-476. One book, as records, into a vault, for the Library applet (`applets/library.*`) and its pack
(`src/kit/packs/library.json`). It runs by hand on a file, or from a **job** someone left with Library's **Add a book**
([UPLOADS.md](../../docs/design/UPLOADS.md)).

```sh
python3 -I import_book.py SOURCE --vault library --token-file F [--types-token-file A] [--dry] [--report out.json]
python3 -I import_book.py --job RECORD --vault library --token-file F [--by NAME]
python3 -I import_book.py --jobs --vault library --token-file F [--by NAME]
```

- **SOURCE** is an `.epub` (DRM-free; a locked one is refused and nothing is written), or a folder already made from
  one: `metadata.json`, `structure.json`, `text/NN-*.md` with their block anchors, `assets/`, `summaries/`.
- **--token-file**: a file holding a key with write on the vault. Mint a short-lived one and revoke it after:
  `parachute-core keys new <name> --vault library --can write --ephemeral --json` (keep the token in a 0600 file, never
  print it), then `parachute-core keys revoke <name>`.
- **--types-token-file**: core 0.9.0-pre.1 lets only admin define a type over REST (#139 lifts that). On such a hub,
  pass a second short-lived key with `--can admin`; it is used for the types alone. Without it the import says so
  and writes nothing. Once the types exist, later runs don't need it.
- **--title** names the book's folder, `Books/<title>` (default: its title up to a colon). A second book with the
  same short title (another translation) is refused until it gets its own, e.g. `--title "Meditations (Hays)"`:
  the receipt says which book a folder holds.
- **--dry** reads and plans, and prints the paths it would write. **--report** saves the counts and paths, never the
  book's text.
- Default hub: `http://127.0.0.1:1939` (`LIBRARY_HUB` or `--hub` for another).

## From a job (`--job`)

Library's **Add a book** leaves a `job` record in `Jobs/Library/` with the file attached: `kind: import-book`,
`status: waiting`, and an `upload` field listing the file's pieces in order, each with its SHA-256 (one piece for a
file up to 8 MiB). `--job <id or path>`:

1. reads the job and takes it only if it is a waiting `import-book` job for an epub. A PDF, or anything else, is left
   `waiting` for an AI that reads it, and the run says so and exits 1.
2. takes it: `status: working`, `by: <--by>`, `taken: <time>`, on the version it read (another taker's change first: a
   409, and it leaves the job to them). A job still `working` six hours after it was taken has lost its taker (a
   reboot, a kill), and is taken again;
3. reads each piece (only files attached to the job), checks its size and SHA-256, and joins them into the epub, in a
   temporary folder;
4. imports it as below;
5. writes `status: done`, `result: Books/<title>`, and a `note` with the counts; or `status: failed` with why.

`--jobs` does this for every waiting `import-book` job in the vault, oldest first, and reports each: done, failed,
or left (a PDF). Run it when told a book was added; nothing here polls.

Any AI can do the same by hand: find jobs with `types: job, status: waiting`, take one on its version, and say how it
went in `status`, `result` and `note`.

## What it writes

Under `Books/<Title>/`, one folder per book:

| Record | Type | Fields | Body |
|---|---|---|---|
| `Books/<Title>` | `book` | author, translator, language, kind, source, rights | the cover, the byline, the contents as `[[links]]`, links to the whole-book summaries |
| `Books/<Title>/<NN> <Chapter>` | `chapter` | **book**, **part** (the part it sits in, itself a chapter record), order, words | the text, its pictures where the book had them, its notes as footnotes at the end |
| `Books/<Title>/Summaries/<NN> <Chapter>` | `summary` | **of**, by, made | a folder's chapter guides, part summaries, `book-summary.md` and `reading-paths.md`, their links turned into `[[links]]` |

It defines the Library pack's four types (`book`, `chapter`, `quote`, `summary`) when the vault lacks them, with the
fields of `src/kit/packs/library.json` in the app repo (keep `TYPES` here and that file the same). A type the vault
already has keeps every field; only missing fields are added. A name the vault keeps as a plain tag (an older vault, or
one Library wrote to before the pack) stays a tag, and the import writes it on its records as a tag.

- **Front matter** (title page, copyright, printed contents, dedication) is one record. A piece named like front matter
  (title page, copyright, dedication, epigraph, "Books by …", "Also by …") before the book's first part or numbered
  chapter joins it, even after a long foreword. The cover goes on the book.
- **Headings and links** are plain words: emphasis around a heading (`<h2><em>Contents</em></h2>`) goes, a heading at
  the top that only repeats the chapter's title goes, and a link's label is one line (a `<br/>` inside a title
  becomes " – "). On a book imported before this, the next import takes that heading out, so a reading place (`at`)
  in the chapter lands one paragraph later; quotes find their words again by the words around them.
- **Ornaments** are left out: a picture with no words of its own (an empty alt, "Image", its file name) that the book
  repeats three times or more (one before every verse), or that is no larger than 64 px. A picture with its own
  description stays, however often it comes (a map, a drop cap "T"). The report counts what went.
- **Verses:** a chapter over 6,000 words that runs on bold numbered verses (`**12. …**`: at least eight, never
  counting back, almost all one after the other; a cookbook's steps start again at 1 and don't count) is cut into
  pieces of about 2,500 words, each opening on a verse (with the heading just before it, if any). A top-level chapter
  becomes a part holding its opening, the pieces under it (`Verses 1–5`); a chapter already inside a part keeps its
  opening and the pieces go beside it in that part (`Five – Verses 1–3`).
  On a book imported before, the long chapter keeps its path but now holds only its opening: a reading place or a
  quote inside it opens the opening, and the reader goes on from there to the piece.
- **Notes**: an epub's footnotes and endnotes go to the end of the chapter that cites them. In a folder, the Notes
  file is split by its chapter headings and each note becomes a footnote of its chapter (`[7]` in the text becomes
  `[^7]`). A printed index is left out.
- **Pictures** are uploaded once and attached to each record that shows them; the body links them as
  `/api/storage/…`. PNG, JPEG, GIF and WebP only (the hub refuses SVG); 25 MB a file, 150 MB a book.
- **Never written:** `published` (the app's publish field), and his own fields on a book (`status`, `rating`,
  `finished`, `at`).
- A chapter over 400 KB is cut into parts (an applet's folder door writes 500 KB a body).

## Running it again

A receipt at `Parachute/Receipts/book-<title>` (tagged `parachute-receipt`, so the app's Installed packs lists it)
holds each record it made (path, id, a hash of what it planned, and a **print**: a hash of the body and the fields
it writes, as the hub returned them right after it wrote them) and each picture's storage path.

**Whose a record is:** the import's only while it holds exactly what the import last wrote there (its print), or
exactly what this run would write (a write that landed before its run stopped). Anything else is someone's edit.
Time stamps don't decide it, so attaching a picture never makes a record look edited.

- Nothing changed in the plan or the vault: no write at all, not even the receipt.
- The plan changed (a better parser) and the record is still the import's: updated, with `if_updated_at`.
- Someone changed it: left as it is, named in the report (`changed_since`), and never written again, pictures
  included. An edit landing during the run is caught too: after the pictures go up the record is read again, and
  a write refused with 409 leaves it theirs.
- Deleted since: stays deleted (`deleted_since`). A record at its path it didn't make: left (`theirs`).
- A run cut off before a new record's receipt entry was finished: the path was noted first, so the next run adopts
  the record if it holds exactly what the import writes, and finishes its pictures; otherwise it is theirs.
- The hub restarting mid-run: a read waits and tries again, for about four minutes; a write is retried only when
  the hub refused the connection (so it can't have happened). A write that timed out stops the run with a line
  saying so: run it again and the receipt picks up from there.
- **Stale and `--prune`:** a record an earlier import made at a path this plan no longer has (a better parse
  renumbered or renamed its chapters) is listed in the report as `stale`. With `--prune` it is deleted, but only while it
  holds exactly what the import wrote, no quote names it in `from` (a quote's type, tag, or place in `Quotes/`), and
  the book's `at` doesn't point at it; links from other notes or a Languages word's `from` are not checked; anything else stays and stays listed. Pictures
  stay in storage.
- **Limit:** a record is found by its path, and the path holds the chapter's number and title. A parser change that
  renumbers or renames chapters makes new records beside the old ones, which stay (and stay in the receipt). Move
  or delete those by hand, run again with `--prune`, or keep the numbering stable. Library finds a renumbered
  chapter by its title in its book, so a reading place (`at`) or a quote holding the old path still opens it (not a
  title two chapters share).

## Tests

```sh
python3 -I test_import_book.py        # the parser: a note's link back keeps its paragraph, italics keep their spaces,
                                      # and the made-up sūtra book's shapes (make_test_epub.py --sutras) come out clean
LIBRARY_TEST_VAULT=<throwaway> LIBRARY_TEST_TOKEN_FILE=W LIBRARY_TEST_TYPES_TOKEN_FILE=A python3 -I test_import_book.py
```

The second also runs the re-import checks on a real hub (a made-up book, its own folder each run): a run cut off
before a picture is attached is finished by the next; running again changes nothing; a chapter he edited keeps
his words and gets no new picture when a better parse comes, while the others are updated; an update run cut off
midway is finished by the next; an edit he makes as the import writes (a 409), or between a stopped run and the
next, stays his.

## Checked

- A folder import of a whole book (57 records: the book, 28 chapters, 28 summaries; 9 pictures) into a throwaway
  vault and then a real one; a second run changed nothing (every `updatedAt` the same).
- The made-up sūtra book (`make_test_epub.py --sutras`, T-531): imported by the old importer, then by this one, then
  with `--prune`, into a throwaway hub: 9 records became 13, the 6 old paths were pruned, a third run changed nothing.
  Read in Library in `e2e/libraryreading.spec.ts`.
- A made-up epub (`make_test_epub.py`: parts, footnotes, endnotes, a picture, cross-references), drawn in Vault with
  its picture; and from a job, end to end, in `e2e/libraryadd.spec.ts`.

**The epub parser's known limits** (from review; none of them hit the folder import above): text in a
blockquote outside its paragraphs (a `<cite>` after the last `<p>`) comes before the quote; nested lists are
flattened into their item; paragraphs wrapped in a `<span>` or `<center>` merge into one; a block holding two
note targets is copied into each note; a short opening chapter (under 1,000 characters, not titled "Chapter n")
is filed under Front matter. If a picture is taken off an imported chapter, the next import attaches it again. A field a newer plan no longer
writes keeps its old value on the record (the hub merges fields, and the import never sends a null).

Not here yet: an anchor per verse, summaries made by a model (an AI's step, per chapter), and the import in the
app (`src/kit/epub.ts`), which will replace this script.
