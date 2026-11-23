// Check a local applet record (<stem>.json + <stem>.<extension>) the way the app reads it, before it goes into a vault.
// It runs through vite-node, which resolves the app's own modules (src/applet/check.ts):
//   npx vite-node scripts/check-applet.ts applets/starter
//   npx vite-node scripts/check-applet.ts ../example-applet/fieldbook.json --strict   (warnings fail too)
// One of this repo's applets/ with {{placeholders}} is read as install-applets.ts reads it, filled from --set k=v.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appletRecord } from "../applets/record.ts";
import { checkAppletRecord, type AppletRecordInput } from "../src/applet/check.ts";

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const vars: Record<string, string> = {};
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--set") { const [k, ...v] = (argv[++i] ?? "").split("="); vars[k] = v.join("="); }
  else if (!argv[i].startsWith("-")) rest.push(argv[i]);
}
const target = rest[0];

if (!target) {
  console.error("Usage: npx vite-node scripts/check-applet.ts <stem | path/to/applet.json> [--strict] [--set name=value …]");
  process.exit(2);
}

const abs = resolve(target);
const jsonPath = abs.endsWith(".json") ? abs : `${abs}.json`;
if (!existsSync(jsonPath)) {
  console.error(`Not found: ${jsonPath}`);
  process.exit(2);
}

/** The record from <stem>.json and the code file it names (<stem>.<extension>). */
function readLocal(jsonPath: string): AppletRecordInput {
  let meta: Omit<AppletRecordInput, "body">;
  try { meta = JSON.parse(readFileSync(jsonPath, "utf8")); } catch (e) {
    console.error(`${jsonPath} isn't JSON: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    console.error(`${jsonPath} isn't a record: it should be an object with path, extension, tags and fields`);
    process.exit(2);
  }
  const codePath = `${jsonPath.replace(/\.json$/, "")}.${meta.extension}`;
  if (typeof meta.extension !== "string" || !existsSync(codePath)) {
    console.error(`No code file for ${jsonPath}: it says "extension": ${JSON.stringify(meta.extension)}, and ${codePath} isn't there`);
    process.exit(2);
  }
  return { path: meta.path, extension: meta.extension, tags: meta.tags, fields: meta.fields, body: readFileSync(codePath, "utf8") };
}

/** One of this repo's applets/, as install-applets.ts puts it in: its {{placeholders}} filled from --set. */
function readShipped(name: string): AppletRecordInput {
  try { return appletRecord(name, vars); } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}: pass it as --set <name>=<value>, as install-applets.ts takes it`);
    process.exit(2);
  }
}

const shipped = realpathSync(dirname(jsonPath)) === realpathSync(fileURLToPath(new URL("../applets", import.meta.url)));
const record = shipped ? readShipped(basename(jsonPath, ".json")) : readLocal(jsonPath);

const res = await checkAppletRecord(record);
console.log(`Checked ${record.path} (${record.extension}, ${(res.bytes / 1024).toFixed(1)} KB)`);
for (const e of res.errors) console.error(`  ERROR: ${e}`);
for (const w of res.warnings) console.warn(`  WARN:  ${w}`);
for (const f of res.conformance) console.warn(`  KIT:${f.line} ${f.what} — use ${f.use}`);

const failed = !res.ok || (strict && (res.warnings.length > 0 || res.conformance.length > 0));
if (!failed) {
  console.log(`OK (${res.errors.length} errors, ${res.warnings.length} warnings, ${res.conformance.length} kit findings)`);
}
process.exit(failed ? 1 : 0);
