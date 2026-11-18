// The applets this repo ships link only through the kit (Link, Linked, Note, `link`): none draws its own <a>, opens an
// address itself or calls the shell's link calls, so a note link works, and is checked, the same way in each.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "applets");
const shipped = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));
/** The code without its comments (a comment may name a call). */
const code = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("the shipped applets link through the kit", () => {
  it("there are applets to check", () => expect(shipped.length).toBeGreaterThan(3));
  it.each(shipped)("%s draws no link of its own and opens nothing itself", (f) => {
    const src = code(f);
    expect(src, "an <a> of its own").not.toMatch(/<a[\s>]/);
    expect(src, "an href of its own").not.toMatch(/\bhref=/);
    expect(src, "the shell's link calls, not the kit's parts").not.toMatch(/\bapp\s*\.\s*(open|openLink|follow|links|address)\s*\(/);
    expect(src, "the frame moved").not.toMatch(/\b(window\.open|location\s*\.\s*(href|assign|replace))\b/);
  });
  it("Room draws Uni's note links with the kit, in its markdown", () => {
    const src = code("room.tsx");
    expect(src).toMatch(/import \{[^}]*\bLink\b[^}]*\} from "parachute"/);
    expect(src).toMatch(/<Linked\b/);
  });
});
