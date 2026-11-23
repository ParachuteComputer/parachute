// The Languages applet's pure block (applets/languages.tsx, between its "pure" markers), compiled as written, for the
// tests: the scheduler, the scripts and the cards are tested in the code that runs, not in a copy of it.
/// <reference path="../../applets/parachute.d.ts" />
import { readFileSync } from "node:fs";
import { transform } from "sucrase";

type Applet = typeof import("../../applets/languages.tsx");
const src = readFileSync(`${process.cwd()}/applets/languages.tsx`, "utf8");
const start = src.indexOf("// ── pure ──"), end = src.indexOf("// ── end pure ──");
if (start < 0 || end < start) throw new Error("applets/languages.tsx has lost its pure markers");
const code = transform(src.slice(start, end).replace(/^export /gm, ""), { transforms: ["typescript"] }).code;
const names = [...src.slice(start, end).matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
export const L = new Function(`${code}\nreturn { ${names.join(", ")} };`)() as Omit<Applet, "default">;
