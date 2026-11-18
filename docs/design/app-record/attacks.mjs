// The approval rule (lib.mjs `decide`) played against attacks, with real keys, real signatures and hashes computed
// from the code and fields. Each line is an attempt, what the client decided, and whether that is what the design
// says, including the gaps the design admits (marked GAP). It tests the rule's logic. It does not test the app, the
// native signer or the unlock, none of which exist yet.   node <path>/attacks.mjs
import { approve, checker, generateSecretKey, getPublicKey, hashesOf, keyList, nOf, scopeHash } from "./lib.mjs";
const { client, readKeys, decide } = checker();
const pub = getPublicKey;

const root = generateSecretKey(), approval = generateSecretKey(), everyday = generateSecretKey(), attacker = generateSecretKey();
const list1 = keyList(root, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(approval) }], "2026-10-01T00:00:00.000Z");

const rooms = { subject: { hub: "https://uni.example", vault: "home", record: "01M7ROOMSAPPLET", applet: "rooms" }, source: "function Rooms(){ /* November */ }", imports: { room: "function Room(){}", list: "function List(){}" },
  fields: { applet: { contract: 2, id: "rooms", name: "Rooms" }, services: [{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9, 5] }] } };
const october = { ...rooms, source: "function Rooms(){ /* October */ }" };
const evil = { ...rooms, source: "function Rooms(){ sendEverythingSomewhere() }" };
const evilImport = { ...rooms, imports: { ...rooms.imports, room: "function Room(){ sendEverythingSomewhere() }" } };
const swapped = { ...rooms, imports: { room: rooms.imports.list, list: rooms.imports.room } };
const wider = { ...rooms, fields: { ...rooms.fields, services: [{ ...rooms.fields.services[0], publish: [9, 5, 1], url: "wss://elsewhere.example" }] } };
const scratch = { ...rooms, subject: { ...rooms.subject, record: "01M7SCRATCH", applet: "scratch" } };
const events = { subject: { hub: "https://techne.example", vault: "techne", record: "01M7EVENTS", applet: "events" }, source: "function Events(){}", fields: { applet: { contract: 2, id: "events", name: "Events" } } };

const yes = (applet, extra = {}) => ({ approved: true, ...hashesOf(applet), whose: "mine", expires: "2027-10-01T00:00:00.000Z", face: ["…"], others: [], ...extra });
const oct = approve(approval, rooms.subject, 0, yes(october), "2026-10-02T00:00:00.000Z");
const nov = approve(approval, rooms.subject, nOf(oct), yes(rooms), "2026-11-02T00:00:00.000Z");
const off = approve(approval, rooms.subject, nOf(nov), { approved: false }, "2026-11-10T00:00:00.000Z");

/** A client set up with the anchor, that has read the key list. `saw`: approvals it read before the attack. */
const fresh = (o = {}) => { const c = client(pub(root), o); readKeys(c, list1); return c; };
const whoSaw = (recs, o = {}) => { const c = fresh(o); for (const [applet, rec] of recs) decide(c, applet, rec); return c; };

let bad = 0;
function attempt(what, got, wantRun, note = "") {
  const right = got.run === wantRun;
  if (!right) bad++;
  console.log(`${right ? "ok  " : "FAIL"} ${what}\n       → ${got.run ? "RUNS" : "does not run: " + got.why}${note ? "\n       " + note : ""}`);
}
const check = (what, right, note = "") => { if (!right) bad++; console.log(`${right ? "ok  " : "FAIL"} ${what}${note ? "\n       " + note : ""}`); };

console.log("── the ordinary path");
attempt("Approved on the phone; the laptop reads the record and hashes the code and fields itself", decide(fresh(), rooms, nov), true);
attempt("Never approved", decide(fresh(), rooms, null), false);
check("Two devices that call the vault different names get the same asks' hash (today's hash takes the device's name: they would differ)",
  scopeHash(rooms.subject, rooms.fields) === scopeHash({ ...rooms.subject }, structuredClone(rooms.fields)) && scopeHash(rooms.subject, rooms.fields) !== scopeHash({ ...rooms.subject, vault: "home@uni.example" }, rooms.fields));

console.log("── someone who can write the vault (a token, an agent, the hub itself) but has no key");
attempt("Changes the applet's code and leaves the approval", decide(fresh(), evil, nov), false);
attempt("Leaves the applet's code and changes a component it imports", decide(fresh(), evilImport, nov), false);
attempt("Swaps the contents of two components it imports", decide(fresh(), swapped, nov), false);
attempt("Changes the code and edits the hash inside the approval to match", decide(fresh(), evil, (() => { const f = structuredClone(nov); f.fields.approval.event.content = f.fields.approval.event.content.replace(hashesOf(rooms).code, hashesOf(evil).code); return f; })()), false);
attempt("Changes the code and signs a fresh approval with a key of their own", decide(fresh(), evil, approve(attacker, rooms.subject, 0, yes(evil), "2026-11-17T00:00:00.000Z")), false);
attempt("The same, against a client that already runs Rooms", decide(whoSaw([[rooms, nov]]), evil, approve(attacker, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")), false);
attempt("After that try, the real Rooms on that client", (() => { const c = whoSaw([[rooms, nov]]); decide(c, evil, approve(attacker, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")); return decide(c, rooms, nov); })(), true, "A stranger's record can't push out the approval a client holds.");
attempt("Writes a key list naming their own key as the approval key, signed by themselves, then approves with it", (() => { const c = fresh(); readKeys(c, keyList(attacker, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(attacker) }], "2026-11-17T00:00:00.000Z")); return decide(c, evil, approve(attacker, rooms.subject, 0, yes(evil), "2026-11-17T00:00:00.000Z")); })(), false);
attempt("Edits the real key list (signed by your root) to name their key, then approves with it", (() => { const c = client(pub(root)); const l = structuredClone(list1); l.fields.keys.event.content = l.fields.keys.event.content.replace(pub(approval), pub(attacker)); readKeys(c, l); return decide(c, evil, approve(attacker, rooms.subject, 0, yes(evil), "2026-11-17T00:00:00.000Z")); })(), false);
attempt("Widens what the applet asks (another server, another kind it may sign), same code", decide(fresh(), wider, nov), false);
attempt("Copies Rooms' approval onto another applet's path", decide(fresh(), scratch, { ...nov, path: "Parachute/Approvals/uni.example/home/01M7SCRATCH" }), false);
attempt("ROLLBACK: puts back October's approval and October's code, on a client that saw November's", decide(whoSaw([[rooms, nov]]), october, oct), false);
attempt("Puts back the approval after you withdrew it, on a client that saw the withdrawal", decide(whoSaw([[rooms, nov], [rooms, off]]), rooms, nov), false);
attempt("Deletes every approval, on a client that had read them", decide(whoSaw([[rooms, nov]]), rooms, null), true, "A client keeps what it verified. Deleting stops nothing that ran, and starts nothing.");
attempt("Deletes every approval, on a new client", decide(fresh(), rooms, null), false, "It asks. A nuisance, not a breach.");
attempt("GAP: hides your withdrawal from a client that has not seen it yet, and goes on serving November's approval", decide(whoSaw([[rooms, nov]]), rooms, nov), true, "No client can see what it is not shown. It keeps running code you approved, until the approval's year ends.");
attempt("GAP: on a brand-new client, serves October's approval with October's code", decide(fresh(), october, oct), true, "Code you did approve, asking what you approved. Never new code.");

console.log("── someone who also holds your EVERYDAY key (it signs sign-ins and chat; other software holds it too)");
attempt("Signs an approval for new code with the everyday key", decide(fresh(), evil, approve(everyday, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")), false, "The key list gives that key the everyday role only.");
attempt("Signs a new key list with the everyday key that promotes itself", (() => { const c = fresh(); readKeys(c, keyList(everyday, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(everyday) }], "2026-11-17T00:00:00.000Z")); return decide(c, evil, approve(everyday, rooms.subject, 0, yes(evil), "2026-11-17T00:00:00.000Z")); })(), false);

attempt("A key list (really signed by your root) that gives the everyday key both roles; then the everyday key approves", (() => { const c = client(pub(root)); readKeys(c, keyList(root, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(everyday) }], "2026-10-01T00:00:00.000Z")); return decide(c, evil, approve(everyday, rooms.subject, 0, yes(evil), "2026-11-17T00:00:00.000Z")); })(), false, "One key can't hold two roles: such a list is not taken.");

console.log("── two approving devices at once, lost counters");
const a2 = approve(approval, rooms.subject, nOf(oct), yes(rooms), "2026-11-02T00:00:00.000Z");
const w2 = approve(approval, rooms.subject, nOf(oct), { approved: false }, "2026-11-02T00:00:00.000Z");
check("Two devices sign at the same second without reading each other: the two get the same number", nOf(a2) === nOf(w2));
attempt("A client that saw the withdrawal of that pair is shown the approval of that pair", decide(whoSaw([[rooms, w2]]), rooms, a2), false, "It keeps the one it saw. The vault's own write check makes the second signer read again and sign a higher number.");
attempt("An approving device that lost everything re-approves; a client that held November's reads it", decide(whoSaw([[rooms, nov]]), rooms, approve(approval, rooms.subject, 0, yes(rooms), "2026-11-17T00:00:00.000Z")), true, "The number is the signing time when that is larger, so a device with no memory still signs higher.");

attempt("Your own laptop, its clock set to 2040, signs an approval; then the phone signs the real next one", (() => { const c = whoSaw([[rooms, nov]]); decide(c, rooms, approve(approval, rooms.subject, 0, yes(rooms), "2040-01-01T00:00:00.000Z")); return decide(c, october, approve(approval, rooms.subject, nOf(nov), yes(october), "2026-11-17T00:00:00.000Z")); })(), true, "A number from the future is refused, so it can't stand in the way of every later approval.");

console.log("── rotating keys (the list is signed by the root key, kept offline)");
const approval2 = generateSecretKey();
const list2 = keyList(root, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(approval2) }], "2026-11-15T00:00:00.000Z");
const rotated = () => { const c = whoSaw([[rooms, nov]]); readKeys(c, list2); return c; };
attempt("The phone is stolen. A new list names a new approval key. The thief approves new code with the old key", decide(rotated(), evil, approve(approval, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")), false);
attempt("What the old key approved before, on a client that has read the new list", decide(rotated(), rooms, nov), false, "It stops counting the moment the client reads the new list.");
attempt("The same applet, approved again with the new key", decide(rotated(), rooms, approve(approval2, rooms.subject, nOf(nov), yes(rooms), "2026-11-16T00:00:00.000Z")), true);
attempt("A key list numbered from 2040 is read; then the real new list", (() => { const c = whoSaw([[rooms, nov]]); readKeys(c, keyList(root, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(approval) }], "2040-01-01T00:00:00.000Z")); readKeys(c, list2); return decide(c, october, approve(approval2, rooms.subject, nOf(nov), yes(october), "2026-11-16T00:00:00.000Z")); })(), true, "The list from the future is not taken, so it can't stand in the way of the real one.");
attempt("Someone puts the old key list back, to bring the stolen key back", (() => { const c = rotated(); readKeys(c, list1); return decide(c, evil, approve(approval, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")); })(), false);
attempt("GAP: the new key list is hidden from a client; the thief also writes the vault, and approves new code with the stolen key", decide(whoSaw([[rooms, nov]]), evil, approve(approval, rooms.subject, nOf(nov), yes(evil), "2026-11-17T00:00:00.000Z")), true, "A stolen approval key plus a vault that hides the new list. Why the list also goes to the relay, and why a client warns when the two differ.");

attempt("The thief, before you rotate, signs Rooms with a number from the far future, to block every later approval", (() => { const c = whoSaw([[rooms, nov]]); decide(c, rooms, approve(approval, rooms.subject, 8e15, yes(rooms), "2026-11-17T00:00:00.000Z")); readKeys(c, list2); return decide(c, rooms, approve(approval2, rooms.subject, nOf(nov), yes(rooms), "2026-11-17T12:00:00.000Z")); })(), true, "A number from the future is refused, and what a dropped key signed orders nothing.");
attempt("The thief got a real approval in before you rotated; then your re-approval with the new key", (() => { const c = whoSaw([[rooms, nov]]); const theirs = approve(approval, rooms.subject, nOf(nov), yes(evil), "2026-11-14T00:00:00.000Z"); decide(c, evil, theirs); readKeys(c, list2); return decide(c, rooms, approve(approval2, rooms.subject, 0, yes(rooms), "2026-11-13T00:00:00.000Z")); })(), true, "Even one numbered lower than the thief's: a dropped key's approvals don't count in the ordering.");
const both = keyList(root, [{ role: "everyday", key: pub(everyday) }, { role: "approval", key: pub(approval) }, { role: "approval", key: pub(approval2) }], "2026-11-14T00:00:00.000Z");
attempt("A planned change of approval key: a list naming both, before anything is signed again", (() => { const c = whoSaw([[rooms, nov]]); readKeys(c, both); return decide(c, rooms, nov); })(), true, "Nothing stops. Sign again with the new key, then drop the old one.");
attempt("An approval that claims to start in 2035 and end in 2036, signed by the real approval key", decide(fresh(), rooms, approve(approval, rooms.subject, 0, { ...yes(rooms), expires: "2036-11-02T00:00:00.000Z", at: "2035-11-02T00:00:00.000Z" }, "2026-11-02T00:00:00.000Z")), false);
attempt("A ten-year approval, signed by the real approval key", decide(fresh(), rooms, approve(approval, rooms.subject, 0, yes(rooms, { expires: "2036-11-02T00:00:00.000Z" }), "2026-11-02T00:00:00.000Z")), false);

console.log("── every kind of vault code: a component on a page, your own frame");
const widget = { subject: { hub: "https://techne.example", vault: "techne", record: "01M7WIDGET", applet: "events", kind: "component" }, source: "function EventsWidget(){}", fields: { component: { contract: 1, id: "events" } } };
const frame = { subject: { ...rooms.subject, record: "01M7FRAME", applet: "frame", kind: "frame" }, source: "function Frame(){}", fields: { frame: { based_on: "1.4.0" } } };
const wOk = approve(approval, widget.subject, 0, yes(widget, { whose: "theirs" }), "2026-11-10T00:00:00.000Z");
attempt("Techne's Events component on your home page, approved", decide(fresh(), widget, wOk), true);
attempt("Your own frame, changed in the vault (your agent's token, or a thief's), with the old frame's approval", decide(fresh(), { ...frame, source: "function Frame(){ moveTheBar() }" }, approve(approval, frame.subject, 0, yes(frame), "2026-11-10T00:00:00.000Z")), false);
attempt("A record approved as a component, offered to the app as its frame", decide(fresh(), { ...widget, subject: { ...widget.subject, kind: "frame" } }, wOk), false);

console.log("── someone else's vault (Techne), and other limits");
const ev = approve(approval, events.subject, 0, yes(events, { whose: "theirs" }), "2026-11-10T00:00:00.000Z");
attempt("Techne's Events, approved on the phone, on a laptop that also says techne is someone else's", decide(fresh(), events, ev), true);
attempt("Techne changes Events", decide(fresh(), { ...events, source: "function Events(){ more() }" }, ev), false);
attempt("Approved as someone else's; this device was told techne is the person's own (it would get more here)", decide(fresh({ whose: () => "mine" }), events, ev), false);
attempt("The approval's year ran out", decide(fresh({ now: Date.parse("2027-12-01T00:00:00Z") }), rooms, nov), false);
attempt("A client with no anchor (a browser tab)", decide(client(null), rooms, nov), false);
attempt("A hub on a port (localhost:1939)", (() => { const a = { ...rooms, subject: { ...rooms.subject, hub: "http://localhost:1939" } }; return decide(fresh({ whose: () => "mine" }), a, approve(approval, a.subject, 0, yes(a), "2026-11-10T00:00:00.000Z")); })(), true);

console.log(bad ? `${bad} NOT as the design says` : "all as the design says");
process.exit(bad ? 1 : 0);
