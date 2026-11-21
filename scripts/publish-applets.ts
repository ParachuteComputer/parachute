// Publish Parachute's own applets (docs/design/PARACHUTE-SOURCE.md): writes <out>/index.json, a kind 30481 event (d =
// parachute-applets) signed with the release key in --key-file, and <out>/<sha256>.<extension> for each applet, from
// applets/<name>.json and .<extension>. Upload <out>/ as https://parachute.computer/applets/. A device takes an applet
// only when its `version` is above the app's own copy, so raise `version` in applets/<name>.json for each one that
// changed since the last app release. `n` must be higher than any index published before (devices refuse an older
// one): the default is the time in seconds.
//   node scripts/publish-applets.ts --key-file <hex secret key file> --out <dir> [--n <number>]
// The key never enters the repo; this prints nothing of it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const NAMES = ["notes", "journal", "capture", "vault", "connect", "home"];
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const keyFile = arg("--key-file"), out = arg("--out");
if (!keyFile || !out) { console.error("usage: node scripts/publish-applets.ts --key-file <file> --out <dir> [--n <number>]"); process.exit(2); }
const n = Number(arg("--n") ?? Math.floor(Date.now() / 1000));
if (!Number.isSafeInteger(n) || n < 1) { console.error("--n must be a whole number above 0"); process.exit(2); }
const hex = readFileSync(keyFile, "utf8").trim();
if (!/^[0-9a-f]{64}$/.test(hex)) { console.error("the key file holds no 64-character hex key"); process.exit(2); }
const sk = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const dir = join(import.meta.dirname, "..", "applets");
mkdirSync(out, { recursive: true });
const applets: Record<string, unknown> = {};
for (const name of NAMES) {
  const rec = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as { version?: number; path: string; extension: string; tags: string[]; fields: { needs?: unknown } };
  const body = readFileSync(join(dir, `${name}.${rec.extension}`), "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  writeFileSync(join(out, `${sha256}.${rec.extension}`), body);
  applets[name] = { version: rec.version ?? 1, ...(rec.fields.needs !== undefined ? { needs: rec.fields.needs } : {}), sha256, record: { path: rec.path, extension: rec.extension, tags: rec.tags, fields: rec.fields } };
}
const ev = finalizeEvent({ kind: 30481, created_at: Math.floor(Date.now() / 1000), tags: [["d", "parachute-applets"]], content: JSON.stringify({ v: 1, n, applets }) }, sk);
writeFileSync(join(out, "index.json"), JSON.stringify(ev));
console.log(`index ${n}, signed by ${getPublicKey(sk).slice(0, 12)}…, ${NAMES.length} applets, in ${out}`);
