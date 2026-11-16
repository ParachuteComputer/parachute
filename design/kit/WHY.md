# The parts and the default theme: two mockups, and the pick

Both mockups have the same structure: a sheet of the five parts (note, list, card, field, empty) and the Recipes applet
built from them. Each screen is shown in the default theme and again under a second theme record, to show that one
record restyles everything. They differ only in feel. The content is made up. The same markup (`mock.js`) is styled by
each page's tokens and part CSS. Screens are at Daylight 1600x1200 and phone 390x844, each with a grayscale copy, in
`shots/`.

| | A, "Ledger" (`mockup-a-ledger.html`) | B, "Herbarium" (`mockup-b-herbarium.html`) |
|---|---|---|
| Idea | A page of a well-kept book: paper, ink and hairline rules, and nothing sits in a box. | Pressed sheets on a table: soft rounded paper panels with a faint shadow, and a clay accent. |
| List | Rows under a ruled heading, divided by hairlines. Serif titles, an italic date on the right. | Each row is its own rounded panel. |
| Card | A block marked by one moss rule on its left. | A raised panel. |
| Field | An underline to write on, and a pill for its one action. | A boxed input, and a filled clay button. |
| Empty | One italic line after a short dash. | A dashed box with a leaf mark. |
| Note | Small spaced capitals for headings, as in a cookbook. | Clay serif headings and clay list markers. |

## The pick: A, with B's spacing as the "roomy" density

I checked both against the taste notes (paraphrased here) on the screenshots, grayscale included:

- **Hierarchy without colour (the Daylight).** In grayscale, B's panels are 6% lighter than the ground, so on a
  reflective screen they nearly vanish. Its section headings and dates are told apart mostly by the clay colour,
  which turns into mid-grey. A carries everything with type, weight and a rule: the gray shots read the same as the
  colour ones.
- **Not boxy.** B turns a list into a stack of tiles, close to the app grid the taste notes push against. A keeps the
  order calm with rules and space.
- **An old book with a little life.** A's small capitals, italic dates and single moss rule do this quietly. B's
  shadows and filled buttons lean toward a product UI.
- **One system.** A continues step 4's "Contents" launcher and its day-line home, so the frame, the home and the parts
  look like one book.
- **One or two earthy tones.** A uses moss alone. B needs clay beside it to hold its hierarchy.

From B: its spacing (18px gaps, 20px padding) becomes the theme's `roomy` density, for people who want more air.

## The second theme in the shots

`?theme=alt` swaps only the token values: a cooler paper, ink-blue accent and wider spacing in A, and moss with tight
corners in B. Nothing else changes, which is the promise of the theme record (docs/THEME.md).
