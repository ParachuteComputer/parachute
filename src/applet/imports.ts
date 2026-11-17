// Imports: a TSX/JSX applet may import a component inline, `import Events from "component:events"`, when it comes from
// the applet's own vault or from a Parachute this device trusts (trust.ts, docs/design/EMBED.md). The imported code
// runs inside the applet and sees what it sees, so the applet's code hash covers it: with imports, the hash is of the
// source and each import's id and hash; without, it is what it always was (no grant made before changes). Pure.

import { sha256Hex } from "./needs.ts";

export const IMPORT_PREFIX = "component:";
export const MAX_IMPORTS = 8;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The component ids a module imports (`from "component:<id>"`, or a bare `import "component:<id>"`), each once. Comments
 *  are not imports. A specifier that isn't a plain id is returned as is, for the caller to refuse. */
export function importsOf(code: string): string[] {
  // one pass over comments and strings, in order, so a string inside a comment or another string is never read
  const out: string[] = [];
  const token = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(\bfrom\s*|\bimport\s*\(?\s*)?("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/g;
  for (const m of code.matchAll(token)) {
    if (m[1] || !m[2] || m[3][0] === "`") continue;
    const spec = m[3].slice(1, -1);
    if (spec.startsWith(IMPORT_PREFIX) && !out.includes(spec.slice(IMPORT_PREFIX.length))) out.push(spec.slice(IMPORT_PREFIX.length));
  }
  return out;
}
export const plainImportId = (id: string) => id.length <= 40 && ID.test(id);

/** The code hash of an applet with what it imports: `<kind>:` + SHA-256 of its source and each `id=hash`, sorted. */
export async function compositeHash(kind: "tsx" | "jsx", source: string, imports: { id: string; hash: string }[]): Promise<string> {
  const lines = imports.map((i) => `${i.id}=${i.hash}`).sort();
  return `${kind}:${await sha256Hex(`${source}\n\u0000imports\n${lines.join("\n")}`)}`;
}
