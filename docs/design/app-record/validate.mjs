// Checks every example. A file in examples/ must pass; a file in examples/invalid/ must be refused. Beyond the schemas
// it checks what a schema can't say: an app's id is its path, signal ids are unique, and an approval is a real signed
// event that names the record its path names and lasts a year at most; the key list is a real signed event too.   node <path>/validate.mjs
import { readdirSync } from "node:fs";
import { Ajv, addFormats, checker, here, json, pathOf, subjectId, verifyEvent, YEAR } from "./lib.mjs";
const at = (p) => here(import.meta.url, p);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemas = Object.fromEntries(["app", "settings", "signals"].map((n) => [n, ajv.compile(json(at(`./${n}.schema.json`)))]));
const ap = checker();

function approval(x) {
  if (!ap.A.record(x)) return ap.ajv.errorsText(ap.A.record.errors);
  const e = x.fields.approval.event;
  if (!verifyEvent({ ...e })) return "the event's id or signature doesn't hold";
  const c = JSON.parse(e.content);
  if (!ap.A.content(c)) return "content: " + ap.ajv.errorsText(ap.A.content.errors);
  if (x.path !== pathOf(c.subject) || e.tags.find((t) => t[0] === "d")[1] !== `parachute-approval:${subjectId(c.subject)}`) return "its path or d tag names another applet than its content";
  if (c.approved && Date.parse(c.expires) - Date.parse(c.at) > YEAR) return "it would last more than a year";
  return null;
}
function keys(x) {
  if (!ap.K.record(x)) return ap.ajv.errorsText(ap.K.record.errors);
  const e = x.fields.keys.event;
  if (!verifyEvent({ ...e })) return "the event's id or signature doesn't hold";
  const c = JSON.parse(e.content);
  if (!ap.K.content(c)) return "content: " + ap.ajv.errorsText(ap.K.content.errors);
  return new Set(c.keys.map((k) => k.key)).size === c.keys.length ? null : "a key is listed twice";
}
/** null when it holds, else why not. */
function check(file, x) {
  const kind = file.split("-")[0].replace(".json", "");
  if (kind === "approval") return approval(x);
  if (kind === "keys") return keys(x);
  const v = schemas[kind];
  if (!v) return `no schema for ${file}`;
  if (!v(x)) return ajv.errorsText(v.errors);
  if (kind === "app" && x.path !== `Parachute/Apps/${x.fields.app.id}`) return "the app's id isn't the last part of its path";
  if (kind === "signals" && new Set(x.map((s) => s.id)).size !== x.length) return "a signal id is used twice";
  return null;
}

let bad = 0;
for (const [dir, want] of [["./examples/", true], ["./examples/invalid/", false]]) {
  for (const f of readdirSync(at(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const why = check(f, json(at(dir + f)));
    const right = (why === null) === want;
    if (!right) bad++;
    console.log(`${right ? "ok  " : "FAIL"} ${dir.slice(2)}${f}: ${why === null ? "valid" : "refused: " + why.slice(0, 110)}`);
  }
}
console.log(bad ? `${bad} wrong` : "all as expected");
process.exit(bad ? 1 : 0);
