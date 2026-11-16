import { describe, expect, it } from "vitest";
import { cssOf, DEFAULT_THEME, isColor, isFontStack, recordOf, themeFrom, TOKEN_KEYS, tokensOf } from "./theme";

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
