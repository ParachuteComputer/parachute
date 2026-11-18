// The approval rule played against attacks, with real keys and signatures made here and thrown away. Each line is an
// attempt, what the client decided, and whether that is what the design says.   node <path>/attacks.mjs
import { approve, checker, generateSecretKey, getPublicKey } from "./lib.mjs";
const { decide } = checker();

const approvalKey = generateSecretKey(), everydayKey = generateSecretKey(), attackerKey = generateSecretKey();
const rooms = { hub: "https://uni.example", vault: "home", record: "01M7ROOMSAPPLET", applet: "rooms" };
const scratch = { ...rooms, record: "01M7SCRATCH", applet: "scratch" };
const events = { hub: "https://techne.example", vault: "techne", record: "01M7EVENTS", applet: "events" };
const h = (x) => x.padEnd(64, "0");
const OLD = "tsx:" + h("0001"), NEW = "tsx:" + h("0002"), EVIL = "tsx:" + h("bad0"), ASKS = h("a5c5"), MORE = h("f00d");
const body = (code, scope = ASKS, extra = {}) => ({ approved: true, code, scope, modes: ["sealed"], whose: "mine", expires: "2027-11-01T00:00:00.000Z", face: ["…"], others: [], ...extra });
const WHEN = "2026-11-01T00:00:00.000Z";

const v1 = approve(approvalKey, rooms, 1, null, body(OLD), WHEN);
const v2 = approve(approvalKey, rooms, 2, v1.fields.approval.event.id, body(NEW), WHEN);
const off = approve(approvalKey, rooms, 3, v2.fields.approval.event.id, { approved: false }, WHEN);

/** A client: `seen` is what it remembers; `paired` gives a new client the newest counters from the one it paired with. */
const client = (seen = {}, o = {}) => ({ approvalKey: getPublicKey(approvalKey), seen: { ...seen }, mode: "sealed", whose: (s) => (s.hub === "https://uni.example" ? "mine" : "theirs"), now: Date.parse("2026-11-18T00:00:00Z"), ...o });
const R = "https://uni.example/home/01M7ROOMSAPPLET";
const applet = (code, scope = ASKS, subject = rooms) => ({ subject, code, scope });

let bad = 0;
function attempt(what, got, wantRun, note = "") {
  const right = got.run === wantRun;
  if (!right) bad++;
  console.log(`${right ? "ok  " : "FAIL"} ${what}\n       → ${got.run ? "RUNS" : "does not run: " + got.why}${note ? "\n       " + note : ""}`);
}

console.log("── the ordinary path");
attempt("Approved on the phone; the laptop reads the record and hashes the code itself", decide(client(), applet(NEW), v2), true);
attempt("No approval record at all (never approved, or someone deleted it)", decide(client(), applet(NEW), null), false, "Deleting approvals only makes clients ask.");

console.log("── someone who can write the vault (a token, the hub) but has no key");
attempt("Changes the applet's code and leaves the approval", decide(client(), applet(EVIL), v2), false);
attempt("Changes the code and edits the hash inside the approval to match", decide(client(), applet(EVIL), (() => { const f = structuredClone(v2); f.fields.approval.event.content = f.fields.approval.event.content.replace(NEW, EVIL); return f; })()), false);
attempt("Changes the code and signs a fresh approval with a key of their own", decide(client(), applet(EVIL), approve(attackerKey, rooms, 9, null, body(EVIL), WHEN)), false);
attempt("Widens what the applet asks (a new server, a new folder), same code", decide(client(), applet(NEW, MORE), v2), false);
attempt("Copies Rooms' approval onto another applet's path", decide(client(), applet(NEW, ASKS, scratch), { ...v2, path: "Parachute/Approvals/uni.example/home/01M7SCRATCH" }), false);
attempt("Puts back last month's approval and last month's code, on a client that saw the new one", decide(client({ [R]: 2 }), applet(OLD), v1), false);
attempt("Deletes the withdrawal and puts back the approval, on a client that saw the withdrawal", decide(client({ [R]: 3 }), applet(NEW), v2), false);
attempt("The same, on a NEW client that was paired from one that saw the withdrawal", decide(client({ [R]: 3 }), applet(NEW), v2), false, "Pairing hands over the newest counters with the key.");
attempt("The same, on a new client that got no counters (pasted key, not paired)", decide(client(), applet(NEW), v2), true, "The stated gap: it runs code you did once approve, with asks you did approve. Never new code.");
attempt("Makes a ten-year approval out of nothing", decide(client(), applet(NEW), approve(attackerKey, rooms, 5, null, body(NEW, ASKS, { expires: "2036-11-01T00:00:00.000Z" }), WHEN)), false);

console.log("── someone who also holds the EVERYDAY key (it signs sign-ins and chat; other software holds it too)");
attempt("Signs an approval for new code with the everyday key", decide(client(), applet(EVIL), approve(everydayKey, rooms, 9, null, body(EVIL), WHEN)), false, "Only when the approval key is a separate key. While it is the everyday key, this RUNS: see the design.");

console.log("── the person's own later acts");
attempt("Withdrawn on the phone; the laptop reads the withdrawal", decide(client({ [R]: 2 }), applet(NEW), off), false);
attempt("The approval's year ran out", decide(client({}, { now: Date.parse("2027-12-01T00:00:00Z") }), applet(NEW), v2), false);
attempt("A new approval key after a lost phone; the old key's approvals", decide(client({}, { approvalKey: getPublicKey(generateSecretKey()) }), applet(NEW), v2), false, "Every approval by the lost key is void at once on a client given the new key.");
attempt("A client with no approval key to check against (a browser tab)", decide(client({}, { approvalKey: null }), applet(NEW), v2), false);

console.log("── someone else's vault (Techne)");
const ev = approve(approvalKey, events, 1, null, body(OLD, ASKS, { whose: "theirs" }), WHEN);
attempt("Techne's Events, approved on the phone; the laptop also says techne is someone else's", decide(client(), applet(OLD, ASKS, events), ev), true);
attempt("Techne changes Events", decide(client(), applet(EVIL, ASKS, events), ev), false);
attempt("Approved as someone else's; this client was told techne is the person's own (more power here)", decide(client({}, { whose: () => "mine" }), applet(OLD, ASKS, events), ev), false);
attempt("Approved under sealed; this client's sandbox is weaker (approved-code mode)", decide(client({}, { mode: "approved-code" }), applet(NEW), v2), false);

console.log(bad ? `${bad} NOT as the design says` : "all as the design says");
process.exit(bad ? 1 : 0);
