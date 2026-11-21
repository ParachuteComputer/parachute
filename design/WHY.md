# The launcher, the bar and a home applet: two mockups, and the pick

Same structure in both (set by the brief): the launcher with every applet and vault, a bar at the foot with the
launcher and the pinned places, and a home page (recent notes across vaults, plus pins). They differ in feel.
Made-up content. Screens at Daylight 1600x1200 and phone 390x844, each with a grayscale copy, in `shots/`.

| | A, "Contents" (`mockup-a-contents.html`) | B, "Field" (`mockup-b-field.html`) |
|---|---|---|
| Idea | The launcher is the contents page of an old book: vaults are chapters, applets are entries with a dotted leader to a line of what changed lately. On the Daylight it opens as a two-page spread. | A field notebook: contour lines on the ground, each applet a hand-drawn ring with its glyph, and fourteen ticks under it, one per day, dark where something changed. |
| Life per applet | Words: "lentil soup, 2 days ago". | A tick strip: a two-week pattern at a glance. |
| Bar | A ribbon of words across the foot; the current place underlined. | Pills; the current place ringed. |
| Home | "Sunday", a line of how much changed, the notes by day; pins as a row of words. | "Sunday" and a river: a line down the page with a node per day. |

## The pick: A, with B's day line on the home applet

Checked against the taste notes (paraphrased here) on the screenshots, grayscale included:

- **Calm order with room, no rigid boxes**: B's rings in boxes read as an app grid of icons, and its regions are boxes;
  on the phone, B pushes the third vault below the fold. A is rows and rules, no boxes, and shows all three vaults on
  one phone screen. This decided it.
- **A paper, book-like feel with a little life**: A is literally a contents page: serif entries, italic chapter
  names, dotted leaders. B is closer to a landscape (also liked), but the rings make it feel like a launcher grid, which
  the brief says to avoid: a calm place, not an app grid.
- **Daylight, grayscale**: both hold up in gray. A's hierarchy is type alone (display serif for the page name, book
  serif for entries, italic for what changed, sans for actions). B's ticks rely on a 4 px mark that may ghost on the
  e-ink screen and are small to read at arm's length.
- **Content up front, simple to explore further**: A puts a sentence of what changed next to each applet, so a glance tells you
  where to go. B's ticks say *that* something changed, not *what*.
- **New ways to show information; a love of good data visualisation**: B's ticks were the stronger idea here, so the
  home applet keeps B's one data idea, the day line (a vertical rule with a node per day), drawn in A's type. That is
  the only thing carried over.

## How each choice maps to the taste notes

| Choice (as built) | Taste note (paraphrased) |
|---|---|
| Paper ground `#f2ede2`, ink `#1d1a16`, one moss accent `#4f6b3a` for the pinned mark only | Light paper grounds; one or two earthy tones |
| Book serif for names, italic serif for what changed, a quiet sans for actions and the bar | Small, quiet old-book serifs beside a quiet grotesk |
| Rows and hairline rules, no cards or tiles; two pages on the Daylight | Calm order with room; nothing boxy |
| Dotted leaders, the ensō-like ◠ mark, glyphs as text (never colour emoji) | A handmade, analog feel |
| No motion on the bar or the launcher; what arrives (a page, a sheet, a toast) comes in once, in 200–300 ms, on one curve, and nothing moves on a slow screen or with reduce motion ([DESIGN-RULES.md](../docs/DESIGN-RULES.md)) | One transition per tap, nothing looping (e-ink ghosts); never bouncy |
| A line of what changed beside each applet; vault names as chapter heads with "Open the vault" | Clear content first, plain navigation, obvious ways to dig deeper |
| The home applet's day line | New ways to present information; good data visualisation |
| Labels: "Launcher", "Pin to the bar", "Open on start"; no captions explaining the screen | Warm, quiet, few words; no SaaS tone, no explanatory chrome |
| Current place on the bar: bold plus an underline; pinned: a dot plus the word | Hierarchy by type, weight and space, never colour alone; every screen checked in gray |
