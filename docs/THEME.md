# The theme

The look of the whole app comes from one note: the app's own screens, the frame (launcher, vaults, notes) and every
applet. Until you change it, the app uses the built-in Parachute theme: paper, ink, a moss accent, a book serif and a
quiet sans.

## The note

`Parachute/Theme` in your home vault, tagged `parachute-theme`. The theme sits in its `fields.theme` (on a hub
before 0.9, where a record's fields are called `metadata`, in `metadata.theme`):

```json
{
  "colors": { "bg": "#f2ede2", "surface": "#fbf8f1", "text": "#1d1a16", "muted": "#6d665a", "line": "#d9d1c1", "accent": "#4f6b3a", "danger": "#9a3324" },
  "dark": { "bg": "#171613", "surface": "#201e1a", "text": "#ece7dc", "muted": "#a59d8e", "line": "#3a362f", "accent": "#a3bf8a", "danger": "#f08f7f" },
  "fonts": { "serif": "\"Iowan Old Style\", Palatino, \"Noto Serif\", Georgia, serif", "sans": "system-ui, \"Noto Sans\", sans-serif", "mono": "ui-monospace, monospace" },
  "density": "regular",
  "scheme": "system"
}
```

| Key | What it sets |
|---|---|
| `colors` | The light palette: the page (`bg`), raised parts (`surface`), text, quieter text (`muted`), rules (`line`), the one accent, and `danger`. |
| `dark` | The same seven, for dark mode. |
| `fonts` | `serif`, `sans` and `mono`: lists of font names. The app loads no fonts, so name fonts the device has, and end with `serif`, `sans-serif` or `monospace`. |
| `density` | `compact`, `regular` or `roomy`: the padding, gaps, corners and text size. |
| `scheme` | `system` (follow the device), `light` or `dark`. |

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

The parts (`Note`, `Days`, `List`, `Card`, `Field`, `Empty`) are drawn on these values, so they follow the theme with
no work. Each value is also a CSS variable in the applet's frame: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`,
`--danger`, `--serif`, `--sans`, `--mono`, `--pad`, `--gap`, `--radius`, `--size`, `--leading`. Write your CSS on
these, and the applet changes with the theme. `theme.get()` and `theme.on(cb)` give the same values as an object
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)).

A component embedded in a page ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)) gets the same look, with two differences:
each colour comes as `#rrggbb` (one written another way comes as the built-in colour), and its fonts are always the
built-in ones. The theme note is text anyone you let write your vault can change, so only these few values reach code
from someone else's Parachute.
