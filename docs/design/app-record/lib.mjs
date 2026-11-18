// Shared by sign-examples.mjs, validate.mjs and attacks.mjs: the hashes, making a key list and an approval, and the
// rule a client runs before it lets vault code start. This is the rule as the design states it, small enough to read;
// it is not the app. Run the scripts from a folder that has ajv, ajv-formats and nostr-tools installed.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
export const Ajv = require("ajv/dist/2020").default;
export const addFormats = require("ajv-formats").default;
export const { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } = require("nostr-tools/pure");
export const here = (base, p) => fileURLToPath(new URL(p, base));
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));

export const APPROVAL_KIND = 30479, KEYS_KIND = 30480;
export const YEAR = 366 * 24 * 3600 * 1000;
export const subjectId = (s) => `${s.hub}/${s.vault}/${s.record}`;
export const pathOf = (s) => `Parachute/Approvals/${new URL(s.hub).host}/${s.vault}/${s.record}`;

// ── the two hashes: every client computes them itself from what it is about to run
const sha = (x) => createHash("sha256").update(x).digest("hex");
/** Canonical JSON: sorted keys, no spaces (as src/applet/grant.ts `canonical`). */
export const canonical = (x) => Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : x && typeof x === "object" ? `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x ?? null);
/** The code, with every module it imports (each as its own source text). */
export const codeHash = (source, imports = []) => "tsx:" + sha(canonical({ source, imports: [...imports].sort() }));
/** The record's own fields as written, with where it lives. Nothing a device made up is in it. */
export const scopeHash = (subject, fields) => sha(canonical({ v: 4, hub: subject.hub, vault: subject.vault, record: subject.record, fields }));
export const hashesOf = (applet) => ({ code: codeHash(applet.source, applet.imports), scope: scopeHash(applet.subject, applet.fields) });

// ── signing (in the app: native code, after the device unlock; the key list by whatever holds the anchor)
const secs = (when) => Math.floor(Date.parse(when) / 1000);
export function keyList(anchorSk, keys, when, after = 0) {
  const event = finalizeEvent({ kind: KEYS_KIND, created_at: secs(when), tags: [["d", "parachute-keys"]], content: JSON.stringify({ v: 1, seq: Math.max(secs(when), after + 1), at: when, keys }) }, anchorSk);
  return { path: "Parachute/Keys", tags: ["parachute-keys"], body: "Which keys are yours now. Signed by your root key (or your approval key, if you keep no root key).", fields: { keys: { event } } };
}
/** `after`: the n of the approval it replaces, as the signer read it from the vault (0 for the first). */
export function approve(sk, subject, after, body, when) {
  const event = finalizeEvent({ kind: APPROVAL_KIND, created_at: secs(when), tags: [["d", `parachute-approval:${subjectId(subject)}`]], content: JSON.stringify({ v: 1, subject, n: Math.max(secs(when), after + 1), ...body, at: when }) }, sk);
  return { path: pathOf(subject), tags: ["parachute-approval"], body: "Signed by your approval key. Changed by hand, it is void.", fields: { approval: { event } } };
}
export const nOf = (rec) => JSON.parse(rec.fields.approval.event.content).n;

export function checker() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const load = (n) => { const schema = json(here(import.meta.url, `./${n}.schema.json`)); return { record: ajv.compile(schema), content: ajv.compile({ $ref: schema.$id + "#/$defs/content" }) }; };
  const A = load("approval"), K = load("keys");

  /** A new client. `anchor`: the public half of the person's root key (or approval key), put on the device by the
   *  person when they set it up. Everything else the client learns, checks against that, and remembers. */
  const client = (anchor, o = {}) => ({ anchor, keys: null, keysSeen: 0, held: {}, whose: (s) => (s.hub === "https://uni.example" ? "mine" : "theirs"), now: Date.parse("2026-11-18T00:00:00Z"), ...o });

  /** Read the key list the vault (or the relay) handed over. Returns why it was not taken, or null. A list not taken
   *  changes nothing: the client goes on with the newest one it verified. */
  function readKeys(c, rec) {
    if (!c.anchor) return "this client has no anchor";
    if (!rec || !K.record(rec)) return "not a key list";
    const e = rec.fields.keys.event;
    if (!verifyEvent({ ...e })) return "the id or signature doesn't hold";
    if (e.pubkey !== c.anchor) return "not signed by this person's anchor";
    let l; try { l = JSON.parse(e.content); } catch { return "content isn't JSON"; }
    if (!K.content(l)) return "content: " + ajv.errorsText(K.content.errors).slice(0, 80);
    if (l.seq <= c.keysSeen) return l.seq === c.keysSeen ? null : `older than the newest list this client has seen`;
    c.keysSeen = l.seq; c.keys = l.keys;
    return null;
  }
  /** The approval keys that count now: those on the newest verified list; with no list yet, the anchor itself. */
  const approvalKeys = (c) => (c.keys ? c.keys.filter((k) => k.role === "approval").map((k) => k.key) : c.anchor ? [c.anchor] : []);

  /** Read an approval record the vault handed over, for one piece of code. Returns why it was not taken, or null.
   *  One that is taken is kept on the device, so a vault that later deletes it changes nothing here. */
  function readApproval(c, subject, rec) {
    if (!rec) return "nothing there";
    if (!A.record(rec)) return "not an approval record";
    const e = rec.fields.approval.event;
    if (!verifyEvent({ ...e })) return "the id or signature doesn't hold";
    let a; try { a = JSON.parse(e.content); } catch { return "content isn't JSON"; }
    if (!A.content(a)) return "content: " + ajv.errorsText(A.content.errors).slice(0, 80);
    const id = subjectId(a.subject);
    if (id !== subjectId(subject) || rec.path !== pathOf(a.subject) || e.tags.find((t) => t[0] === "d")[1] !== `parachute-approval:${id}`) return "it is an approval of something else";
    const held = c.held[id];
    if (held && e.id === held.id) return null;
    if (!approvalKeys(c).includes(e.pubkey)) return "signed by a key that is not an approval key on this person's key list";
    if (held && a.n <= held.a.n) return a.n === held.a.n ? "another approval with the number of the one this client holds" : "older than the one this client holds";
    if (a.approved && Date.parse(a.expires) - Date.parse(a.at) > YEAR) return "it would last more than a year";
    c.held[id] = { id: e.id, pubkey: e.pubkey, a };
    return null;
  }

  /** May this code start? `applet`: { subject, source, imports, fields } as the client reads it now. */
  function decide(c, applet, rec) {
    const no = (why) => ({ run: false, why });
    if (!c.anchor) return no("this client has no anchor to check against: it asks for itself, as today");
    const notTaken = readApproval(c, applet.subject, rec);
    const held = c.held[subjectId(applet.subject)];
    if (!held) return no(`no approval${notTaken && rec ? " (" + notTaken + ")" : ""}: it asks`);
    const because = notTaken && rec ? ` (what the vault offered was not taken: ${notTaken})` : "";
    if (!approvalKeys(c).includes(held.pubkey)) return no("signed by a key that is not an approval key on this person's key list" + because);
    const a = held.a, h = hashesOf(applet);
    if (!a.approved) return no("withdrawn" + because);
    if (Date.parse(a.expires) <= c.now) return no("its year ran out");
    if (a.code !== h.code) return no("the code is not the code that was approved" + because);
    if (a.scope !== h.scope) return no("it asks for something other than what was approved" + because);
    if (a.whose !== c.whose(a.subject)) return no("this device and the approving one disagree on whose the vault is");
    return { run: true, note: because };
  }
  return { client, readKeys, readApproval, decide, approvalKeys, A, K, ajv };
}
