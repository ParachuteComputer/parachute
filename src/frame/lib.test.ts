// The frame guide names what a frame may import: every part it lists is really there, and the imports it names are
// the ones the frame's loader serves.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as lib from "./lib";
import { FRAME_IMPORTS } from "../shell/frameDoc";

const guide = readFileSync(`${process.cwd()}/docs/CHANGE-YOUR-FRAME.md`, "utf8");

describe("docs/CHANGE-YOUR-FRAME.md", () => {
  it("lists only parts @parachute/frame has", () => {
    const rows = guide.split("\n").filter((l) => l.startsWith("| `") && !l.includes("| `path`") && !l.includes("| `extension`") && !l.includes("| `tags`") && !l.includes("| `metadata") && !l.includes("| `content`"));
    const names = rows.flatMap((r) => [...r.split("|")[1].matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]));
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(lib, n).toHaveProperty(n);
  });
  it("names the imports the loader serves", () => {
    for (const m of FRAME_IMPORTS) expect(guide).toContain(`\`${m}\``);
  });
});
