// How Journal and Home name an entry (applets/journal.tsx, applets/today.tsx `entryWords`): the two copies are the same,
// and the rule gives a name that reads as the start of what was written.
import { readFileSync } from "node:fs";
import { transform } from "sucrase";
import { describe, expect, it } from "vitest";

const copy = (file: string) => {
  const src = readFileSync(`${process.cwd()}/applets/${file}`, "utf8");
  const start = src.indexOf("function entryWords(");
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
const entryWords = new Function(`${transform(copy("journal.tsx"), { transforms: ["typescript"] }).code}; return entryWords;`)() as (t: string) => string;

describe("an entry's name", () => {
  it("is the same rule in Journal and Home", () => expect(copy("today.tsx")).toBe(copy("journal.tsx")));
  it.each([
    ["Walked to the bakery. The new rye is good.", "Walked to the bakery"],
    ["How was today? Good. Walked a lot", "How was today"],
    ["Planted garlic in the north bed and the south bed", "Planted garlic in the north bed"],
    ["Dr. Lee called about the results", "Dr. Lee called about the results"],
    ["Met J. at the cafe", "Met J. at the cafe"],
    ["1. Called mom 2. Groceries", "1. Called mom 2. Groceries"],
    ["Went to the U.S. embassy today", "Went to the U.S. embassy today"],
    ["I ate at 7 p.m. then slept", "I ate at 7 p.m. then"],
    ["Ran 3.5 km today.", "Ran 3.5 km today"],
    ["!!! Got the job", "!!! Got the job"],
    ["... and then it rained", "... and then it rained"],
    ["? What happened today", "What happened today"],
    ["#\nText", "Text"],
    ["***\nWalked", "Walked"],
    ["Groceries\nmilk eggs bread", "Groceries"],
    ["Hmm… not sure about this", "Hmm"],
    ["!!!", "Entry"],
    ["", "Entry"],
  ])("%j → %j", (text, name) => expect(entryWords(text)).toBe(name));
  it("is cut at 48 characters, never inside one", () => {
    const n = entryWords(`${"a".repeat(47)}🎉 x`);
    expect(Array.from(n).length).toBeLessThanOrEqual(48);
    expect(n).not.toMatch(/[\ud800-\udbff]$/);
  });
});
