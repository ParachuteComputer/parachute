// Imports: a TSX/JSX applet may import a component inline, `import Events from "component:events"`, when it comes from
// the applet's own vault, a vault of the person's, or one this device trusts (vault/whose.ts, docs/design/EMBED.md). The imported code
// runs inside the applet and sees what it sees, so the applet's code hash covers it: with imports, the hash is of the
// source and each import's id and hash; without, it is what it always was (no grant made before changes). Pure.

import { sha256Hex } from "./needs.ts";

export const IMPORT_PREFIX = "component:";
export const MAX_IMPORTS = 8;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The component ids a module imports (`from "component:<id>"`, or a bare `import "component:<id>"`), each once. Comments
 *  are not imports. A specifier that isn't a plain id is returned as is, for the caller to refuse. */
export function importsOf(code: string): string[] {
  const out: string[] = [];
  for (const spec of stringsAfter(code, String.raw`\bfrom\s*|\bimport\s*\(?\s*`)) {
    if (spec.startsWith(IMPORT_PREFIX) && !out.includes(spec.slice(IMPORT_PREFIX.length))) out.push(spec.slice(IMPORT_PREFIX.length));
  }
  return out;
}

/** Each quoted string (not a template) that follows `prefix` (a regex source), in order. One pass over comments and
 *  strings, so a string inside a comment or another string is never read. Also src/applet/check.ts: `require(`. */
export function stringsAfter(code: string, prefix: string): string[] {
  const out: string[] = [];
  const token = new RegExp(String.raw`(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(${prefix})?("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60)`, "g");
  for (const m of code.matchAll(token)) {
    if (m[1] || !m[2] || m[3][0] === "`") continue;
    out.push(m[3].slice(1, -1));
  }
  return out;
}
export const plainImportId = (id: string) => id.length <= 40 && ID.test(id);

/** The code hash of an applet with what it imports: `<kind>:` + SHA-256 of its source and each `id=hash`, sorted. */
export async function compositeHash(kind: "tsx" | "jsx", source: string, imports: { id: string; hash: string }[]): Promise<string> {
  const lines = imports.map((i) => `${i.id}=${i.hash}`).sort();
  return `${kind}:${await sha256Hex(`${source}\n\u0000imports\n${lines.join("\n")}`)}`;
}
