# T-531 progress

Done
- synthetic sūtra epub (`make_test_epub.py --sutras`), e2e/libraryreading.spec.ts, before/after shots
- importer: plain one-line link labels, plain headings, ornaments out, short front matter folded, long parts cut at verses, --prune
- reader: readingBody, chapterFor (title fallback), even heading spacing
- docs/design/LIBRARY-READING.md, README

Next
- fresh review, PR to next, CI, merge, publish

Open
- pytest isn't installed here; importer tests run with `python3 -I test_import_book.py` (unittest)
