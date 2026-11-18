// Makes the grants examples: real Nostr events signed with a key made here and thrown away, so validate.mjs can check
// real signatures. Run from a folder that has nostr-tools installed:  node <path>/sign-examples.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
const { generateSecretKey, finalizeEvent } = require("nostr-tools/pure");
const out = (name) => fileURLToPath(new URL(`./examples/${name}`, import.meta.url));
const sk = generateSecretKey(); // never written anywhere
const KIND = 30479;

const record = (event) => ({ path: "Parachute/Grants", tags: ["parachute-grants"], body: "What you allowed, signed by your key. Changed by hand, it is void.", fields: { grants: { event } } });
const list = (seq, prev, grants, when) => finalizeEvent({ kind: KIND, created_at: Math.floor(Date.parse(when) / 1000), tags: [["d", "parachute-grants"]], content: JSON.stringify({ v: 1, seq, prev, grants }) }, sk);
const save = (name, event) => writeFileSync(out(name), JSON.stringify(record(event), null, 2) + "\n");

const rooms = { subject: { hub: "https://uni.example", vault: "home", record: "01M7ROOMSAPPLET", applet: "rooms" }, scope: "5d2c".padEnd(64, "a"), code: "tsx:" + "9b13".padEnd(64, "c"), under: "sealed", whose: "mine", high: true,
  at: "2026-11-18T09:30:00.000Z", expires: "2027-11-18T09:30:00.000Z", device: "Pixel", others: [],
  face: ["As you on relay.example (your everyday key): posts messages, reactions, edits and typing in your rooms. What it reads can go there.", "High risk, with your approval key: answers approval cards and secret requests from Uni there.", "Counts and notifies through push.example: mentions and messages from Uni.", "Also: the microphone when you press record, files you pick."] };
const journal = { subject: { hub: "https://uni.example", vault: "home", record: "01M7JOURNAL", applet: "journal" }, scope: "71e0".padEnd(64, "b"), code: "tsx:" + "c4a2".padEnd(64, "d"), under: "sealed", whose: "mine",
  at: "2026-11-02T08:00:00.000Z", expires: "2027-11-02T08:00:00.000Z", device: "Laptop", others: [], face: ["Read, add and change notes in Journal/", "Also: opens journal notes you tap, the microphone when you press record."] };
const events = { subject: { hub: "https://techne.example", vault: "techne", record: "01M7EVENTS", applet: "events" }, scope: "0aa3".padEnd(64, "e"), code: "tsx:" + "77f1".padEnd(64, "0"), under: "sealed", whose: "theirs",
  at: "2026-11-10T19:12:00.000Z", expires: "2027-11-10T19:12:00.000Z", device: "Pixel", others: [], face: ["Someone else's vault, techne at techne.example.", "Read notes in Events/"] };
const scratch = { subject: { hub: "https://uni.example", vault: "home", record: "01M7SCRATCH", applet: "scratch" }, scope: "9911".padEnd(64, "f"), code: "tsx:" + "1200".padEnd(64, "1"), under: "sealed", whose: "mine",
  at: "2026-11-05T10:00:00.000Z", expires: "2027-11-05T10:00:00.000Z", device: "Laptop", others: [], face: ["Read, add and change notes in Scratch/"] };

// list 6 allowed Scratch; list 7 is the same day's revoke of it (it is simply gone) and Rooms allowed
const six = list(6, "ab".repeat(32), [journal, events, scratch], "2026-11-10T19:12:00Z");
const seven = list(7, six.id, [journal, events, rooms], "2026-11-18T09:30:00Z");
save("grants-6-before-the-revoke.json", six);
save("grants-7.json", seven);

// what a vault write token can do without the key: change the words inside the signed event
const forged = structuredClone(seven);
forged.content = forged.content.replace("9b13", "f00d");
save("invalid/grants-forged-code.json", forged);
const { sig: _sig, ...unsigned } = seven;
save("invalid/grants-unsigned.json", unsigned);
// signed, but wrong: an allow with no end in sight, and one applet listed twice
save("invalid/grants-ten-years.json", list(8, seven.id, [{ ...journal, expires: "2036-11-02T08:00:00.000Z" }], "2026-11-19T09:00:00Z"));
save("invalid/grants-applet-twice.json", list(8, seven.id, [journal, { ...journal, code: "tsx:" + "beef".padEnd(64, "2") }], "2026-11-19T09:00:00Z"));
