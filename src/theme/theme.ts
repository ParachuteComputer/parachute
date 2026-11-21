// The look: one theme, a record the person (or their agent) can change, that the shell, the frame and every applet
// follow (docs/THEME.md). Pure: the record's metadata in, tokens out.
//
//   the record    `Parachute/Theme` in the home vault, tagged `parachute-theme`. Its metadata `theme`:
//                   colors:  { bg, surface, text, muted, line, accent, danger }   the light palette
//                   dark:    { …the same keys }                                   the dark palette
//                   fonts:   { serif, sans, mono }                                font stacks, by name
//                   density: compact | regular | roomy
//                   scheme:  system | light | dark          which palette shows (system: the device's choice)
//                   motion:  flowing | still                  whether the parts move (still: nothing does; the device's
//                                                             reduce-motion setting is still too, whatever this says)
//                 Every key is optional: what it leaves out (or gives in a form this reads not) is the built-in value.
//   absent        the built-in theme (DEFAULT_THEME): the same look the app has always had.
//
// Values are held to a strict grammar, because they end up in CSS that the shell, the frame and applets all apply: a
// colour is hex, rgb(), hsl(), oklch() or oklab() with numbers only; a font is a list of family names. Nothing that
// could load a URL (url(), image-set(), @import) or reach another value (var(), attr()) can pass.

export const COLOR_KEYS = ["bg", "surface", "text", "muted", "line", "accent", "danger"] as const;
export const FONT_KEYS = ["serif", "sans", "mono"] as const;
export const DENSITIES = ["compact", "regular", "roomy"] as const;
export const SCHEMES = ["system", "light", "dark"] as const;
export const MOTIONS = ["flowing", "still"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type FontKey = (typeof FONT_KEYS)[number];
export type Density = (typeof DENSITIES)[number];
export type Scheme = (typeof SCHEMES)[number];
export type Motion = (typeof MOTIONS)[number];
export type Palette = Record<ColorKey, string>;
export type Theme = { colors: Palette; dark: Palette; fonts: Record<FontKey, string>; density: Density; scheme: Scheme; motion: Motion };

/** What density sets: padding, the gap between parts, corner radius, the body text size, and its line height. */
export const DENSITY_KEYS = ["pad", "gap", "radius", "size", "leading"] as const;
export type DensityKey = (typeof DENSITY_KEYS)[number];
export const DENSITY: Record<Density, Record<DensityKey, string>> = {
  compact: { pad: "10px", gap: "10px", radius: "8px", size: "15px", leading: "1.4" },
  regular: { pad: "14px", gap: "14px", radius: "10px", size: "16px", leading: "1.45" },
  roomy: { pad: "20px", gap: "18px", radius: "12px", size: "17px", leading: "1.55" },
};

/** The built-in theme: paper, ink and one moss accent; a book serif (Literata) for reading and a quiet sans (Instrument
 *  Sans) for the rest, both carried by the app (fonts.ts), each with a local font sized to it and the old system stacks
 *  behind (design/WHY.md, design/kit/WHY.md). */
export const DEFAULT_THEME: Theme = {
  colors: { bg: "#f2ede2", surface: "#fbf8f1", text: "#1d1a16", muted: "#6d665a", line: "#d9d1c1", accent: "#4f6b3a", danger: "#9a3324" },
  dark: { bg: "#171613", surface: "#201e1a", text: "#ece7dc", muted: "#a59d8e", line: "#3a362f", accent: "#a3bf8a", danger: "#f08f7f" },
  fonts: {
    serif: `"Literata", "Literata fallback", "Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif`,
    sans: `"Instrument Sans", "Instrument Sans fallback", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`,
    mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
  density: "regular",
  scheme: "system",
  motion: "flowing",
};

/** Every token, as the CSS variable `--<key>` and as a key of the object applets get. One list, used everywhere. */
export const TOKEN_KEYS = [...COLOR_KEYS, ...FONT_KEYS, ...DENSITY_KEYS] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
/** The look as applied: every token's value, which palette shows, the density by name, and whether the parts move. */
export type Tokens = Record<TokenKey, string> & { scheme: "light" | "dark"; density: Density; motion: Motion };

// One way to read each number, and a separator required between two (a comma, a slash or a space): a pattern that could
// split a run of digits many ways would take seconds on a hostile value, and this one runs at every start.
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|turn|rad)?`;
const FN = new RegExp(String.raw`^(?:rgba?|hsla?|oklch|oklab)\(\s*${NUM}(?:(?:\s*[,/]\s*|\s+)${NUM}){1,3}\s*\)$`, "i");
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
function palette(given: unknown, base: Palette): Palette {
  const out = { ...base };
  if (plain(given)) for (const k of COLOR_KEYS) if (isColor(given[k])) out[k] = given[k].trim();
  return out;
}

/** The theme a record's metadata gives, over the built-in one. A value that doesn't read is the built-in value; the rest stand. */
export function themeFrom(metadata: unknown): Theme {
  const t = plain(metadata) && plain(metadata.theme) ? metadata.theme : null;
  if (!t) return structuredClone(DEFAULT_THEME);
  const fonts = { ...DEFAULT_THEME.fonts };
  if (plain(t.fonts)) for (const k of FONT_KEYS) if (isFontStack(t.fonts[k]) && !EARLIER_FONTS[k]?.includes((t.fonts[k] as string).trim())) fonts[k] = (t.fonts[k] as string).trim();
  return {
    colors: palette(t.colors, DEFAULT_THEME.colors),
    dark: palette(t.dark, DEFAULT_THEME.dark),
    fonts,
    density: (DENSITIES as readonly unknown[]).includes(t.density) ? (t.density as Density) : DEFAULT_THEME.density,
    scheme: (SCHEMES as readonly unknown[]).includes(t.scheme) ? (t.scheme as Scheme) : DEFAULT_THEME.scheme,
    motion: (MOTIONS as readonly unknown[]).includes(t.motion) ? (t.motion as Motion) : DEFAULT_THEME.motion,
  };
}

/** The theme as applied, for a device in dark mode or not. */
export function tokensOf(theme: Theme, systemDark: boolean): Tokens {
  const dark = theme.scheme === "dark" || (theme.scheme === "system" && systemDark);
  return { ...(dark ? theme.dark : theme.colors), ...theme.fonts, ...DENSITY[theme.density], scheme: dark ? "dark" : "light", density: theme.density, motion: theme.motion };
}

/** The type scale: every text size the app and applets use, a step each, as a multiple of the body size (`--size`,
 *  which density sets). Each is the CSS variable `--fs-<step>`: a page's title, a heading, a row's or a note's lead
 *  text, the body, a line under a row, and a small capital label. Applets size text only with these
 *  (src/kit/conformance.ts), so the same thing is the same size in every applet. */
export const TYPE_SCALE = { title: 2, head: 1.35, lead: 1.12, body: 1, small: 0.875, label: 0.75 } as const;
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
 *  With the device's reduce-motion setting, on a screen slow to redraw (e-ink), or with a theme whose `motion` is
 *  `still`, every time is 0: nothing moves. */
export const MOTION = {
  "ease-out": "cubic-bezier(0.23, 1, 0.32, 1)", "ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)", "ease-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
  "t-press": "160ms", "t-state": "200ms", "t-sheet": "300ms", "t-step": "40ms",
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

/** The record a person starts from ("Make this mine"): the built-in theme, written out in full so every value is there to change. */
export const recordOf = (theme: Theme) => ({ colors: { ...theme.colors }, dark: { ...theme.dark }, fonts: { ...theme.fonts }, density: theme.density, scheme: theme.scheme, motion: theme.motion });
