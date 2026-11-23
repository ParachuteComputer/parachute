// Make a React project of many files into one applet record, then check it as the app reads it:
//   npx vite-node scripts/bundle-applet.ts <src/main.tsx> --record <applet.json> [--out <dir>] [--minify]
// <applet.json> is the record's path, tags and fields (as applets/starter.json); its extension becomes jsx. It writes
// <dir>/<stem>.json and <dir>/<stem>.jsx (by default beside applet.json, the stem its name with .bundled), which
// scripts/check-applet.ts reads, and which go into a vault as any record does (STARTER.md). Exits 1 when the bundle
// fails or the check finds an error.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { bundleApplet } from "../src/applet/bundle.ts";
import { checkAppletRecord } from "../src/applet/check.ts";
import { KEEP_ONE_CHARS } from "../src/applet/code.ts";
import { MAX_CODE_CHARS } from "../src/vault/limited.ts";

const argv = process.argv.slice(2);
let entry = "", recordPath = "", out = "", minify = false;
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === "--record") recordPath = argv[++i] ?? "";
  else if (k === "--out") out = argv[++i] ?? "";
  else if (k === "--minify") minify = true;
  else if (!k.startsWith("-")) entry = k;
}
if (!entry || !recordPath) {
  console.error("Usage: npx vite-node scripts/bundle-applet.ts <src/main.tsx> --record <applet.json> [--out <dir>] [--minify]");
  process.exit(2);
}

let meta: { path?: unknown; tags?: unknown; fields?: unknown };
try { meta = JSON.parse(readFileSync(resolve(recordPath), "utf8")); } catch (e) {
  console.error(`${recordPath} isn't JSON: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
const built = await bundleApplet(resolve(entry), { minify });
if (!built.ok) {
  for (const e of built.errors) console.error(`  ERROR: ${e}`);
  process.exit(1);
}
for (const w of built.warnings) console.warn(`  WARN:  ${w}`);

const stem = basename(recordPath, ".json").replace(/\.bundled$/, "") + ".bundled";
const dir = resolve(out || dirname(recordPath));
mkdirSync(dir, { recursive: true });
const record = { path: meta.path as string, extension: "jsx", tags: meta.tags as string[], fields: meta.fields as Record<string, unknown> };
writeFileSync(join(dir, `${stem}.json`), JSON.stringify({ version: 1, ...record }, null, 2) + "\n");
writeFileSync(join(dir, `${stem}.jsx`), built.code);

const res = await checkAppletRecord({ ...record, body: built.code });
const kb = (n: number) => `${(n / 1000).toFixed(1)} KB`;
console.log(`Bundled ${entry} into ${join(dir, `${stem}.jsx`)} (${kb(built.code.length)})`);
// what the size means: past these, it still runs, but is refused from someone else's vault, or transpiled on each open
console.log(`  from someone else's vault, up to ${kb(MAX_CODE_CHARS)}; kept compiled on the device, up to ${kb(KEEP_ONE_CHARS)} compiled${minify ? "" : " (--minify makes it smaller)"}`);
for (const e of res.errors) console.error(`  ERROR: ${e}`);
for (const w of res.warnings) console.warn(`  WARN:  ${w}`);
console.log(res.ok ? `OK: check it again any time with npx vite-node scripts/check-applet.ts ${join(dir, `${stem}.json`)}` : "Not OK: see the errors above");
process.exit(res.ok ? 0 : 1);
