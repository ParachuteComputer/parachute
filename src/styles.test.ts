// @vitest-environment node
// The app's stylesheets parse cleanly: a stray brace closes a layer early, and every rule after it then beats the
// layered ones whatever their specificity (T-476, caught in review of the Mac sidebar).
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

describe("the stylesheets", () => {
  for (const f of ["src/styles.css", "src/kit/base.css", "src/kit/parts.css"]) it(`${f} parses with no warnings`, () => {
    expect(transformSync(readFileSync(f, "utf8"), { loader: "css" }).warnings.map((w) => `${w.location?.line}: ${w.text}`)).toEqual([]);
  });
});
