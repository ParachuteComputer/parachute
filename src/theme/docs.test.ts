// The docs say what the code does: the token names an applet can use, and the example record, which must read back as
// exactly what it says.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DENSITIES, SCHEMES, themeFrom, TOKEN_KEYS } from "./theme";

const doc = (name: string) => readFileSync(join(process.cwd(), "docs", name), "utf8");
const varsIn = (text: string) => [...new Set([...text.matchAll(/`--([a-z]+)`/g)].map((m) => m[1]))];

describe("docs/THEME.md", () => {
  const theme = doc("THEME.md");
  it("names every token an applet gets, and no other", () => {
    expect(varsIn(theme.slice(theme.indexOf("## In an applet"))).sort()).toEqual([...TOKEN_KEYS].sort());
  });
  it("its example record is read as written, value for value", () => {
    const example = JSON.parse(theme.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(themeFrom({ theme: example })).toEqual(example);
  });
  it("lists the densities and schemes the code reads", () => {
    for (const d of DENSITIES) expect(theme).toContain(`\`${d}\``);
    for (const s of SCHEMES) expect(theme).toContain(`\`${s}\``);
  });
});

describe("docs/WRITE-AN-APPLET.md", () => {
  it("names every token in the kit's theme row", () => {
    const row = doc("WRITE-AN-APPLET.md").split("\n").find((l) => l.startsWith("| `theme.get()`"))!;
    expect(varsIn(row).sort()).toEqual([...TOKEN_KEYS].sort());
  });
});
