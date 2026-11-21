// The kit's cascade layers (base.css, docs/THEME.md "The order of styles"): the order is said once per document by the
// first sheet that names a layer, and a frame's sheets arrive in no fixed order (a kit's script adds the note renderer's
// before the head's own), so every sheet that puts rules in a layer starts by saying the whole order, the same each time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYERS } from "./frameCss";

const SHEETS = ["src/kit/base.css", "src/kit/parts.css", "src/styles.css", "packages/surface-render/styles.css", "packages/surface-render/rich-notes-kit.css"];
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the kit's layers", () => {
  it.each(SHEETS)("%s says the whole order before its first layer block", (f) => {
    const css = strip(read(f));
    const order = css.indexOf(LAYERS);
    const block = css.search(/@layer\s+[\w.]+\s*\{/);
    expect(order).toBeGreaterThanOrEqual(0);
    expect(block).toBeGreaterThan(order);
    // nothing before the order: a rule there would be outside every layer, over every part
    expect(css.slice(0, order).trim()).toBe("");
  });
  it("frameHead says the order first, and the kit's sheets carry no '<' (they go inside a <style>)", async () => {
    const { frameHead } = await import("./frameCss");
    const head = frameHead(":root{--bg:#fff;}");
    expect(head.indexOf(LAYERS)).toBe("<style>".length);
    for (const f of ["src/kit/base.css", "src/kit/parts.css"]) expect(read(f)).not.toContain("<");
  });
});
