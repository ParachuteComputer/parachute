// The look: one theme, a record the person (or their agent) can change, that the shell, the frame and every applet
// follow (docs/THEME.md). Pure: the record's metadata in, tokens out.
//
//   the record    `Parachute/Theme` in the home vault, tagged `parachute-theme`. Its metadata `theme`:
//                   colors:  { bg, surface, text, muted, line, accent, danger }   the light palette
//                   dark:    { …the same keys }                                   the dark palette
//                   fonts:   { serif, sans, mono, display }                       font stacks, by name
//                   density: compact | regular | roomy
//                   scheme:  system | light | dark          which palette shows (system: the device's choice)
//                   motion:  flowing | still                  whether the parts move (still: nothing does; the device's
//                                                             reduce-motion setting is still too, whatever this says)
//                   look:    paper | almanac | book | daylight     the built-in look it starts from (LOOKS): the palettes and
//                                                             how the parts are drawn (rules, corners, depth, labels)
//                   tokens:  { "radius-card": "14px", … }      any of the look's style tokens (STYLE_TOKENS), one by one
//                 Every key is optional: what it leaves out (or gives in a form this reads not) is the built-in value.
//   absent        the built-in theme (DEFAULT_THEME): the default look (paper) in its own palettes.
//
// Values are held to a strict grammar, because they end up in CSS that the shell, the frame and applets all apply: a
// colour is hex, rgb(), hsl(), oklch() or oklab() with numbers only; a font is a list of family names. Nothing that
// could load a URL (url(), image-set(), @import) or reach another value (var(), attr()) can pass.

export const COLOR_KEYS = ["bg", "surface", "text", "muted", "line", "accent", "danger"] as const;
export const FONT_KEYS = ["serif", "sans", "mono", "display"] as const;
export const DENSITIES = ["compact", "regular", "roomy"] as const;
export const SCHEMES = ["system", "light", "dark"] as const;
export const MOTIONS = ["flowing", "still"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type FontKey = (typeof FONT_KEYS)[number];
export type Density = (typeof DENSITIES)[number];
export type Scheme = (typeof SCHEMES)[number];
export type Motion = (typeof MOTIONS)[number];
export type Palette = Record<ColorKey, string>;
export type Theme = { colors: Palette; dark: Palette; fonts: Record<FontKey, string>; density: Density; scheme: Scheme; motion: Motion; look: LookName; tokens: Partial<Record<StyleKey, string>> };

/** What density sets: padding, the gap between parts, corner radius, the body text size, and its line height. */
export const DENSITY_KEYS = ["pad", "gap", "radius", "size", "leading"] as const;
export type DensityKey = (typeof DENSITY_KEYS)[number];
export const DENSITY: Record<Density, Record<DensityKey, string>> = {
  compact: { pad: "10px", gap: "10px", radius: "8px", size: "15px", leading: "1.4" },
  regular: { pad: "14px", gap: "14px", radius: "10px", size: "16px", leading: "1.45" },
  roomy: { pad: "20px", gap: "18px", radius: "12px", size: "17px", leading: "1.55" },
};

// ── The style tokens: how the parts are drawn, beside the palette and the faces. One table, read by everything: the CSS
// variables `--<name>` the shell, the frame and every applet get (cssOf, the theme event), what a theme record's
// `tokens` may set and the grammar each value is held to, and the token reference in docs/THEME.md. A look (LOOKS) gives
// every one a value; a record's `tokens` changes them one by one.
export type StyleKind = "color" | "line" | "edges" | "length" | "pad" | "shadow" | "transform" | "caps" | "track" | "weight";
export const STYLE_TOKENS = {
  "primary":         { kind: "color", what: "the main action's fill (a primary button, a field's action)" },
  "on-primary":      { kind: "color", what: "text on the main action" },
  "tint":            { kind: "color", what: "a row under the pointer, the row open now: a light wash" },
  "card-fill":       { kind: "color", what: "a card's ground" },
  "field-fill":      { kind: "color", what: "the ground of a box to write in (search, a text box, a bare input)" },
  "entry-fill":      { kind: "color", what: "a one-line field's ground (the Field part)" },
  "button-fill":     { kind: "color", what: "a plain button's ground" },
  "label-ink":       { kind: "color", what: "a small label's colour (a kicker over a title, a note's section head)" },
  "line-head":       { kind: "line", what: "the rule over a list, a table or a record's fields" },
  "line-row":        { kind: "line", what: "the rule between two rows" },
  "line-card":       { kind: "line", what: "a card's edge, a toast's, a sheet's top" },
  "line-quote":      { kind: "line", what: "the rule beside a quotation" },
  "field-line":      { kind: "line", what: "a box to write in: its edge (search, a text box, a bare input)" },
  "entry-line":      { kind: "line", what: "a one-line field's line (the Field part)" },
  "button-line":     { kind: "line", what: "a plain button's edge" },
  "card-edges":      { kind: "edges", what: "which edges of a card are drawn (`1px`, or `1px 0 0` for a rule above only)" },
  "field-edges":     { kind: "edges", what: "which edges of a one-line field are drawn (`1px` boxed, `0 0 1px` a line to write on)" },
  "field-pad":       { kind: "pad", what: "the space inside a one-line field" },
  "radius-card":     { kind: "length", what: "a card's corners (a sheet's are at least --radius)" },
  "radius-field":    { kind: "length", what: "a box to write in: its corners" },
  "radius-entry":    { kind: "length", what: "a one-line field's corners (0 for a line to write on)" },
  "radius-button":   { kind: "length", what: "a button's corners (`999px`: a pill)" },
  "shadow-card":     { kind: "shadow", what: "a card's depth, and a toast's (`none`: flat on the page)" },
  "shadow-sheet":    { kind: "shadow", what: "the depth of a sheet rising over the page" },
  "label-transform": { kind: "transform", what: "a small label's case: `none` or `uppercase`" },
  "label-caps":      { kind: "caps", what: "a small label in small capitals: `normal` or `all-small-caps`" },
  "label-track":     { kind: "track", what: "a small label's letter spacing, in em" },
  "title-weight":    { kind: "weight", what: "the weight of a page's title and the serif headings" },
  "measure":         { kind: "length", what: "a page's width at most (never under 20em)" },
  "sky-top":           { kind: "color", what: "the hour's sky at the very top of a place's first page (it changes with the time of day)" },
  "sky-mid":           { kind: "color", what: "the hour's sky halfway down the head" },
  "sky-foot":           { kind: "color", what: "where the sky meets the paper" },
} as const satisfies Record<string, { kind: StyleKind; what: string }>;
export type StyleKey = keyof typeof STYLE_TOKENS;
export const STYLE_KEYS = Object.keys(STYLE_TOKENS) as StyleKey[];

/** A built-in look: the two palettes and every style token (a value may name a palette colour, `var(--line)`, or mix
 *  them; a record's own values are held to the grammar instead), with what changes in the dark. */
export type Look = { colors: Palette; dark: Palette; style: Record<StyleKey, string>; darkStyle?: Partial<Record<StyleKey, string>>; motion?: Motion;
  /** the sky at the head of a place for each part of the day (sky-top, sky-mid, sky-foot), light and dark; a look without one
   *  keeps its style's sky all day */
  skies?: Record<Hour, readonly [string, string, string]>; darkSkies?: Record<Hour, readonly [string, string, string]> };
/** The parts of the day the sky follows: morning (5 to 11), midday (to 16), evening (to 21), night. */
export const HOURS = ["morning", "midday", "evening", "night"] as const;
export type Hour = (typeof HOURS)[number];
export const hourOf = (d: Date = new Date()): Hour => { const h = d.getHours(); return h < 5 ? "night" : h < 11 ? "morning" : h < 16 ? "midday" : h < 21 ? "evening" : "night"; };
export const LOOK_NAMES = ["paper", "almanac", "book", "daylight"] as const;
export type LookName = (typeof LOOK_NAMES)[number];

const ALMANAC_COLORS: Palette = { bg: "#f2ede2", surface: "#fbf8f1", text: "#1d1a16", muted: "#6d665a", line: "#d9d1c1", accent: "#4f6b3a", danger: "#9a3324" };
const ALMANAC_DARK: Palette = { bg: "#171613", surface: "#201e1a", text: "#ece7dc", muted: "#a59d8e", line: "#3a362f", accent: "#a3bf8a", danger: "#f08f7f" };
/** Paper's palettes before the sky (11-22): moss on cream, the almanac's. "Make this look mine" wrote them into a theme in
 *  full, so a colour in a paper theme that is one of these, key for key, is the built-in colour of its day, not a choice:
 *  it reads as today's (EARLIER_FONTS does the same for the faces). */
const EARLIER_PAPER: { colors: Palette; dark: Palette } = { colors: ALMANAC_COLORS, dark: ALMANAC_DARK };
/** No sky: the look's ground all day (almanac, book, Daylight). */
const NO_SKY = { "sky-top": "var(--bg)", "sky-mid": "var(--bg)", "sky-foot": "var(--bg)" } as const;

export const LOOKS: Record<LookName, Look> = {
  // Paper (the default), under the sky (docs/LOOK.md): warm paper with hairlines where you read, scan or write; the hour's
  // sky at the head of a place's first page; a place's name in Fraunces; coral only for the one thing you do next (the
  // primary); the sky's own ink for links, focus and the ticked box. Soft corners in three sizes, the one card with light
  // on it, boxed fields, labels in plain sentence case.
  paper: {
    colors: { bg: "#fbf8f1", surface: "#ffffff", text: "#27221d", muted: "#6b6459", line: "#e6ddcc", accent: "#36627d", danger: "#a3341f" },
    dark: { bg: "#1a1814", surface: "#24211c", text: "#ede6d9", muted: "#a89f90", line: "#3a352d", accent: "#8fbad3", danger: "#f08f7f" },
    skies: {
      morning: ["#e6f0f6", "#fbf0d6", "#fcf7ec"], midday: ["#d9e9f2", "#edf4f6", "#fbf8f1"],
      evening: ["#e5e2ec", "#f6dccb", "#fbeee3"], night: ["#d9dbe6", "#e9e4e6", "#f6f1ea"],
    },
    darkSkies: {
      morning: ["#26323b", "#2e2a22", "#1f1c17"], midday: ["#1f313d", "#1f2a2e", "#1c1a16"],
      evening: ["#2c2738", "#3a2a25", "#211b18"], night: ["#1b2032", "#211f27", "#1a1814"],
    },
    style: {
      "primary": "#bf4a2a", "on-primary": "#ffffff", "tint": "color-mix(in srgb, var(--text) 5%, transparent)",
      "card-fill": "var(--surface)", "field-fill": "var(--surface)", "button-fill": "var(--surface)", "label-ink": "var(--muted)",
      "line-head": "1px solid var(--line)", "line-row": "1px solid color-mix(in srgb, var(--line) 75%, transparent)", "line-card": "1px solid var(--line)",
      "line-quote": "2px solid var(--line)", "field-line": "1px solid var(--line)", "button-line": "1px solid var(--line)",
      "entry-line": "1px solid var(--line)", "entry-fill": "var(--surface)",
      "card-edges": "1px", "field-edges": "1px", "field-pad": "9px 12px",
      "radius-card": "calc(var(--radius) * 1.4)", "radius-field": "var(--radius)", "radius-entry": "var(--radius)", "radius-button": "999px",
      "shadow-card": "0 1px 2px rgb(60 45 30 / .05), 0 12px 32px -6px rgb(60 45 30 / .12)",
      "shadow-sheet": "0 -1px 0 var(--line), 0 -16px 40px -24px rgb(40 30 20 / .35)",
      "label-transform": "none", "label-caps": "normal", "label-track": "0em", "title-weight": "600", "measure": "760px",
      "sky-top": "#d9e9f2", "sky-mid": "#edf4f6", "sky-foot": "#fbf8f1",
    },
    darkStyle: { "primary": "#e07552", "on-primary": "#1a1814", "shadow-card": "0 1px 0 rgb(0 0 0 / .3), 0 12px 28px -18px rgb(0 0 0 / .6)", "shadow-sheet": "0 -1px 0 var(--line), 0 -16px 40px -24px rgb(0 0 0 / .7)" },
  },
  // Almanac: the look of an old almanac (design/kit/WHY.md): ink rules and type rather than boxes, dotted rows, a card
  // printed with a hard edge, a line to write on, small capital labels in the accent.
  almanac: {
    colors: ALMANAC_COLORS,
    dark: ALMANAC_DARK,
    style: {
      "primary": "var(--text)", "on-primary": "var(--bg)", "tint": "color-mix(in srgb, var(--line) 30%, transparent)",
      "card-fill": "var(--surface)", "field-fill": "var(--surface)", "button-fill": "var(--surface)", "label-ink": "var(--accent)",
      "line-head": "1px solid var(--text)", "line-row": "1px dotted var(--muted)", "line-card": "1px solid var(--text)",
      "line-quote": "3px double var(--text)", "field-line": "1px solid var(--line)", "button-line": "1px solid var(--line)",
      "entry-line": "1px solid var(--text)", "entry-fill": "transparent",
      "card-edges": "1px", "field-edges": "0 0 1px", "field-pad": "6px 0",
      "radius-card": "0px", "radius-field": "var(--radius)", "radius-entry": "0px", "radius-button": "999px",
      "shadow-card": "3px 3px 0 var(--line)", "shadow-sheet": "none",
      "label-transform": "uppercase", "label-caps": "normal", "label-track": ".14em", "title-weight": "400", "measure": "760px",
      ...NO_SKY,
    },
  },
  // Book: a printed page. No raised surfaces (a card is a section under a rule), a double rule over a list, rows set
  // apart by space and a faint line, small capitals for labels, letterpress buttons, an oxblood accent.
  book: {
    colors: { bg: "#f6f1e7", surface: "#f6f1e7", text: "#23201b", muted: "#686155", line: "#d3c9b7", accent: "#7d3326", danger: "#7d3326" },
    dark: { bg: "#1a1815", surface: "#1a1815", text: "#e9e2d4", muted: "#a39a8a", line: "#3d382f", accent: "#d99a86", danger: "#f08f7f" },
    style: {
      "primary": "var(--text)", "on-primary": "var(--bg)", "tint": "color-mix(in srgb, var(--accent) 7%, transparent)",
      "card-fill": "transparent", "field-fill": "transparent", "button-fill": "transparent", "label-ink": "var(--accent)",
      "line-head": "3px double var(--text)", "line-row": "1px solid color-mix(in srgb, var(--line) 55%, transparent)", "line-card": "1px solid var(--text)",
      "line-quote": "1px solid var(--accent)", "field-line": "1px solid var(--muted)", "button-line": "1px solid var(--text)",
      "entry-line": "1px solid var(--text)", "entry-fill": "transparent",
      "card-edges": "1px 0 0", "field-edges": "0 0 1px", "field-pad": "5px 0",
      "radius-card": "0px", "radius-field": "2px", "radius-entry": "0px", "radius-button": "3px",
      "shadow-card": "none", "shadow-sheet": "0 -1px 0 var(--text)",
      "label-transform": "none", "label-caps": "all-small-caps", "label-track": ".08em", "title-weight": "400", "measure": "700px",
      ...NO_SKY,
    },
  },
  // Daylight: black on white for an e-paper screen, which shows grey badly and redraws slowly: no tints or shadows,
  // heavier rules, the state of a thing by inversion and by words, nothing that moves.
  daylight: {
    colors: { bg: "#ffffff", surface: "#ffffff", text: "#000000", muted: "#333333", line: "#555555", accent: "#000000", danger: "#000000" },
    dark: { bg: "#000000", surface: "#000000", text: "#ffffff", muted: "#d0d0d0", line: "#aaaaaa", accent: "#ffffff", danger: "#ffffff" },
    style: {
      "primary": "var(--text)", "on-primary": "var(--bg)", "tint": "transparent",
      "card-fill": "var(--bg)", "field-fill": "var(--bg)", "button-fill": "var(--bg)", "label-ink": "var(--text)",
      "line-head": "2px solid var(--text)", "line-row": "1px solid var(--line)", "line-card": "2px solid var(--text)",
      "line-quote": "3px solid var(--text)", "field-line": "2px solid var(--text)", "button-line": "2px solid var(--text)",
      "entry-line": "2px solid var(--text)", "entry-fill": "var(--bg)",
      "card-edges": "2px", "field-edges": "2px", "field-pad": "8px 12px",
      "radius-card": "var(--radius)", "radius-field": "var(--radius)", "radius-entry": "var(--radius)", "radius-button": "999px",
      "shadow-card": "none", "shadow-sheet": "none",
      "label-transform": "uppercase", "label-caps": "normal", "label-track": ".08em", "title-weight": "500", "measure": "760px",
      ...NO_SKY,
    },
    motion: "still",
  },
};
/** The look the app starts in. */
export const DEFAULT_LOOK: LookName = "paper";

// The grammar of a style token in a record (the built-in looks are code, and may name or mix palette colours): a colour
// is one isColor reads, `transparent`, or one of the seven palette colours by name (`var(--line)`); nothing else can
// reach another value or load anything.
const PALETTE_REF = new RegExp(`^var\\(--(?:${COLOR_KEYS.join("|")})\\)$`);
const tokenColor = (v: string) => isColor(v) || v === "transparent" || PALETTE_REF.test(v);
const LEN = String.raw`(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|em|rem))`;
/** Between two parts of a value: plain spaces only (a no-break or a line separator would pass \s and break the CSS). */
const SP = "[ \\t]+";
const LINE = new RegExp(String.raw`^(?:0|\d{1,2}(?:\.\d)?px)${SP}(none|solid|dotted|dashed|double)${SP}(.+)$`);
const EDGES = new RegExp(String.raw`^(?:0|\d(?:\.\d)?px)(?:${SP}(?:0|\d(?:\.\d)?px)){0,3}$`);
const PAD = new RegExp(String.raw`^${LEN}(?:${SP}${LEN}){0,3}$`);
const ONE_SHADOW = new RegExp(String.raw`^(?:inset${SP})?(-?${LEN})${SP}(-?${LEN})(?:${SP}${LEN}(?:${SP}-?${LEN})?)?${SP}(.+)$`);
/** A list's items split at its commas outside parentheses (a shadow's colour may be `rgba(1, 2, 3, .2)`). */
const topLevel = (v: string) => { const out: string[] = []; let depth = 0, from = 0; for (let i = 0; i < v.length; i++) { const c = v[i]; if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { out.push(v.slice(from, i)); from = i + 1; } } out.push(v.slice(from)); return out; };
/** A style token's value as a record gives it: kept if its kind's grammar reads it, else null (the look's value stands). */
export function styleValue(key: StyleKey, v: unknown): string | null {
  if (typeof v !== "string" || v.length > 200) return null;
  // trimmed of plain spaces only: String.trim would also take a no-break space or a line separator, which CSS doesn't
  const ascii = (x: string) => x.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "");
  const s = ascii(v);
  const ok = (() => {
    switch (STYLE_TOKENS[key].kind) {
      case "color": return tokenColor(s);
      case "line": { const m = LINE.exec(s); return !!m && tokenColor(ascii(m[2])); }
      case "edges": return EDGES.test(s);
      case "pad": return PAD.test(s);
      case "length": return new RegExp(`^${LEN}$`).test(s);  // a bare 0 is written 0px below: max(0, 10px) is not CSS
      case "shadow": { const all = topLevel(s); return s === "none" || (all.length <= 3 && all.every((one) => { const m = ONE_SHADOW.exec(ascii(one)); return !!m && tokenColor(ascii(m[3])); })); }
      case "transform": return ["none", "uppercase", "lowercase", "capitalize"].includes(s);
      case "caps": return ["normal", "small-caps", "all-small-caps"].includes(s);
      case "track": return /^-?(?:0|0?\.\d{1,3})em$/.test(s) && Math.abs(parseFloat(s)) <= 0.3;
      case "weight": return /^[1-9]00$/.test(s);
    }
  })();
  return ok ? (STYLE_TOKENS[key].kind === "length" && s === "0" ? "0px" : s) : null;
}

/** What this one screen shows, whatever the theme note says (the note syncs to every device; a screen's own nature
 *  doesn't): `daylight` draws the Daylight look, black on white and still, for an e-paper screen. */
export const SCREENS = ["theme", "daylight"] as const;
export type ScreenChoice = (typeof SCREENS)[number];
export function onScreen(theme: Theme, screen: ScreenChoice): Theme {
  if (screen !== "daylight") return theme;
  const d = LOOKS.daylight;
  return { ...theme, look: "daylight", colors: { ...d.colors }, dark: { ...d.dark }, tokens: {}, motion: "still", scheme: "light" };
}

/** The built-in theme: paper under the hour's sky, ink, coral for the one thing to do next; a display serif (Fraunces)
 *  for a place's name, a book serif (Literata) for reading and a quiet sans (Instrument Sans) for the rest, all carried by
 *  the app (fonts.ts), each with a local font sized to it and the old system stacks behind (docs/LOOK.md). */
export const DEFAULT_THEME: Theme = {
  colors: { ...LOOKS[DEFAULT_LOOK].colors },
  dark: { ...LOOKS[DEFAULT_LOOK].dark },
  fonts: {
    serif: `"Literata", "Literata fallback", "Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif`,
    sans: `"Instrument Sans", "Instrument Sans fallback", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`,
    mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
    display: `"Fraunces", "Fraunces fallback", "Literata", Georgia, serif`,
  },
  density: "regular",
  scheme: "system",
  motion: "flowing",
  look: DEFAULT_LOOK,
  tokens: {},
};

/** Every token, as the CSS variable `--<key>` and as a key of the object applets get. One list, used everywhere. */
export const TOKEN_KEYS = [...COLOR_KEYS, ...FONT_KEYS, ...DENSITY_KEYS, ...STYLE_KEYS] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
/** The look as applied: every token's value, which palette shows, the density by name, and whether the parts move. */
export type Tokens = Record<TokenKey, string> & { scheme: "light" | "dark"; density: Density; motion: Motion; look: LookName; hour: Hour };

// One way to read each number, and a separator required between two (a comma, a slash or a space): a pattern that could
// split a run of digits many ways would take seconds on a hostile value, and this one runs at every start.
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|turn|rad)?`;
// three values and an optional alpha, written one way throughout: commas (rgb(1, 2, 3, .5)) or spaces (rgb(1 2 3 / 50%))
const W = "[ \\t]*";
const FN = new RegExp(String.raw`^(?:rgba?|hsla?|oklch|oklab)\(${W}${NUM}(?:(?:${W},${W}${NUM}){2}(?:${W},${W}${NUM})?|(?:[ \t]+${NUM}){2}(?:${W}/${W}${NUM})?)${W}\)$`, "i");
/** A colour this reads: hex (3, 4, 6 or 8 digits), or rgb/hsl/oklch/oklab with numbers only. */
export const isColor = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || FN.test(v));
const FAMILY = /^\s*(?:"[A-Za-z0-9 -]{1,60}"|'[A-Za-z0-9 -]{1,60}'|-?[A-Za-z][A-Za-z0-9 -]{0,60})\s*$/;
/** A font stack this reads: family names (quoted or bare), separated by commas. */
export const isFontStack = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300 && v.split(",").length <= 12 && v.split(",").every((f) => FAMILY.test(f));

/** The built-in stacks of an earlier app (system fonts only). "Make this look mine" wrote them into a person's theme in
 *  full, so one there word for word is the built-in face of its day, not a choice: it reads as today's. */
const EARLIER_FONTS: Partial<Record<FontKey, readonly string[]>> = {
  serif: [`"Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif`],
  sans: [`system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`],
};

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** A palette over the look's: each colour the record gives that reads, but one that is only `earlier`'s built-in colour. */
function palette(given: unknown, base: Palette, earlier?: Palette): Palette {
  const out = { ...base };
  if (plain(given)) for (const k of COLOR_KEYS) if (isColor(given[k]) && given[k].trim().toLowerCase() !== earlier?.[k].toLowerCase()) out[k] = given[k].trim();
  return out;
}

/** The theme a record's metadata gives, over the built-in one. A value that doesn't read is the built-in value; the rest stand. */
export function themeFrom(metadata: unknown): Theme {
  const t = plain(metadata) && plain(metadata.theme) ? metadata.theme : null;
  if (!t) return structuredClone(DEFAULT_THEME);
  const look: LookName = (LOOK_NAMES as readonly unknown[]).includes(t.look) ? (t.look as LookName) : DEFAULT_LOOK;
  const tokens: Partial<Record<StyleKey, string>> = {};
  if (plain(t.tokens)) for (const k of STYLE_KEYS) { const v = styleValue(k, t.tokens[k]); if (v !== null) tokens[k] = v; }
  const fonts = { ...DEFAULT_THEME.fonts };
  if (plain(t.fonts)) for (const k of FONT_KEYS) if (isFontStack(t.fonts[k]) && !EARLIER_FONTS[k]?.includes((t.fonts[k] as string).trim())) fonts[k] = (t.fonts[k] as string).trim();
  return {
    colors: palette(t.colors, LOOKS[look].colors, look === "paper" ? EARLIER_PAPER.colors : undefined),
    dark: palette(t.dark, LOOKS[look].dark, look === "paper" ? EARLIER_PAPER.dark : undefined),
    fonts,
    density: (DENSITIES as readonly unknown[]).includes(t.density) ? (t.density as Density) : DEFAULT_THEME.density,
    scheme: (SCHEMES as readonly unknown[]).includes(t.scheme) ? (t.scheme as Scheme) : DEFAULT_THEME.scheme,
    motion: (MOTIONS as readonly unknown[]).includes(t.motion) ? (t.motion as Motion) : LOOKS[look].motion ?? DEFAULT_THEME.motion,
    look,
    tokens,
  };
}

/** The theme as applied, for a device in dark mode or not, at a part of the day (the sky at a place's head follows it). */
export function tokensOf(theme: Theme, systemDark: boolean, hour: Hour = "midday"): Tokens {
  const dark = theme.scheme === "dark" || (theme.scheme === "system" && systemDark);
  const look = LOOKS[theme.look] ?? LOOKS[DEFAULT_LOOK];
  const skies = dark ? look.darkSkies : look.skies;
  const sky = skies ? { "sky-top": skies[hour][0], "sky-mid": skies[hour][1], "sky-foot": skies[hour][2] } : {};
  const style = { ...look.style, ...(dark ? look.darkStyle : {}), ...sky, ...theme.tokens };
  return { ...(dark ? theme.dark : theme.colors), ...theme.fonts, ...DENSITY[theme.density], ...style, scheme: dark ? "dark" : "light", density: theme.density, motion: theme.motion, look: theme.look, hour };
}

/** The type scale: every text size the app and applets use, a step each, as a multiple of the body size (`--size`,
 *  which density sets). Each is the CSS variable `--fs-<step>`: the one big line of a screen (Home's greeting), a page's title, a heading, a row's or a note's lead
 *  text, the body, a line under a row, and a small capital label. Applets size text only with these
 *  (src/kit/conformance.ts), so the same thing is the same size in every applet. */
export const TYPE_SCALE = { display: 2.6, title: 2, head: 1.35, lead: 1.12, body: 1, small: 0.875, label: 0.75 } as const;
export type TypeStep = keyof typeof TYPE_SCALE;
/** The scale as CSS declarations, each on `--size` so a density (or a theme) moves them all. */
export const TYPE_SCALE_CSS = (Object.entries(TYPE_SCALE) as [TypeStep, number][]).map(([k, v]) => `--fs-${k}:calc(var(--size) * ${v});`).join("");

/** How things move: three curves and four times, the CSS variables `--ease-<name>` and `--t-<name>`. The kit's parts
 *  move only on these (src/kit/parts.css), and applets too (src/kit/conformance.ts), so everything moves alike.
 *    ease-out     things arriving or leaving: fast at first, settling slowly
 *    ease-in-out  something moving from one place on screen to another
 *    ease-drawer  a sheet rising from the foot of the screen, and going back
 *    t-press      a button giving under the finger
 *    t-state      a part arriving, or changing state; a page's arrival (every navigation stays within 250 ms)
 *    t-sheet      a sheet or a toast arriving (leaving takes four fifths of it)
 *    t-step       a step between one part and the next, for an applet's own group arriving (the kit's parts arrive together)
 *    t-turn       a page turned by an arrow (a swipe follows the finger instead), on ease-drawer
 *    t-swap       one room giving way to another in place: the old fades out over the new (docs/LOOK.md)
 *  With the device's reduce-motion setting, on a screen slow to redraw (e-ink), or with a theme whose `motion` is
 *  `still`, every time is 0: nothing moves. */
export const MOTION = {
  "ease-out": "cubic-bezier(0.23, 1, 0.32, 1)", "ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)", "ease-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
  "t-press": "160ms", "t-state": "200ms", "t-sheet": "300ms", "t-step": "40ms", "t-turn": "240ms", "t-swap": "150ms",
} as const;
const TIMES = (Object.keys(MOTION) as (keyof typeof MOTION)[]).filter((k) => k.startsWith("t-"));
const STILL = TIMES.map((k) => `--${k}:0ms;`).join("");
/** The motion as CSS, in full: the values, nothing moving under reduce-motion, on a slow screen, or with `data-motion="still"` on the root (which
 *  the shell and the frame set from the theme). The shell's document and every frame's get it once. */
export const MOTION_CSS = `:root{${Object.entries(MOTION).map(([k, v]) => `--${k}:${v};`).join("")}}`
  + `@media (prefers-reduced-motion: reduce),(update: slow){:root{${STILL}}}:root[data-motion="still"]{${STILL}}`;

/** The tokens as CSS declarations for `:root` (values are already held to the grammar above), and the type scale. A still
 *  theme is still from the first paint (before the frame hears the theme and marks its root), until a theme that
 *  flows marks it so. */
export const cssOf = (t: Tokens): string => `:root{${TOKEN_KEYS.map((k) => `--${k}:${t[k]};`).join("")}${TYPE_SCALE_CSS}color-scheme:${t.scheme};}`
  + `${MOTION_CSS}${t.motion === "still" ? `:root:not([data-motion="flowing"]){${STILL}}` : ""}`;

/** A theme record as written back on a change: a font stack an earlier app wrote (EARLIER_FONTS) becomes today's, and a
 *  paper theme's colour that was only paper's before the sky (EARLIER_PAPER) goes, so the note says what the app shows;
 *  the rest is as it was. */
export function withTodays(raw: Record<string, unknown>): Record<string, unknown> {
  let out = raw;
  if (plain(raw.fonts)) {
    const fonts: Record<string, unknown> = { ...raw.fonts };
    for (const k of FONT_KEYS) if (typeof fonts[k] === "string" && EARLIER_FONTS[k]?.includes((fonts[k] as string).trim())) fonts[k] = DEFAULT_THEME.fonts[k];
    out = { ...out, fonts };
  }
  const look = (LOOK_NAMES as readonly unknown[]).includes(raw.look) ? raw.look : DEFAULT_LOOK;
  if (look === "paper") for (const which of ["colors", "dark"] as const) {
    const given = out[which];
    if (!plain(given)) continue;
    const kept = Object.fromEntries(Object.entries(given).filter(([k, v]) => !(typeof v === "string" && k in EARLIER_PAPER[which] && v.trim().toLowerCase() === EARLIER_PAPER[which][k as ColorKey].toLowerCase())));
    const { [which]: _gone, ...rest } = out;
    out = Object.keys(kept).length ? { ...rest, [which]: kept } : rest;
  }
  return out;
}

/** The record a person starts from ("Make this mine"): the built-in theme, written out in full so every value is there to change. */
export const recordOf = (theme: Theme) => ({ colors: { ...theme.colors }, dark: { ...theme.dark }, fonts: { ...theme.fonts }, density: theme.density, scheme: theme.scheme, motion: theme.motion, look: theme.look, tokens: { ...theme.tokens } });

/** A record moved to another look: the colours it holds that are only the old look's own (not changed by the person) go,
 *  so the new look's palettes show; a colour the person chose stays over it. */
export function withLook(raw: Record<string, unknown>, look: LookName): Record<string, unknown> {
  const was = LOOKS[(LOOK_NAMES as readonly unknown[]).includes(raw.look) ? (raw.look as LookName) : DEFAULT_LOOK];
  const own = (given: unknown, base: Palette) => {
    if (!plain(given)) return undefined;
    const kept = Object.fromEntries(Object.entries(given).filter(([k, v]) => !(k in base) || typeof v !== "string" || v.trim().toLowerCase() !== base[k as ColorKey].toLowerCase()));
    return Object.keys(kept).length ? kept : undefined;
  };
  const { colors, dark, ...rest } = raw;
  const c = own(colors, was.colors), d = own(dark, was.dark);
  return { ...rest, ...(c ? { colors: c } : {}), ...(d ? { dark: d } : {}), look };
}
