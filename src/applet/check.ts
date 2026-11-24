// Local validation for an applet record before it goes into a vault. It runs what the app runs: readApplet (the
// manifest and every field the app reads: opens, app, services, signals, settings), the sucrase transpile, and the
// frame's import rule on the compiled module; then the older-app level check and kit conformance. Pure: no FS or
// network. scripts/check-applet.ts runs it from the command line (through vite-node, which reads the app's modules).
import { codeKindOf, KEEP_ONE_CHARS, PROVIDED_IMPORTS, transpile } from "./code.ts";
import { readApplet, type AppletEntry } from "./discovery.ts";
import { IMPORT_PREFIX, importsOf, MAX_IMPORTS, plainImportId, stringsAfter } from "./imports.ts";
import { PART_LEVEL, PART_NAMES } from "./kits/modules.ts";
import { APP_LEVEL, levelNeeded, neededWhy, tooNew } from "./level.ts";
import { check as checkConformance, withoutComments, type Finding } from "../kit/conformance.ts";
import { MAX_CODE_CHARS } from "../vault/limited.ts";

export type AppletRecordInput = {
  path: string;
  extension: string;
  tags: string[];
  fields: Record<string, unknown>;
  body: string;
};

export type AppletCheckResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  conformance: Finding[];
  imports: string[];
  /** What the app reads from the record (readApplet in your own vault), or null when it refuses it. */
  entry: AppletEntry | null;
  bytes: number;
};

/** Every module the compiled code requires: what the frame's loader will be asked for, re-exports included (a
 *  `require("x")` written in a comment or a string is not one). Known limit, shared with importsOf: a regex literal
 *  holding a quote (`/"/`) reads as the start of a string, so what follows it may go unseen (on one line of minified
 *  code, the rest of the file): scripts/bundle-applet.ts says every import at the top for that reason. */
export function requiresOf(js: string): string[] {
  return [...new Set(stringsAfter(js, String.raw`\brequire\s*\(\s*`))];
}

/** Does the compiled module set a default export (`exports.default = …`, `exports. default = …`, `export { x as default } from`)? */
const hasDefault = (js: string) => /\bexports\s*\.\s*default\s*=/.test(js) || /_createNamedExportFrom\([^,]+,\s*'default'/.test(js);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Imported local identifiers (excluding `import type`). */
function importedNames(clean: string): string[] {
  const out: string[] = [];
  for (const m of clean.matchAll(/^\s*import\s*([^;]+?)\s*from\s*["'][^"']+["'];?/gm)) {
    if (/^type\s+/.test(m[1])) continue;
    const spec = m[1];
    const braces = /\{([^}]*)\}/.exec(spec);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const p = part.trim();
        if (!p || /^type\s+/.test(p)) continue;
        out.push((p.split(/\s+as\s+/)[1] ?? p).trim());
      }
    }
    const head = spec.replace(/\{[^}]*\}/, "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const h of head) out.push(h.replace(/^\*\s+as\s+/, ""));
  }
  return out;
}

/** Top-level value declarations (that would shadow an imported name under sucrase CJS rewrite). */
function topLevelDeclared(clean: string): string[] {
  return [...clean.matchAll(/^(?:export\s+(?:default\s+)?)?(?:const|let|var|function\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

/** Kit parts taken from "parachute", with how the code names them: a named import (beside a default one too), or
 *  `Ns.Part` through a namespace import. Either may fall back on an older app with `??`. */
function kitPartsImported(clean: string): { part: string; as: string }[] {
  const out: { part: string; as: string }[] = [];
  for (const m of clean.matchAll(/import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*["']parachute["']/g)) {
    for (const part of PART_NAMES) if (new RegExp(`(^|[^\\w$.])${escapeRe(m[1])}\\s*\\.\\s*${part}\\b`).test(clean)) out.push({ part, as: `${m[1]}.${part}` });
  }
  for (const m of clean.matchAll(/import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*["']parachute["']/g)) {
    for (const raw of m[1].split(",")) {
      const p = raw.trim();
      if (!p || /^type\s+/.test(p)) continue;
      const [part, as] = p.split(/\s+as\s+/);
      if ((PART_NAMES as readonly string[]).includes(part)) out.push({ part, as: (as ?? part).trim() });
    }
  }
  return out;
}

/** Validate an applet record's manifest, fields, code, imports, levels and conformance. */
export async function checkAppletRecord(record: AppletRecordInput): Promise<AppletCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = new TextEncoder().encode(record.body).byteLength;

  // 1. Extension
  const kind = codeKindOf({ extension: record.extension });
  if (!kind) errors.push(`extension must be tsx, jsx or html (got ${JSON.stringify(record.extension)})`);

  // 2. The record as the app reads it in your own vault: path, tag, manifest, then each field it may leave out
  const meta = record.fields && typeof record.fields === "object" ? record.fields : {};
  let entry: AppletEntry | null = null;
  // `needs` above this build: this app lists it and never runs it. Its fields are still read, as the newer app will.
  if (tooNew(meta.needs, APP_LEVEL)) errors.push(`this app would list it but not run it: ${neededWhy(meta.needs, APP_LEVEL)}`);
  {
    const read = readApplet({ id: "local-check", path: record.path, tags: record.tags, metadata: meta }, "here", false, () => false, Math.max(APP_LEVEL, levelNeeded(meta.needs)));
    const isComponent = Array.isArray(record.tags) && record.tags.includes("component");
    if (!read.ok) errors.push(isComponent ? "it is a component (tagged component): this checks applets only" : read.error.replace(/^it /, "the record "));
    else if (read.entry.newer) errors.push(`this app would list it but not run it: ${read.entry.newerWhy ?? "written for a newer app"}`);
    else {
      entry = read.entry;
      for (const [k, e] of [["app", entry.appError], ["opens", entry.opensError], ["services", entry.servicesError], ["signals", entry.signalsError], ["settings", entry.settingsError], ["techne", entry.techneError]] as const) {
        if (e) errors.push(`fields.${k}: ${e}`);
      }
    }
  }

  // 3. Size advisories
  if (record.body.length > MAX_CODE_CHARS) {
    warnings.push(`code is ${(record.body.length / 1000).toFixed(1)} KB, past the ${MAX_CODE_CHARS / 1000} KB limit for applets opened from someone else's vault`);
  }

  let imports: string[] = [];
  let conformance: Finding[] = [];

  if (kind === "tsx" || kind === "jsx") {
    const clean = withoutComments(record.body);

    // 4. Transpile with sucrase (the app's own compiler), then the imports the frame's loader will be asked for
    const compiled = await transpile(record.body, kind);
    if (!compiled.ok) {
      errors.push(`code does not compile: ${compiled.error}`);
    } else {
      if (compiled.js.length > KEEP_ONE_CHARS) {
        warnings.push(`compiled JS is ${(compiled.js.length / 1000).toFixed(1)} KB, past the ${KEEP_ONE_CHARS / 1000} KB the device keeps compiled: it will re-transpile on each open`);
      }
      if (!hasDefault(compiled.js)) errors.push("module has no default export (export default function App() …)");

      // 5. Allowed imports: the compiled requires (what the loader is asked for), and the component ids the frame
      // resolves before it runs anything, read from the source as the frame reads them (importsOf): an unused or
      // `import type` component import is gone from the compiled code but the frame still refuses or resolves it.
      imports = requiresOf(compiled.js);
      const frameIds = importsOf(record.body);
      for (const spec of imports) {
        if ((PROVIDED_IMPORTS as readonly string[]).includes(spec)) continue;
        if (spec.startsWith(IMPORT_PREFIX)) {
          if (!frameIds.includes(spec.slice(IMPORT_PREFIX.length))) errors.push(`"${spec}" is required but not imported: the frame loads a component only for \`import … from "${spec}"\``);
          continue;
        }
        errors.push(`unsupported import "${spec}": an applet may import only ${PROVIDED_IMPORTS.join(", ")} or component:<id>`);
      }
      for (const cid of frameIds) {
        if (!plainImportId(cid)) errors.push(`invalid component import "${IMPORT_PREFIX}${cid}": id must be short kebab-case`);
      }
      if (frameIds.length > MAX_IMPORTS) errors.push(`imports ${frameIds.length} components (at most ${MAX_IMPORTS})`);
    }

    // 6. Shadowed imports
    const impSet = new Set(importedNames(clean));
    for (const name of topLevelDeclared(clean)) {
      if (impSet.has(name)) errors.push(`top-level declaration "${name}" shadows an imported name of the same identifier`);
    }

    // 7. Parts newer than the record's `needs` (an older app would show the applet broken)
    const needs = levelNeeded(meta.needs);
    for (const { part, as } of kitPartsImported(clean)) {
      const partLvl = PART_LEVEL[part as keyof typeof PART_LEVEL];
      if (partLvl > needs && !(as !== part && new RegExp(`(^|[^\\w$])${escapeRe(as)}\\s*\\?\\?`).test(clean))) {
        warnings.push(`"${part}" requires app level ${partLvl} (record needs ${needs}): add "needs": ${partLvl} in fields, or alias and fall back with ??`);
      }
    }

    // 8. Kit conformance
    conformance = checkConformance(record.body);
  }

  return { ok: errors.length === 0, errors, warnings, conformance, imports, entry, bytes };
}
