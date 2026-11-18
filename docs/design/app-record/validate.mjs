// Checks every example. A file in examples/ must pass; a file in examples/invalid/ must be refused. Beyond the schemas
// it checks what a schema can't say: an app's id is its path, signal ids are unique, and the grants record is a real
// signed event whose content holds (one entry per applet, none lasting over a year). Then it plays a device: having
// seen list 7, it must refuse list 6 put back. Run from a folder that has ajv, ajv-formats and nostr-tools installed:
//   node <path>/validate.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats").default;
const { verifyEvent } = require("nostr-tools/pure");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemas = Object.fromEntries(["app", "settings", "signals", "grants"].map((n) => [n, ajv.compile(json(here(`./${n}.schema.json`)))]));
const grantsContent = ajv.compile({ $ref: "https://parachute.computer/schema/app-record/grants.schema.json#/$defs/content" });
const YEAR = 366 * 24 * 3600 * 1000;

/** The signed list inside a grants record, or why it can't be trusted. */
function listOf(x) {
  const e = x.fields.grants.event;
  if (!verifyEvent({ ...e })) return { why: "the event's id or signature doesn't hold" };
  let c; try { c = JSON.parse(e.content); } catch { return { why: "the event's content isn't JSON" }; }
  if (!grantsContent(c)) return { why: "content: " + ajv.errorsText(grantsContent.errors) };
  const subjects = c.grants.map((g) => `${g.subject.hub}/${g.subject.vault}/${g.subject.record}`);
  if (new Set(subjects).size !== subjects.length) return { why: "an applet is listed twice" };
  if (c.grants.some((g) => Date.parse(g.expires) - Date.parse(g.at) > YEAR)) return { why: "a grant lasts more than a year" };
  return { list: c, pubkey: e.pubkey };
}

/** null when it holds, else why not. */
function check(file, x) {
  const kind = file.split("-")[0].replace(".json", "");
  const v = schemas[kind];
  if (!v) return `no schema for ${file}`;
  if (!v(x)) return ajv.errorsText(v.errors);
  if (kind === "app" && x.path !== `Parachute/Apps/${x.fields.app.id}`) return "the app's id isn't the last part of its path";
  if (kind === "signals" && new Set(x.map((s) => s.id)).size !== x.length) return "a signal id is used twice";
  if (kind === "grants") return listOf(x).why ?? null;
  return null;
}

let bad = 0;
for (const [dir, want] of [["./examples/", true], ["./examples/invalid/", false]]) {
  for (const f of readdirSync(here(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const why = check(f, json(here(dir + f)));
    const right = (why === null) === want;
    if (!right) bad++;
    console.log(`${right ? "ok  " : "FAIL"} ${dir.slice(2)}${f}: ${why === null ? "valid" : "refused: " + why.slice(0, 110)}`);
  }
}

// a device that has seen list 7 is shown list 6 again (someone with a vault token put the old record back)
const seven = listOf(json(here("./examples/grants-7.json"))), six = listOf(json(here("./examples/grants-6-before-the-revoke.json")));
const device = { key: seven.pubkey, seen: seven.list.seq };
const takes = (l) => l.pubkey === device.key && l.list.seq >= device.seen;
const chain = seven.list.prev === json(here("./examples/grants-6-before-the-revoke.json")).fields.grants.event.id;
const rollback = !takes(six) && takes(seven) && chain;
console.log(`${rollback ? "ok  " : "FAIL"} a device that saw list 7 refuses list 6 put back; 7 names 6 as the one it replaced`);
if (!rollback) bad++;

console.log(bad ? `${bad} wrong` : "all as expected");
process.exit(bad ? 1 : 0);
