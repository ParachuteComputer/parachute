import { describe, expect, it } from "vitest";
import { cssOf, DEFAULT_LOOK, onScreen, DEFAULT_THEME, isColor, isFontStack, LOOKS, MOTION, recordOf, STYLE_KEYS, styleValue, themeFrom, TOKEN_KEYS, tokensOf, withLook, withTodays, hourOf, HOURS, type Hour, type StyleKey, type Theme } from "./theme";

describe("the theme record", () => {
  it("absent, or not a record, is the built-in theme", () => {
    for (const m of [undefined, null, {}, { theme: "red" }, { theme: [] }]) expect(themeFrom(m)).toEqual(DEFAULT_THEME);
  });

  it("a partial record changes only what it gives", () => {
    const t = themeFrom({ theme: { colors: { accent: "#2f5470" }, density: "roomy" } });
    expect(t.colors).toEqual({ ...DEFAULT_THEME.colors, accent: "#2f5470" });
    expect(t.dark).toEqual(DEFAULT_THEME.dark);
    expect(t.density).toBe("roomy");
    expect(t.fonts).toEqual(DEFAULT_THEME.fonts);
  });

  it("a value that doesn't read is the built-in value, and the rest stand", () => {
    const t = themeFrom({ theme: { colors: { accent: "url(https://x.example/a.png)", bg: "#eceee9" }, fonts: { serif: "x;}body{display:none" }, density: "huge", scheme: "sepia" } });
    expect(t.colors.accent).toBe(DEFAULT_THEME.colors.accent);
    expect(t.colors.bg).toBe("#eceee9");
    expect(t.fonts.serif).toBe(DEFAULT_THEME.fonts.serif);
    expect(t.density).toBe("regular");
    expect(t.scheme).toBe("system");
  });

  it("what the person starts from reads back as the built-in theme", () => {
    expect(themeFrom({ theme: recordOf(DEFAULT_THEME) })).toEqual(DEFAULT_THEME);
  });

  it("the system stacks an earlier app wrote into a theme in full read as today's faces; a font chosen stands", () => {
    const earlier = { serif: `"Iowan Old Style", "Palatino Linotype", Palatino, "Noto Serif", Georgia, serif`, sans: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`, mono: "ui-monospace, monospace" };
    const t = themeFrom({ theme: { fonts: earlier } });
    expect(t.fonts.serif).toBe(DEFAULT_THEME.fonts.serif);
    expect(t.fonts.sans).toBe(DEFAULT_THEME.fonts.sans);
    expect(t.fonts.serif.startsWith(`"Literata"`)).toBe(true);
    expect(t.fonts.mono).toBe("ui-monospace, monospace");
    expect(themeFrom({ theme: { fonts: { serif: `"Iowan Old Style", Georgia, serif` } } }).fonts.serif).toBe(`"Iowan Old Style", Georgia, serif`);
    // and a change writes today's stacks back, leaving a chosen one and everything else as it was
    const back = withTodays({ density: "roomy", fonts: { ...earlier, sans: "Inter, sans-serif" } });
    expect(back).toEqual({ density: "roomy", fonts: { serif: DEFAULT_THEME.fonts.serif, sans: "Inter, sans-serif", mono: "ui-monospace, monospace" } });
  });
});

describe("the grammar (values end up in CSS the shell, the frame and applets apply)", () => {
  it("reads colours as hex or rgb/hsl/oklch/oklab of numbers", () => {
    for (const c of ["#abc", "#abcd", "#a1b2c3", "#a1b2c3d4", "rgb(10, 20, 30)", "rgb(10 20 30 / 50%)", "rgba(1,2,3,.5)", "hsl(120deg 30% 40%)", "oklch(0.6 0.1 140)", "oklab(0.5 -0.1 0.1)"]) expect(isColor(c), c).toBe(true);
  });

  it("refuses anything that could load a URL, reach another value, or break out", () => {
    for (const c of ["red", "url(x)", "var(--x)", "rgb(var(--a),1,2)", "#abcde", "#12345g", "rgb(1,2,3);}x{", "image-set(\"a.png\" 1x)", "attr(x)", "expression(alert(1))", "#fff;", "", 7, null, "rgb(1)", "rgb(1,2,3,4,5)"]) expect(isColor(c), String(c)).toBe(false);
  });

  it("answers at once on a value built to be slow (it is read at every start)", () => {
    for (const v of ["rgb(" + "1".repeat(59) + "x", "hsl(" + "1.".repeat(29) + "x", "oklch(" + "1 ".repeat(28) + "/", "rgb(" + "1,".repeat(29) + ")"]) {
      const t = performance.now();
      expect(isColor(v)).toBe(false);
      expect(performance.now() - t, v).toBeLessThan(50);
    }
    const t = performance.now();
    isFontStack(Array.from({ length: 12 }, () => " a".repeat(24)).join(","));
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("reads font stacks as family names only", () => {
    for (const k of ["serif", "sans", "mono"] as const) expect(isFontStack(DEFAULT_THEME.fonts[k]), k).toBe(true);
    expect(themeFrom({ theme: { fonts: { sans: `Inter, ${DEFAULT_THEME.fonts.sans}` } } }).fonts.sans).toBe(`Inter, ${DEFAULT_THEME.fonts.sans}`);
    expect(isFontStack(`"EB Garamond", Georgia, serif`)).toBe(true);
    for (const f of [`x;}body{color:red`, `url(a.woff)`, `"unclosed, serif`, `a</style>`, `var(--x)`, "", `"a\\" b"`]) expect(isFontStack(f), f).toBe(false);
  });
});

describe("tokens", () => {
  it("follow the device's scheme unless the record names one", () => {
    expect(tokensOf(DEFAULT_THEME, false).bg).toBe(DEFAULT_THEME.colors.bg);
    expect(tokensOf(DEFAULT_THEME, true).bg).toBe(DEFAULT_THEME.dark.bg);
    expect(tokensOf({ ...DEFAULT_THEME, scheme: "light" }, true).scheme).toBe("light");
    expect(tokensOf({ ...DEFAULT_THEME, scheme: "dark" }, false).bg).toBe(DEFAULT_THEME.dark.bg);
  });

  it("give every token a value, and the CSS names each as --key", () => {
    const t = tokensOf(themeFrom({ theme: { density: "compact" } }), false);
    for (const k of TOKEN_KEYS) expect(t[k], k).toBeTruthy();
    expect(t.pad).toBe("10px");
    const css = cssOf(t);
    for (const k of TOKEN_KEYS) expect(css).toContain(`--${k}:${t[k]};`);
    expect(css).not.toMatch(/[<>]/);
  });
});

describe("motion (docs/DESIGN-RULES.md)", () => {
  it("flows unless the record says still; anything else it says is the built-in", () => {
    expect(DEFAULT_THEME.motion).toBe("flowing");
    expect(themeFrom({ theme: { motion: "still" } }).motion).toBe("still");
    for (const m of ["bouncy", "", 0, null, ["still"]]) expect(themeFrom({ theme: { motion: m } }).motion, String(m)).toBe("flowing");
    expect(tokensOf(themeFrom({ theme: { motion: "still" } }), false).motion).toBe("still");
  });

  it("every frame gets the curves and times, all 0 under reduce-motion or a still mark", () => {
    const css = cssOf(tokensOf(DEFAULT_THEME, false));
    for (const [k, v] of Object.entries(MOTION)) expect(css).toContain(`--${k}:${v};`);
    expect(css).toContain(`@media (prefers-reduced-motion: reduce),(update: slow){:root{--t-press:0ms;--t-state:0ms;--t-sheet:0ms;--t-step:0ms;--t-turn:0ms;--t-swap:0ms;}}`);
    expect(css).toContain(`:root[data-motion="still"]{--t-press:0ms;`);
    // flowing: nothing stills it but the device or the mark
    expect(css).not.toContain(`:root:not([data-motion="flowing"])`);
    expect(css).not.toMatch(/[<>]/);
  });

  it("a still theme is still from a frame's first paint, until the frame is told it flows", () => {
    const css = cssOf(tokensOf(themeFrom({ theme: { motion: "still" } }), false));
    expect(css).toContain(`:root:not([data-motion="flowing"]){--t-press:0ms;--t-state:0ms;--t-sheet:0ms;--t-step:0ms;--t-turn:0ms;--t-swap:0ms;}`);
  });

  it("no time a part arrives in, its steps included, passes 250 ms", () => {
    const ms = (k: keyof typeof MOTION) => parseInt(MOTION[k], 10);
    expect(ms("t-state") + ms("t-step")).toBeLessThanOrEqual(250);
    expect(ms("t-press")).toBeLessThanOrEqual(200);
    // moving between places and pages (docs/LOOK.md): a turn, a room giving way to another
    expect(ms("t-turn")).toBeLessThanOrEqual(250);
    expect(ms("t-swap")).toBeLessThanOrEqual(150);
  });
});

describe("looks and style tokens (theme.ts STYLE_TOKENS, LOOKS)", () => {
  it("every look gives every style token a value, and the built-in theme is the default look's", () => {
    for (const [name, look] of Object.entries(LOOKS)) expect(Object.keys(look.style).sort(), name).toEqual([...STYLE_KEYS].sort());
    expect(DEFAULT_THEME.colors).toEqual(LOOKS[DEFAULT_LOOK].colors);
    expect(tokensOf(DEFAULT_THEME, false)["line-row"]).toBe(LOOKS[DEFAULT_LOOK].style["line-row"]);
  });

  it("a record's look sets the palettes and the style; its own colours and tokens stand over them", () => {
    const t = themeFrom({ theme: { look: "daylight", colors: { accent: "#2f5470" }, tokens: { "radius-card": "14px", "line-row": "1px dashed var(--muted)" } } });
    const k = tokensOf(t, false);
    expect(k.bg).toBe("#ffffff");
    expect(k.accent).toBe("#2f5470");
    expect(k["line-card"]).toBe(LOOKS.daylight.style["line-card"]);
    expect(k["radius-card"]).toBe("14px");
    expect(k["line-row"]).toBe("1px dashed var(--muted)");
    expect(t.motion).toBe("still"); // daylight's, unless the record says
    expect(themeFrom({ theme: { look: "daylight", motion: "flowing" } }).motion).toBe("flowing");
    expect(themeFrom({ theme: { look: "sepia" } }).look).toBe(DEFAULT_LOOK);
  });

  it("the dark palette brings the look's dark style values", () => {
    const k = tokensOf(themeFrom({ theme: { look: "paper" } }), true);
    expect(k["shadow-card"]).toBe(LOOKS.paper.darkStyle!["shadow-card"]);
    expect(k.bg).toBe(LOOKS.paper.dark.bg);
  });

  it("holds a record's style tokens to their kind's grammar: nothing loads, reaches another value or breaks out", () => {
    const ok: [StyleKey, string][] = [["primary", "#2f5470"], ["primary", "var(--accent)"], ["card-fill", "transparent"], ["line-row", "1px dotted var(--muted)"], ["line-head", "3px double #000"],
      ["card-edges", "1px 0 0"], ["field-pad", "8px 12px"], ["radius-card", "14px"], ["radius-button", "999px"], ["measure", "60rem"], ["shadow-card", "none"],
      ["shadow-card", "0 1px 2px rgb(0 0 0 / .1), 0 10px 30px -12px rgba(60,45,30,.2)"], ["label-transform", "uppercase"], ["label-caps", "all-small-caps"], ["label-track", ".08em"], ["title-weight", "500"]];
    for (const [k, v] of ok) expect(styleValue(k, v), `${k}: ${v}`).toBe(v);
    const bad: [StyleKey, unknown][] = [["primary", "url(x)"], ["primary", "var(--x)"], ["primary", "var(--accent);}body{display:none"], ["line-row", "1px solid url(x)"], ["line-row", "1px groove #000"],
      ["line-row", "1px solid var(--accent) !important"], ["card-edges", "1px 1px 1px 1px 1px"], ["radius-card", "calc(1px + 2px)"], ["radius-card", "14vw"], ["shadow-card", "0 0 4px attr(x)"],
      ["shadow-card", "0 0 1px #000, 0 0 1px #000, 0 0 1px #000, 0 0 1px #000"], ["label-transform", "full-width"], ["label-track", "1em"], ["title-weight", "950"], ["title-weight", 500], ["measure", "x".repeat(300)]];
    for (const [k, v] of bad) expect(styleValue(k, v), `${k}: ${String(v)}`).toBeNull();
    // in a record: what doesn't read is the look's value, the rest stand
    const t = themeFrom({ theme: { tokens: { primary: "url(x)", "radius-card": "6px", nope: "1px" } } });
    expect(t.tokens).toEqual({ "radius-card": "6px" });
  });

  it("moving a record to another look keeps the colours the person chose and drops the old look's own", () => {
    const raw = { ...recordOf(DEFAULT_THEME), colors: { ...LOOKS[DEFAULT_LOOK].colors, accent: "#2f5470" } };
    const moved = withLook(raw, "book");
    expect(moved.look).toBe("book");
    expect(moved.colors).toEqual({ accent: "#2f5470" });
    expect(moved.dark).toBeUndefined();
    const t = themeFrom({ theme: moved });
    expect(t.colors).toEqual({ ...LOOKS.book.colors, accent: "#2f5470" });
    expect(t.density).toBe(DEFAULT_THEME.density);
  });

  it("the CSS a frame gets sets every style token", () => {
    const css = cssOf(tokensOf(themeFrom({ theme: { look: "book" } }), false));
    for (const k of STYLE_KEYS) expect(css).toContain(`--${k}:${LOOKS.book.style[k]};`);
  });
});

describe("this screen's own choice (theme.ts onScreen)", () => {
  it("Daylight on this screen is the Daylight look whatever the note gives; the theme is the note", () => {
    const t = themeFrom({ theme: { look: "book", colors: { accent: "#2f5470" }, tokens: { "radius-card": "14px" } } });
    const k = tokensOf(onScreen(t, "daylight"), false);
    expect(k.bg).toBe(LOOKS.daylight.colors.bg);
    expect(k.accent).toBe(LOOKS.daylight.colors.accent);
    expect(k["radius-card"]).toBe(LOOKS.daylight.style["radius-card"]);
    expect(onScreen(t, "daylight").motion).toBe("still");
    expect(onScreen(t, "theme")).toBe(t);
  });
});

describe("the grammar holds a value to what CSS reads (else it falls back to the look's, as THEME.md says)", () => {
  it("reads a colour written one way throughout: commas, or spaces with an optional / alpha", () => {
    for (const c of ["rgb(1, 2, 3)", "rgba(1,2,3,.5)", "rgb(1 2 3)", "rgb(1 2 3 / 50%)", "oklch(0.6 0.1 140)", "hsl(120deg 30% 40%)"]) expect(isColor(c), c).toBe(true);
    for (const c of ["rgb(1 2)", "rgb(1, 2 3)", "rgb(1/2/3)", "rgb(1 2 3 4)", "rgb(1,2,3,4,5)"]) expect(isColor(c), c).toBe(false);
  });
  it("takes plain spaces between a value's parts, never a no-break or a line separator", () => {
    for (const ws of [" ", " ", "\u000b", "﻿", "　"]) {
      expect(styleValue("line-row", `1px${ws}solid #000`), JSON.stringify(ws)).toBeNull();
      expect(styleValue("field-pad", `8px${ws}12px`), JSON.stringify(ws)).toBeNull();
    }
    expect(styleValue("line-row", "1px solid #000")).toBe("1px solid #000");
  });
  it("an odd space before a colour or after a shadow's comma is refused too (trim takes only plain spaces)", () => {
    expect(styleValue("line-row", "1px solid \u00a0#000")).toBeNull();
    expect(styleValue("shadow-card", "0 0 #000,\u00a00 0 #000")).toBeNull();
    expect(styleValue("shadow-card", "0 0 #000\u2028,0 0 #000")).toBeNull();
    expect(styleValue("shadow-card", "0 0 #000, 0 0 #000")).toBe("0 0 #000, 0 0 #000");
  });
  it("a bare 0 for a length is written 0px (a sheet's max(radius-card, radius) would drop a plain number)", () => {
    expect(styleValue("radius-card", "0")).toBe("0px");
    expect(styleValue("radius-card", "0px")).toBe("0px");
  });
});

describe("the sky at a place's head (docs/LOOK.md)", () => {
  it("follows the part of the day: morning from 5, midday from 11, evening from 16, night from 21", () => {
    const at = (h: number) => hourOf(new Date(2026, 10, 22, h, 30));
    expect([4, 5, 10, 11, 15, 16, 20, 21, 23].map(at)).toEqual(["night", "morning", "morning", "midday", "midday", "evening", "evening", "night", "night"]);
  });
  it("paper gives each part of the day its own sky, light and dark; a look without a sky keeps its ground", () => {
    const skyAt = (t: Theme, dark: boolean, h: Hour) => { const k = tokensOf(t, dark, h); return [k["sky-top"], k["sky-mid"], k["sky-foot"]]; };
    const light = HOURS.map((h) => skyAt(DEFAULT_THEME, false, h).join());
    expect(new Set(light).size).toBe(4);
    expect(skyAt(DEFAULT_THEME, false, "evening")).toEqual(["#e5e2ec", "#f6dccb", "#fbeee3"]);
    expect(skyAt(DEFAULT_THEME, true, "evening")).not.toEqual(skyAt(DEFAULT_THEME, false, "evening"));
    for (const look of ["almanac", "book", "daylight"] as const) for (const h of HOURS) expect(skyAt(themeFrom({ theme: { look } }), false, h)).toEqual(["var(--bg)", "var(--bg)", "var(--bg)"]);
    // a theme's own sky stands at every hour
    const own = themeFrom({ theme: { tokens: { "sky-top": "#123456" } } });
    for (const h of HOURS) expect(tokensOf(own, false, h)["sky-top"]).toBe("#123456");
    expect(tokensOf(DEFAULT_THEME, false, "night").hour).toBe("night");
  });
  it("a paper theme that holds paper's colours from before the sky word for word gets today's; a colour chosen stands", () => {
    const before = { bg: "#f2ede2", surface: "#fbf8f1", text: "#1d1a16", muted: "#6d665a", line: "#d9d1c1", accent: "#4f6b3a", danger: "#9a3324" };
    const darkBefore = { bg: "#171613", surface: "#201e1a", text: "#ece7dc", muted: "#a59d8e", line: "#3a362f", accent: "#a3bf8a", danger: "#f08f7f" };
    expect(themeFrom({ theme: { look: "paper", colors: before, dark: darkBefore } }).colors).toEqual(DEFAULT_THEME.colors);
    expect(themeFrom({ theme: { colors: before } }).colors).toEqual(DEFAULT_THEME.colors);
    const chosen = themeFrom({ theme: { colors: { ...before, accent: "#2f5470" } } });
    expect(chosen.colors).toEqual({ ...DEFAULT_THEME.colors, accent: "#2f5470" });
    // the almanac's own palette is the same colours: there they are the look's, and stay
    expect(themeFrom({ theme: { look: "almanac", colors: before } }).colors).toEqual(before);
    // written back, the old colours go and the chosen one stays
    expect(withTodays({ look: "paper", colors: { ...before, accent: "#2f5470" }, dark: darkBefore })).toEqual({ look: "paper", colors: { accent: "#2f5470" } });
    expect(withTodays({ look: "almanac", colors: before })).toEqual({ look: "almanac", colors: before });
  });
  it("the display face is the theme's fourth stack, Fraunces first", () => {
    expect(DEFAULT_THEME.fonts.display).toMatch(/^"Fraunces"/);
    expect(cssOf(tokensOf(DEFAULT_THEME, false))).toContain("--display:");
    expect(themeFrom({ theme: { fonts: { display: "Georgia, serif" } } }).fonts.display).toBe("Georgia, serif");
  });
});
