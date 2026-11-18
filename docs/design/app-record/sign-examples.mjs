// Makes the signed examples: real events, signed with keys made here and thrown away.   node <path>/sign-examples.mjs
import { writeFileSync } from "node:fs";
import { approve, generateSecretKey, getPublicKey, hashesOf, here, keyList, nOf } from "./lib.mjs";
const root = generateSecretKey(), approval = generateSecretKey(), everyday = generateSecretKey(); // never written anywhere
const save = (name, rec) => writeFileSync(here(import.meta.url, `./examples/${name}`), JSON.stringify(rec, null, 2) + "\n");

const keys = keyList(root, [{ role: "everyday", key: getPublicKey(everyday), name: "phone, laptop, Uni" }, { role: "approval", key: getPublicKey(approval), name: "phone" }], "2026-11-01T10:00:00.000Z");
save("keys.json", keys);

const rooms = { subject: { hub: "https://uni.example", vault: "home", record: "01M7ROOMSAPPLET", applet: "rooms" }, source: "export default function Rooms() { /* … */ }", imports: ["export default function Room() { /* … */ }"],
  fields: { applet: { contract: 2, id: "rooms", name: "Rooms", glyph: "◎", access: [], reach: ["voice"] }, app: ["links", "save", "attach"], services: [{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9, 5, 40003, 20002], media: true, approvals: { from: ["3f1c9a5e7b2d4068a1c3e5f7092b4d6e8fa1c3e5072b4d6e8fa1c3e5f7092b4d"] } }],
    signals: [{ id: "for-you", name: "mentions and messages from Uni", count: "new", via: "https://push.example/", from: { service: "rooms", mentions: true } }] } };
const face = ["As you on relay.example (your everyday key): posts messages, edits and typing in your rooms. What it reads can go there.", "High risk, with your approval key: answers approval cards and secret requests from Uni there.", "Counts and notifies through push.example: mentions and messages from Uni.", "Also: the microphone when you press record, files you pick.", "On a phone an applet could send what it reads to the internet: approve only code you trust."];
const first = approve(approval, rooms.subject, 0, { approved: true, ...hashesOf({ ...rooms, source: "export default function Rooms() { /* before */ }" }), whose: "mine", expires: "2027-11-02T08:00:00.000Z", face, others: [], device: "Pixel" }, "2026-11-02T08:00:00.000Z");
const second = approve(approval, rooms.subject, nOf(first), { approved: true, ...hashesOf(rooms), whose: "mine", expires: "2027-11-18T09:30:00.000Z", face, others: [], device: "Pixel" }, "2026-11-18T09:30:00.000Z");
save("approval-rooms.json", second);

const events = { subject: { hub: "https://techne.example", vault: "techne", record: "01M7EVENTS", applet: "events" }, source: "export default function Events() { /* … */ }", fields: { applet: { contract: 2, id: "events", name: "Events", glyph: "◷", access: [{ vault: "here", allow: [{ path: "Events/", verbs: ["read"] }] }] } } };
save("approval-events-from-techne.json", approve(approval, events.subject, 0, { approved: true, ...hashesOf(events), whose: "theirs", expires: "2027-11-10T19:12:00.000Z", device: "Pixel", others: [], face: ["Someone else's vault, techne at techne.example.", "Read notes in Events/"] }, "2026-11-10T19:12:00.000Z"));
const frame = { hub: "https://uni.example", vault: "home", record: "01M7FRAME", applet: "frame", kind: "frame" };
save("approval-your-frame.json", approve(approval, frame, 0, { approved: true, code: "tsx:" + "c0de".padEnd(64, "4"), scope: "f4a3".padEnd(64, "e"), whose: "mine", expires: "2027-11-03T12:00:00.000Z", device: "Pixel", others: [], face: ["Your own frame: it draws the launcher, a vault and a note, and can ask the app to move you and change your bar on a tap."] }, "2026-11-03T12:00:00.000Z"));
const scratch = { hub: "https://uni.example", vault: "home", record: "01M7SCRATCH", applet: "scratch" };
const s1 = approve(approval, scratch, 0, { approved: true, code: "tsx:" + "1200".padEnd(64, "1"), scope: "9911".padEnd(64, "f"), whose: "mine", expires: "2027-11-05T10:00:00.000Z", device: "Pixel", others: [], face: ["Read, add and change notes in Scratch/"] }, "2026-11-05T10:00:00.000Z");
save("approval-scratch-withdrawn.json", approve(approval, scratch, nOf(s1), { approved: false, device: "Pixel" }, "2026-11-12T07:45:00.000Z"));

// refused
const forged = structuredClone(second);
forged.fields.approval.event.content = forged.fields.approval.event.content.replace(/"code":"tsx:..../, '"code":"tsx:f00d');
save("invalid/approval-forged-code.json", forged);
const { sig: _s, ...unsigned } = second.fields.approval.event;
save("invalid/approval-unsigned.json", { ...second, fields: { approval: { event: unsigned } } });
save("invalid/approval-ten-years.json", approve(approval, rooms.subject, nOf(second), { approved: true, ...hashesOf(rooms), whose: "mine", expires: "2036-11-18T09:30:00.000Z", face, others: [] }, "2026-11-18T09:30:00.000Z"));
const moved = structuredClone(second); moved.path = "Parachute/Approvals/uni.example/home/01M7SCRATCH";
save("invalid/approval-moved-to-another-applet.json", moved);
const k2 = structuredClone(keys); k2.fields.keys.event.content = k2.fields.keys.event.content.replace(getPublicKey(approval), getPublicKey(generateSecretKey()));
save("invalid/keys-forged-approval-key.json", k2);
save("invalid/keys-no-approval-key.json", keyList(root, [{ role: "everyday", key: getPublicKey(everyday) }], "2026-11-01T10:00:00.000Z"));
