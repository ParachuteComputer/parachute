// Makes the approval examples: real events signed with a key made here and thrown away.
//   node <path>/sign-examples.mjs
import { writeFileSync } from "node:fs";
import { approve, generateSecretKey, here } from "./lib.mjs";
const sk = generateSecretKey(); // never written anywhere
const save = (name, rec) => writeFileSync(here(import.meta.url, `./examples/${name}`), JSON.stringify(rec, null, 2) + "\n");

const rooms = { hub: "https://uni.example", vault: "home", record: "01M7ROOMSAPPLET", applet: "rooms" };
const events = { hub: "https://techne.example", vault: "techne", record: "01M7EVENTS", applet: "events" };
const scratch = { hub: "https://uni.example", vault: "home", record: "01M7SCRATCH", applet: "scratch" };
const roomsBody = { approved: true, code: "tsx:" + "9b13".padEnd(64, "c"), scope: "5d2c".padEnd(64, "a"), modes: ["sealed"], whose: "mine", expires: "2027-11-18T09:30:00.000Z", device: "Pixel", others: [],
  face: ["As you on relay.example (your everyday key): posts messages, edits and typing in your rooms. What it reads can go there.", "High risk, with your approval key: answers approval cards and secret requests from Uni there.", "Counts and notifies through push.example: mentions and messages from Uni.", "Also: the microphone when you press record, files you pick."] };

const first = approve(sk, rooms, 1, null, { ...roomsBody, code: "tsx:" + "40aa".padEnd(64, "b"), expires: "2027-11-02T08:00:00.000Z" }, "2026-11-02T08:00:00.000Z");
const second = approve(sk, rooms, 2, first.fields.approval.event.id, roomsBody, "2026-11-18T09:30:00.000Z");
save("approval-rooms.json", second);
save("approval-events-from-techne.json", approve(sk, events, 1, null, { approved: true, code: "tsx:" + "77f1".padEnd(64, "0"), scope: "0aa3".padEnd(64, "e"), modes: ["sealed", "approved-code"], whose: "theirs", expires: "2027-11-10T19:12:00.000Z", device: "Pixel", others: [],
  face: ["Someone else's vault, techne at techne.example.", "Read notes in Events/"] }, "2026-11-10T19:12:00.000Z"));
const s1 = approve(sk, scratch, 1, null, { approved: true, code: "tsx:" + "1200".padEnd(64, "1"), scope: "9911".padEnd(64, "f"), modes: ["sealed"], whose: "mine", expires: "2027-11-05T10:00:00.000Z", device: "Laptop", others: [], face: ["Read, add and change notes in Scratch/"] }, "2026-11-05T10:00:00.000Z");
save("approval-scratch-withdrawn.json", approve(sk, scratch, 2, s1.fields.approval.event.id, { approved: false, device: "Pixel" }, "2026-11-12T07:45:00.000Z"));

// refused: the words inside the signed event changed by someone with only a vault token; no signature; ten years
const forged = structuredClone(second);
forged.fields.approval.event.content = forged.fields.approval.event.content.replace("9b13", "f00d");
save("invalid/approval-forged-code.json", forged);
const { sig: _s, ...unsigned } = second.fields.approval.event;
save("invalid/approval-unsigned.json", { ...second, fields: { approval: { event: unsigned } } });
save("invalid/approval-ten-years.json", approve(sk, rooms, 3, second.fields.approval.event.id, { ...roomsBody, expires: "2036-11-18T09:30:00.000Z" }, "2026-11-18T09:30:00.000Z"));
const moved = structuredClone(second); moved.path = "Parachute/Approvals/uni.example/home/01M7SCRATCH";
save("invalid/approval-moved-to-another-applet.json", moved);
