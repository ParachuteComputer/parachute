// An applet in this folder as the record a vault keeps (docs/WRITE-AN-APPLET.md): <name>.json holds its path, tags and
// fields, <name>.tsx (or .html) its code. `{{name}}` in the fields is filled from `vars` (a server's address, say); one
// left unfilled is an error, so no applet goes in with a placeholder. Runs under Node (type stripping) and the tests.
import { existsSync, readFileSync } from "node:fs";

export type AppletRecord = { path: string; extension: string; tags: string[]; fields: Record<string, unknown>; body: string };

export function appletRecord(name: string, vars: Record<string, string> = {}): AppletRecord {
  const dir = new URL("./", import.meta.url);
  const meta = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8")) as Omit<AppletRecord, "body">;
  const file = ["tsx", "jsx", "html"].map((e) => new URL(`${name}.${e}`, dir)).find((u) => existsSync(u));
  if (!file) throw new Error(`no code for ${name}`);
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => { if (!(k in vars)) throw new Error(`${name} needs ${k}`); return vars[k]; });
  return { path: meta.path, extension: meta.extension, tags: meta.tags, fields: JSON.parse(fill(JSON.stringify(meta.fields))), body: readFileSync(file, "utf8") };
}
