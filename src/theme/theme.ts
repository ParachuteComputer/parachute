// The look: one theme, a record the person (or their agent) can change, that the shell, the frame and every applet
// follow (docs/THEME.md). Pure: the record's metadata in, tokens out.
//
//   the record    `Parachute/Theme` in the home vault, tagged `parachute-theme`. Its metadata `theme`:
//                   colors:  { bg, surface, text, muted, line, accent, danger }   the light palette
//                   dark:    { …the same keys }                                   the dark palette
//                   fonts:   { serif, sans, mono }                                font stacks, by name
//                   density: compact | regular | roomy
//                   scheme:  system | light | dark          which palette shows (system: the device's choice)
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
export type ColorKey = (typeof COLOR_KEYS)[number];
export type FontKey = (typeof FONT_KEYS)[number];
export type Density = (typeof DENSITIES)[number];
export type Scheme = (typeof SCHEMES)[number];
export type Palette = Record<ColorKey, string>;
export type Theme = { colors: Palette; dark: Palette; fonts: Record<FontKey, string>; density: Density; scheme: Scheme };

/** What density sets: padding, the gap between parts, corner radius, the body text size, and its line height. */
export const DENSITY_KEYS = ["pad", "gap", "radius", "size", "leading"] as const;
export type DensityKey = (typeof DENSITY_KEYS)[number];
export const DENSITY: Record<Density, Record<DensityKey, string>> = {
  compact: { pad: "10px", gap: "10px", radius: "8px", size: "15px", leading: "1.4" },
  regular: { pad: "14px", gap: "14px", radius: "10px", size: "16px", leading: "1.45" },
  roomy: { pad: "20px", gap: "18px", radius: "12px", size: "17px", leading: "1.55" },
};

/** The built-in theme: paper, ink and one moss accent; a book serif and a quiet sans (design/WHY.md, design/kit/WHY.md). */
export const DEFAULT_THEME: Theme = {
  colors: { bg: "#f2ede2", surface: "#fbf8f1", text: "#1d1a16", muted: "#6d665a", line: "#d9d1c1", accent: "#4f6b3a", danger: "#9a3324" },
  dark: { bg: "#171613", surface: "#201e1a", text: "#ece7dc", muted: "#a59d8e", line: "#3a362f", accent: "#a3bf8a", danger: "#f08f7f" },
  fonts: {
    serif: `"Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif`,
    sans: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`,
    mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  },
  density: "regular",
  scheme: "system",
};

/** Every token, as the CSS variable `--<key>` and as a key of the object applets get. One list, used everywhere. */
export const TOKEN_KEYS = [...COLOR_KEYS, ...FONT_KEYS, ...DENSITY_KEYS] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
/** The look as applied: every token's value, which palette shows, and the density by name. */
export type Tokens = Record<TokenKey, string> & { scheme: "light" | "dark"; density: Density };

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg|turn|rad)?`;
const FN = new RegExp(String.raw`^(?:rgba?|hsla?|oklch|oklab)\(\s*${NUM}(?:\s*[,/]?\s*${NUM}){1,3}\s*\)$`, "i");
/** A colour this reads: hex (3, 4, 6 or 8 digits), or rgb/hsl/oklch/oklab with numbers only. */
export const isColor = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || FN.test(v));
const FAMILY = /^\s*(?:"[A-Za-z0-9 -]{1,60}"|'[A-Za-z0-9 -]{1,60}'|[A-Za-z][A-Za-z0-9 -]{0,60})\s*$/;
/** A font stack this reads: family names (quoted or bare), separated by commas. */
export const isFontStack = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300 && v.split(",").length <= 12 && v.split(",").every((f) => FAMILY.test(f));

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
  if (plain(t.fonts)) for (const k of FONT_KEYS) if (isFontStack(t.fonts[k])) fonts[k] = (t.fonts[k] as string).trim();
  return {
    colors: palette(t.colors, DEFAULT_THEME.colors),
    dark: palette(t.dark, DEFAULT_THEME.dark),
    fonts,
    density: (DENSITIES as readonly unknown[]).includes(t.density) ? (t.density as Density) : DEFAULT_THEME.density,
    scheme: (SCHEMES as readonly unknown[]).includes(t.scheme) ? (t.scheme as Scheme) : DEFAULT_THEME.scheme,
  };
}

/** The theme as applied, for a device in dark mode or not. */
export function tokensOf(theme: Theme, systemDark: boolean): Tokens {
  const dark = theme.scheme === "dark" || (theme.scheme === "system" && systemDark);
  return { ...(dark ? theme.dark : theme.colors), ...theme.fonts, ...DENSITY[theme.density], scheme: dark ? "dark" : "light", density: theme.density };
}

/** The tokens as CSS declarations for `:root` (values are already held to the grammar above). */
export const cssOf = (t: Tokens): string => `:root{${TOKEN_KEYS.map((k) => `--${k}:${t[k]};`).join("")}color-scheme:${t.scheme};}`;

/** The record a person starts from ("Make this mine"): the built-in theme, written out in full so every value is there to change. */
export const recordOf = (theme: Theme) => ({ colors: { ...theme.colors }, dark: { ...theme.dark }, fonts: { ...theme.fonts }, density: theme.density, scheme: theme.scheme });
