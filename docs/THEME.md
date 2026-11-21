# The theme

The look of the whole app comes from one note: the app's own screens, the frame (launcher, vaults, notes) and every
applet. Until you change it, the app uses the built-in Parachute theme: paper, ink, a moss accent, a book serif
(Literata) for reading and a quiet sans (Instrument Sans) for the app's own words.

## The note

`Parachute/Theme` in your home vault, tagged `parachute-theme`. The theme sits in its `fields.theme` (on a hub
before 0.9, where a record's fields are called `metadata`, in `metadata.theme`):

```json
{
  "colors": { "bg": "#f2ede2", "surface": "#fbf8f1", "text": "#1d1a16", "muted": "#6d665a", "line": "#d9d1c1", "accent": "#4f6b3a", "danger": "#9a3324" },
  "dark": { "bg": "#171613", "surface": "#201e1a", "text": "#ece7dc", "muted": "#a59d8e", "line": "#3a362f", "accent": "#a3bf8a", "danger": "#f08f7f" },
  "fonts": { "serif": "Literata, \"Iowan Old Style\", Georgia, serif", "sans": "\"Instrument Sans\", system-ui, sans-serif", "mono": "ui-monospace, monospace" },
  "density": "regular",
  "scheme": "system",
  "motion": "flowing"
}
```

| Key | What it sets |
|---|---|
| `colors` | The light palette: the page (`bg`), raised parts (`surface`), text, quieter text (`muted`), rules (`line`), the one accent, and `danger`. |
| `dark` | The same seven, for dark mode. |
| `fonts` | `serif` (names, titles and reading: notes, the journal, a record's body), `sans` (labels, buttons, the bar) and `mono`: lists of font names. The app carries two faces, Literata and Instrument Sans (SIL OFL, `src/theme/fonts/`), in every screen and applet with no download; any other font must be one the device has, since a theme loads nothing. They hold Latin letters only; any other letter comes from the next font in the list. End with `serif`, `sans-serif` or `monospace`. A theme that holds the earlier built-in stacks word for word (written by "Make this look mine" before the app carried these faces) gets them too; to keep system fonts, write the list another way. |
| `density` | `compact`, `regular` or `roomy`: the padding, gaps, corners and text size. |
| `scheme` | `system` (follow the device), `light` or `dark`. |
| `motion` | `flowing` (pages, sheets and toasts arrive and go, a press gives) or `still` (nothing moves). A device set to reduce motion, or a screen slow to redraw (e-ink), is still whatever this says. |

Every key is optional. Anything you leave out, or write in a form the app doesn't read, stays the built-in value, and
the rest still apply. A colour is hex (`#4f6b3a`) or `rgb()`, `hsl()`, `oklch()` or `oklab()` with plain numbers.
Nothing else is read, so a theme can't load anything from the network.

## Changing it

- **In the app:** Settings → Look. Choosing a density or light or dark writes the note. The first change copies the
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
`--gap`, `--radius`, `--size`, `--leading`. Write your CSS on these, and the applet changes with the theme.

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

A component embedded in a page ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)) gets the same look, with two differences:
each colour comes as `#rrggbb` (one written another way comes as the built-in colour), and its fonts are always the
built-in ones. The theme note is text anyone you let write your vault can change, so only these few values reach code
from someone else's Parachute.
