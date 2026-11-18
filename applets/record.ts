// An applet in this folder as the record a vault keeps (docs/WRITE-AN-APPLET.md): <name>.json holds its path, tags and
// fields, <name>.tsx (or .html) its code. `{{name}}` in the path and fields is filled from `vars` (a server's address,
// say); one left unfilled is an error, so no applet goes in with a placeholder. A component an applet imports
// (`import Room from "component:room"`) is here as <id>.json and <id>.tsx, tagged `component`: `withImports` gives it
// along with the applet, so both go into the vault together. Runs under Node (type stripping) and the tests.
import { existsSync, readFileSync } from "node:fs";
import { importsOf } from "../src/applet/imports.ts";

export type AppletRecord = { path: string; extension: string; tags: string[]; fields: Record<string, unknown>; body: string };

export function appletRecord(name: string, vars: Record<string, string> = {}): AppletRecord {
  const dir = new URL("./", import.meta.url);
  const meta = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8")) as Omit<AppletRecord, "body">;
  const file = ["tsx", "jsx", "html"].map((e) => new URL(`${name}.${e}`, dir)).find((u) => existsSync(u));
  if (!file) throw new Error(`no code for ${name}`);
  // {{name}} must be given; {{name?}} may be left out (an empty value), and a notify gateway left empty is dropped
  const fill = (s: string) => s.replace(/\{\{(\w+)(\??)\}\}/g, (_m, k: string, opt: string) => { if (!(k in vars)) { if (opt) return ""; throw new Error(`${name} needs ${k}`); } return vars[k]; });
  const dropEmpty = (fields: Record<string, unknown>) => {
    for (const s of (fields.services as { notify?: { gateway?: string } }[] | undefined) ?? []) if (s.notify && s.notify.gateway === "") delete s.notify.gateway;
    return fields;
  };
  return { path: fill(meta.path), extension: meta.extension, tags: meta.tags, fields: dropEmpty(JSON.parse(fill(JSON.stringify(meta.fields)))), body: readFileSync(file, "utf8") };
}

/** The components an applet imports, each from this folder (its id is its file's name), then the applet itself. */
export function withImports(name: string, vars: Record<string, string> = {}): AppletRecord[] {
  const applet = appletRecord(name, vars);
  return [...importsOf(applet.body).map((id) => {
    const c = appletRecord(id, vars);
    if (!c.tags.includes("component") || (c.fields.component as { id?: unknown } | undefined)?.id !== id) throw new Error(`${name} imports ${id}, and applets/${id}.json isn't the component ${id}`);
    return c;
  }), applet];
}
