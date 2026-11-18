// Shared by sign-examples.mjs, validate.mjs and attacks.mjs: making an approval, and the check a client runs before it
// lets an applet's code start. Run the scripts from a folder that has ajv, ajv-formats and nostr-tools installed.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
export const Ajv = require("ajv/dist/2020").default;
export const addFormats = require("ajv-formats").default;
export const { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } = require("nostr-tools/pure");
export const here = (base, p) => fileURLToPath(new URL(p, base));
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));

export const KIND = 30479;
export const YEAR = 366 * 24 * 3600 * 1000;
export const subjectId = (s) => `${s.hub}/${s.vault}/${s.record}`;
export const pathOf = (s) => `Parachute/Approvals/${new URL(s.hub).host}/${s.vault}/${s.record}`;

/** An approval record, signed with `sk` (in the app: the approval key, in native code, after the device unlock). */
export function approve(sk, subject, n, supersedes, body, when) {
  const event = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.parse(when) / 1000), tags: [["d", `parachute-approval:${subjectId(subject)}`]], content: JSON.stringify({ v: 1, subject, n, supersedes, ...body, at: when }) }, sk);
  return { path: pathOf(subject), tags: ["parachute-approval"], body: "Signed by your approval key. Changed by hand, it is void.", fields: { approval: { event } } };
}

export function checker() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = json(here(import.meta.url, "./approval.schema.json"));
  const record = ajv.compile(schema);
  const content = ajv.compile({ $ref: schema.$id + "#/$defs/content" });

  /** What a client decides for one applet. `client`: { approvalKey, seen: {subjectId: n}, mode, whose(subject), now }.
   *  `applet`: { subject, code, scope } as the client reads and hashes it itself, now. `rec`: the approval record the
   *  vault handed it, or null. Returns { run: true } or { run: false, why }. A record that holds raises `seen`. */
  function decide(client, applet, rec) {
    const no = (why) => ({ run: false, why });
    if (!client.approvalKey) return no("this client has no approval key to check against: it asks for itself");
    if (!rec) return no("no approval: it asks");
    if (!record(rec)) return no("not an approval record: " + ajv.errorsText(record.errors).slice(0, 80));
    const e = rec.fields.approval.event;
    if (!verifyEvent({ ...e })) return no("the id or signature doesn't hold");
    if (e.pubkey !== client.approvalKey) return no("signed by a key that isn't this person's approval key");
    let c; try { c = JSON.parse(e.content); } catch { return no("content isn't JSON"); }
    if (!content(c)) return no("content: " + ajv.errorsText(content.errors).slice(0, 80));
    const id = subjectId(c.subject);
    if (id !== subjectId(applet.subject) || rec.path !== pathOf(c.subject) || e.tags.find((t) => t[0] === "d")[1] !== `parachute-approval:${id}`) return no("it is an approval of another applet");
    const seen = client.seen[id] ?? 0;
    if (c.n < seen) return no(`older than the newest this client has seen (${c.n} < ${seen})`);
    client.seen[id] = c.n;
    if (!c.approved) return no("withdrawn");
    if (Date.parse(c.expires) - Date.parse(c.at) > YEAR) return no("it would last more than a year");
    if (Date.parse(c.expires) <= client.now) return no("its year ran out");
    if (c.code !== applet.code) return no("the code is not the code that was approved");
    if (c.scope !== applet.scope) return no("it asks for something other than what was approved");
    if (!c.modes.includes(client.mode)) return no("approved for another device mode");
    if (c.whose !== client.whose(c.subject)) return no("this client says the vault is someone else's (or not)");
    return { run: true };
  }
  return { decide, record, content, ajv };
}
