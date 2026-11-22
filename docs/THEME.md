# The theme

The look of the whole app comes from one note: the app's own screens, the frame (launcher, vaults, notes) and every
applet. Until you change it, the app uses the built-in Parachute theme: paper, ink, a moss accent, a book serif
(Literata) for reading and a quiet sans (Instrument Sans) for the app's own words.

A theme starts from one of four built-in **looks**, which set the palettes and how the parts are drawn (rules, corners,
depth, labels): `paper` (hairlines, soft corners, a card lifted a little, boxed fields), `almanac` (ink rules, dotted
rows, a printed card, a line to write on), `book` (a printed page: no raised parts, a double rule, small capitals) and
`daylight` (black on white for an e-paper screen: heavier rules, no tints or shadows, nothing moves). Every value a
look sets is a token, and the note can change any of them one by one.

Daylight is usually a screen's own choice, not the note's: the note syncs to every device, and only the e-paper one
should go black and white. Settings → Look → This screen sets it on the device alone, and a screen that says it is
e-paper (slow to redraw, or grey only) gets it by itself until you choose.

## The note

`Parachute/Theme` in your home vault, tagged `parachute-theme`. The theme sits in its `fields.theme` (on a hub
before 0.9, where a record's fields are called `metadata`, in `metadata.theme`):

```json
{
  "colors": { "bg": "#f2ede2", "surface": "#fbf8f1", "text": "#1d1a16", "muted": "#6d665a", "line": "#d9d1c1", "accent": "#4f6b3a", "danger": "#9a3324" },
  "dark": { "bg": "#171613", "surface": "#201e1a", "text": "#ece7dc", "muted": "#a59d8e", "line": "#3a362f", "accent": "#a3bf8a", "danger": "#f08f7f" },
  "fonts": { "serif": "Literata, \"Literata fallback\", Georgia, serif", "sans": "\"Instrument Sans\", \"Instrument Sans fallback\", system-ui, sans-serif", "mono": "ui-monospace, monospace" },
  "density": "regular",
  "scheme": "system",
  "motion": "flowing",
  "look": "almanac",
  "tokens": { "radius-card": "14px" }
}
```

| Key | What it sets |
|---|---|
| `colors` | The light palette: the page (`bg`), raised parts (`surface`), text, quieter text (`muted`), rules (`line`), the one accent, and `danger`. |
| `dark` | The same seven, for dark mode. |
| `fonts` | `serif` (names, titles and reading: notes, the journal, a record's body), `sans` (labels, buttons, the bar) and `mono`: lists of font names. The app carries two faces, Literata and Instrument Sans (SIL OFL, licences in `public/licenses/`), in every screen and applet with no download; any other font must be one the device has, since a theme loads nothing. They hold Western European letters (Latin-1), common punctuation, € and ™: ł, č, ő and the like, and any other script, come from the next font in the list. End with `serif`, `sans-serif` or `monospace`. A theme that holds the earlier built-in stacks word for word (written by "Make this look mine" before the app carried these faces) gets them too, and the next change in Settings writes them in; to keep system fonts, write the list another way. `… fallback` is a local font sized to the face, for the moment before it is drawn. |
| `density` | `compact`, `regular` or `roomy`: the padding, gaps, corners and text size. |
| `scheme` | `system` (follow the device), `light` or `dark`. |
| `motion` | `flowing` (pages, sheets and toasts arrive and go, a press gives) or `still` (nothing moves). A device set to reduce motion, or a screen slow to redraw (e-ink), is still whatever this says. |
| `look` | The built-in look the theme starts from: `paper`, `almanac`, `book` or `daylight`. It sets the two palettes (any colour the note gives stands over them), every style token below, and for `daylight` motion `still` unless the note says otherwise. |
| `tokens` | Any style token, by name without the `--` (`"radius-card": "14px"`, `"line-row": "1px dotted var(--muted)"`), over the look's value. Each is held to the grammar of its kind: a colour as `colors` takes one (below), `transparent`, or a palette colour by name (`var(--line)`); a rule (`1px solid <colour>`, the style one of `none`, `solid`, `dotted`, `dashed`, `double`); a length in `px`, `em` or `rem`; a shadow (`none`, or up to three of `<x> <y> <blur> <spread> <colour>`); a case, capitals or weight from the lists below. |

Every key is optional. Anything you leave out, or write in a form the app doesn't read, stays the built-in value, and
the rest still apply. A colour is hex (`#4f6b3a`) or `rgb()`, `hsl()`, `oklch()` or `oklab()` with plain numbers.
Nothing else is read, so a theme can't load anything from the network.

## Changing it

- **In the app:** Settings → Look. Choosing a style (paper, almanac or book), a density, light or dark, or motion writes the note; a new style keeps any colour you set yourself. This screen (as the theme, or Daylight) is kept on the device and writes nothing. The first change copies the
  built-in theme into your vault in full, and from then on that note is your theme. "Make this look mine" copies it without
  changing anything.
- **By your agent:** with the Parachute MCP, `create-record` or `update-record` on that record (`create-note`, `update-note` on older hubs). For example, "make the
  accent a deep blue and the app roomier" becomes `"colors": { "accent": "#2f5470" }, "density": "roomy"`.

The app follows the note while it runs. A change restyles every screen and every open applet at once, with no restart.
The app keeps the last theme it read, so it opens in your look even when the vault can't be reached. With no note,
it uses the built-in theme. Delete the note to go back to it.

## In an applet

The kit's parts (`Page`, `List`, `Button`, `Write`, `Note` and the rest, [WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)) are
drawn on these values, so they follow the theme with no work. Each value is also a CSS variable in the applet's frame:
`--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--danger`, `--serif`, `--sans`, `--mono`, `--pad`,
`--gap`, `--radius`, `--size`, `--leading`, and the style tokens in the table below. Write your CSS on these, and the
applet changes with the theme.

The style tokens, what each draws, and its value in `paper` and in `almanac` (`src/theme/theme.ts`, `STYLE_TOKENS` and
`LOOKS`, has all four looks):

| Token | What it draws | `paper` | `almanac` |
|---|---|---|---|
| `--primary` | The main action's fill (a primary button, a field's action). | `var(--accent)` | `var(--text)` |
| `--on-primary` | Text on the main action. | `#fdfbf7` | `var(--bg)` |
| `--tint` | A row under the pointer, the row open now: a light wash. | `color-mix(in srgb, var(--text) 5%, transparent)` | `color-mix(in srgb, var(--line) 30%, transparent)` |
| `--card-fill` | A card's ground. | `var(--surface)` | `var(--surface)` |
| `--field-fill` | The ground of a box to write in (search, a text box, a bare input). | `var(--surface)` | `var(--surface)` |
| `--entry-fill` | A one-line field's ground (the Field part). | `var(--surface)` | `transparent` |
| `--button-fill` | A plain button's ground. | `var(--surface)` | `var(--surface)` |
| `--label-ink` | A small label's colour (a kicker over a title, a note's section head). | `var(--muted)` | `var(--accent)` |
| `--line-head` | The rule over a list, a table or a record's fields. | `1px solid var(--line)` | `1px solid var(--text)` |
| `--line-row` | The rule between two rows. | `1px solid color-mix(in srgb, var(--line) 75%, transparent)` | `1px dotted var(--muted)` |
| `--line-card` | A card's edge, a toast's, a sheet's top. | `1px solid var(--line)` | `1px solid var(--text)` |
| `--line-quote` | The rule beside a quotation. | `2px solid var(--line)` | `3px double var(--text)` |
| `--field-line` | A box to write in: its edge (search, a text box, a bare input). | `1px solid var(--line)` | `1px solid var(--line)` |
| `--entry-line` | A one-line field's line (the Field part). | `1px solid var(--line)` | `1px solid var(--text)` |
| `--button-line` | A plain button's edge. | `1px solid var(--line)` | `1px solid var(--line)` |
| `--card-edges` | Which edges of a card are drawn (`1px`, or `1px 0 0` for a rule above only). | `1px` | `1px` |
| `--field-edges` | Which edges of a one-line field are drawn (`1px` boxed, `0 0 1px` a line to write on). | `1px` | `0 0 1px` |
| `--field-pad` | The space inside a one-line field. | `9px 12px` | `6px 0` |
| `--radius-card` | A card's corners (a sheet's are at least --radius). | `calc(var(--radius) * 1.4)` | `0px` |
| `--radius-field` | A box to write in: its corners. | `var(--radius)` | `var(--radius)` |
| `--radius-entry` | A one-line field's corners (0 for a line to write on). | `var(--radius)` | `0px` |
| `--radius-button` | A button's corners (`999px`: a pill). | `999px` | `999px` |
| `--shadow-card` | A card's depth, and a toast's (`none`: flat on the page). | `0 1px 0 rgb(60 45 30 / .05), 0 8px 22px -16px rgb(60 45 30 / .22)` | `3px 3px 0 var(--line)` |
| `--shadow-sheet` | The depth of a sheet rising over the page. | `0 -1px 0 var(--line), 0 -16px 40px -24px rgb(40 30 20 / .35)` | `none` |
| `--label-transform` | A small label's case: `none` or `uppercase`. | `none` | `uppercase` |
| `--label-caps` | A small label in small capitals: `normal` or `all-small-caps`. | `normal` | `normal` |
| `--label-track` | A small label's letter spacing, in em. | `0em` | `.14em` |
| `--title-weight` | The weight of a page's title and the serif headings. | `400` | `400` |
| `--measure` | A page's width at most. | `760px` | `760px` |

A case is `none`, `uppercase`, `lowercase` or `capitalize`; capitals `normal`, `small-caps` or `all-small-caps`; a
letter spacing between `-0.3em` and `0.3em`; a weight `100` to `900`.

Motion comes from three curves and four times: `--ease-out` (arriving or leaving), `--ease-in-out` (moving across
the screen), `--ease-drawer` (a sheet rising), and `--t-press` (160 ms, a press), `--t-state` (200 ms, a part arriving
or changing), `--t-sheet` (300 ms, a sheet or a toast) and `--t-step` (40 ms, a step between parts you move yourself; the kit's parts arrive together, with no delay). Move
only `transform` and `opacity`, on these: with reduce-motion on the device or a still theme every time is 0, and your
applet is still with the rest ([DESIGN-RULES.md](DESIGN-RULES.md)).

Text sizes come from one scale, a step each on `--size` (so density moves them all): `--fs-title` (a page's title, 2×),
`--fs-head` (a heading, 1.35×), `--fs-lead` (a row's or a note's text, 1.12×), `--fs-body` (1×), `--fs-small` (a line
under a row, 0.875×) and `--fs-label` (a small capital label, 0.75×). The shipped applets size text only with these,
and a check fails one that doesn't (`src/kit/conformance.ts`), so the same thing is the same size in every applet. `theme.get()` and `theme.on(cb)` give the same values as an object
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)).

## The order of styles

Every applet's frame, and every embed's, gets the look in four steps, each over the one before:

1. **The tokens:** the theme's values as CSS variables on the root (`--bg`, `--accent`, `--fs-title`, …, above).
2. **The base** (`@layer parachute.base`, `src/kit/base.css`): plain HTML drawn in the theme. Titles in the serif on
   the type scale, the sans for the rest, links in the accent; a bare `<button>`, `<input>`, `<select>`, `<textarea>`,
   `<table>`, `<blockquote>` or `<pre>` drawn as the kit draws them. An applet's frame is also a page: what it draws
   sits in the kit's column and margins (an embed's frame is not, nor a page with embeds: each is sized to what it
   draws, inside the shell's margins). An applet with no CSS
   of its own looks like the rest of Parachute.
3. **The parts** (`@layer parachute.parts`, `src/kit/parts.css`, with the note renderer's sheet beside it): the
   `pa-` classes the kit's parts are drawn with. An HTML applet can use them too, for example
   `<button class="pa-button pa-primary">Save</button>`. The base leaves an element with a `pa-` class to them, and
   a note the kit draws (its `Note`) to the note renderer.
4. **The applet's own CSS**, in no layer: it wins over all of the above, whatever its specificity (only the note
   renderer's few `!important` rules hold against it). `button { border-radius: 4px }` changes every button in the
   applet, the kit's included. Write it on the variables and it still follows the theme.

To draw edge to edge (a map, a canvas, a board), give the page back: `html, body { padding: 0 }`. To change a token for your
applet only, set it on `body` or on your own wrapper (`body { --accent: #8a5a2b; }`), not on `:root`: the app sets
the theme's values on the root itself, and sets them again when the theme changes (so name a variable of your own
another way than a token, `--my-…`). To add styles a later rule of yours
can still override at low weight, put them in a layer of your own (`@layer mine { … }`): a layer declared after the
kit's sits above it.

A component embedded in a page ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)) gets the same look, with two differences:
each colour comes as `#rrggbb` (one written another way comes as the built-in colour), and its fonts are always the
built-in ones. The theme note is text anyone you let write your vault can change, so only these few values reach code
from someone else's Parachute.
