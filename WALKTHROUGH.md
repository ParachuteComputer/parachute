# Walkthrough: Library reads an imported book cleanly (T-531)

**What is being judged:** whether an imported book now reads like a book: clean Contents links, plain headings, no
ornaments, even spacing, and the long first part cut at its verses. Screens are from the real build against a local
hub, with a made-up sūtra book (no real book's text).

**Run it:** `PARACHUTE_CORE=<parachute-core 0.9> LIBRARY_SHOTS=<dir> npx playwright test e2e/libraryreading.spec.ts --project phone`
(the book: `python3 -I tools/library-import/make_test_epub.py sutras.epub --sutras`, imported with `import_book.py`).

1. **The book's contents** (`docs/design/library-reading/before-01-book-phone.png` → `after-01-book-phone.png`).
   "Dedication and Books by were chapters of their own. Now they sit in Front matter, and the long first book is cut
   into pieces of a few verses each."
2. **The printed Contents** (`before-02-contents-phone.png` → `after-02-contents-phone.png`).
   "Before, each entry was raw link code with asterisks. Now each is one clean link; Index, with no page behind it,
   is plain words."
3. **A verse page** (`before-03-verse-phone.png` → `after-03-verse-phone.png`).
   "No more headings repeating the title or an ornament before every verse: the verse, its words, its meaning, the
   commentary, evenly spaced."
4. **Further in, with the one real picture** (`after-04-long-desktop.png`).
   "The book's own diagram stays, with the same space around it as around a paragraph."
5. **A book imported before the fix** (`after-05-old-import-phone.png`).
   "Until a book is imported again, the reader cleans it as it draws: plain headings, close together, and a link to a
   missing chapter is just words."
