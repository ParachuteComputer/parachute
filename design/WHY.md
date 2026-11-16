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

Checked against TASTE.md on the screenshots, grayscale included:

- **"not cluttered, not rigid boxy grids"**: B's rings in boxes read as an app grid of icons, and its regions are boxes;
  on the phone, B pushes the third vault below the fold. A is rows and rules, no boxes, and shows all three vaults on
  one phone screen. This decided it.
- **"Feels kind of like I'm reading an old book"**: A is literally a contents page: serif entries, italic chapter
  names, dotted leaders. B is more "landscape" (also on his list), but the rings make it feel like a launcher grid, which
  the brief says to avoid ("a calm place, not an app grid").
- **Daylight, grayscale**: both hold up in gray. A's hierarchy is type alone (display serif for the page name, book
  serif for entries, italic for what changed, sans for actions). B's ticks rely on a 4 px mark that may ghost on the
  e-ink screen and are small to read at arm's length.
- **"Clear content up front … easy to dig into"**: A puts a sentence of what changed next to each applet, so a glance
  tells you where to go. B's ticks say *that* something changed, not *what*.
- **"Good data visualizations are my love language"**: B's ticks were the stronger idea here, so the home applet keeps
  B's one data idea, the day line (a vertical rule with a node per day), drawn in A's type. That is the only thing
  carried over.

## How each choice maps to TASTE.md

| Choice (as built) | TASTE.md line |
|---|---|
| Paper ground `#f2ede2`, ink `#1d1a16`, one moss accent `#4f6b3a` for the pinned mark only | "Light, paper-like grounds"; "One or two earthy, ecological tones" |
| Book serif for names, italic serif for what changed, a quiet sans for actions and the bar | "small quiet old-book serifs with a quiet grotesk alongside" |
| Rows and hairline rules, no cards or tiles; two pages on the Daylight | "Calm order with room; not cluttered, not rigid boxy grids" |
| Dotted leaders, the ensō-like ◠ mark, glyphs as text (never colour emoji) | "Handmade/analog feel appeals" |
| No motion on the bar or the launcher; a sheet appears without a slide | "one transition per tap, no looping animation (it ghosts)"; "never bouncy" |
| A line of what changed beside each applet; vault names as chapter heads with "Open the vault" | "Clear content up front, plain navigation, obvious paths to dig deeper" |
| The home applet's day line | "New ways to present information"; "Good data visualizations are my love language" |
| Labels: "Launcher", "Pin to the bar", "Open on start"; no captions explaining the screen | "Warm, quiet, minimal words; never corporate SaaS tone; no explanatory chrome" |
| Current place on the bar: bold plus an underline; pinned: a dot plus the word | "hierarchy by type, weight, space, texture, never colour alone"; "Check every screen under grayscale" |
