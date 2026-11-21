// parachute-canary: once a day, the services a person's Parachute stands on, checked for real with a test identity of
// its own (never the person's key, rooms or notes). Each check is one thing the app does every day:
//   relay     the test key signs in, posts a made-up line in its own private room, and reads it back
//   card      a made-up "Uni" key seals an approval card to the test key in that room; the test key checks it as the app
//             does and answers Approve (gift wrap, rumor 46042); the made-up Uni opens the answer as Uni does
//   vault     a note written to the test vault on the hub, read back the same, then deleted
//   push      the push gateway answers its health and is connected to the relay
//   mail      the mail gateway answers a signed request (the test key isn't let in: 401 or 403 is the right answer)
//   calendar  the calendar door answers a signed request (the same: the test key is refused, by the door's own check)
//   services  the last Services run on next (every real-server spec, in CI) passed and is under two days old; then it
//             starts today's
// Unset services are not checked. Prints one line, the counts; what failed and why goes to CANARY_LOG (mode 600).
// Exits 1 when anything failed, so a timer's failure alert fires.
//
//   CANARY_ENV=<file> node scripts/canary.ts      (or the variables in the environment)
// CANARY_KEYS     a folder (mode 700) with canary.hex (the test person), uni.hex (its made-up Uni), room (their room's id)
// CANARY_RELAY    wss://…           CANARY_HUB  https://… (the hub)    CANARY_VAULT  the test vault
// CANARY_HUB_KEY  a file with a write key for that vault (the token, or `parachute keys new --json`'s output)
// CANARY_PUSH     the push gateway's base URL   CANARY_MAIL  the mail gateway's /mail/ URL   CANARY_CAL  the door's base URL
// CANARY_REPO     owner/repo whose Services workflow it reads and starts (needs `gh` signed in)
// CANARY_LOG      where the details go (default ~/.local/state/parachute-canary/last.log)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { person } from "../e2e/services/client.ts";
import { checkCard, makeCard, openAnswer, replyWrap, sealPub } from "../src/services/e2eCards.ts";

if (process.env.CANARY_ENV) for (const line of readFileSync(process.env.CANARY_ENV, "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const E = process.env;
const LOG = E.CANARY_LOG || join(E.HOME ?? ".", ".local/state/parachute-canary/last.log");
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, `parachute-canary ${new Date().toISOString()}\n`, { mode: 0o600 });
const log = (s: string) => appendFileSync(LOG, `${s}\n`);

const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const readKey = (name: string) => readFileSync(join(E.CANARY_KEYS!, name), "utf8").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, j) => { t = setTimeout(() => j(new Error(`${what}: no answer in ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}
/** A NIP-98 header for one request, as the app's shell signs one. */
function nip98(sk: Uint8Array, url: string, method: string, body?: string) {
  const tags = [["u", url], ["method", method], ["nonce", randomBytes(8).toString("hex")]];
  if (body !== undefined) tags.push(["payload", createHash("sha256").update(body).digest("hex")]);
  return `Nostr ${Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: now(), content: "", tags }, sk))).toString("base64")}`;
}
const refused = (s: number) => s === 401 || s === 403;

type Check = { name: string; run: () => Promise<void> };
const checks: Check[] = [];

if (E.CANARY_KEYS && E.CANARY_RELAY) {
  const relay = E.CANARY_RELAY;
  const room = readKey("room");
  checks.push({ name: "relay", run: async () => {
    const me = await within(person(relay, readKey("canary.hex")), 20_000, "sign-in");
    try {
      const line = `canary ${new Date().toISOString().slice(0, 10)} ${randomBytes(4).toString("hex")}`;
      const sent = await within(me.publish({ kind: 9, content: line, tags: [["h", room]] }), 20_000, "post");
      if (!sent.ok) throw new Error(`the relay refused the post: ${sent.msg}`);
      const back = await within(me.query({ kinds: [9], "#h": [room], ids: [sent.ev.id] }), 20_000, "read");
      if (back.length !== 1 || back[0].content !== line) throw new Error(`read back ${back.length} events, not the one posted`);
    } finally { me.close(); }
  } });
  checks.push({ name: "card", run: async () => {
    const canarySk = bytes(readKey("canary.hex")), uniSk = bytes(readKey("uni.hex"));
    const [me, uni] = await within(Promise.all([person(relay, readKey("canary.hex")), person(relay, readKey("uni.hex"))]), 20_000, "sign-in");
    try {
      const since = now() - 1200;
      const card = makeCard({ uni: uniSk, sealPubHex: sealPub(canarySk), room, credential: "canary-cred", action: "job.canary",
        scope: "Made-up: the daily canary's card", payload: { v: 1, day: new Date().toISOString().slice(0, 10) }, class: "routine", ttl_s: 60 });
      const posted = await within(uni.send(card.event), 20_000, "card");
      if (!posted.ok) throw new Error(`the relay refused the card: ${posted.msg}`);
      // the test person reads the card from its room and checks it as the app does, then approves
      const got = (await within(me.query({ kinds: [9], "#h": [room], ids: [card.event.id] }), 20_000, "read card"))[0];
      if (!got) throw new Error("the card didn't come back from the room");
      const checked = checkCard(got as never, [getPublicKey(uniSk)], canarySk);
      const answer = replyWrap(canarySk, got as never, checked.rows[0], "approve");
      const sent = await within(me.send(answer as never), 20_000, "answer");
      if (!sent.ok) throw new Error(`the relay refused the answer: ${sent.msg}`);
      // the made-up Uni finds the answer addressed to it and opens it as Uni does
      let opened: { decision: string } | undefined;
      for (let i = 0; i < 10 && !opened; i++) {
        const wraps = await within(uni.query({ kinds: [1059], "#p": [getPublicKey(uniSk)], since }), 20_000, "read answer");
        for (const w of wraps) { try { opened = openAnswer(w as never, card.rsk, getPublicKey(canarySk), { id: card.event.id, rid: card.fields.rid, requestDigest: card.requestDigest }); } catch { /* another card's */ } }
        if (!opened) await sleep(1000);
      }
      if (opened?.decision !== "approve") throw new Error("the answer didn't reach the made-up Uni");
    } finally { me.close(); uni.close(); }
  } });
}

if (E.CANARY_HUB && E.CANARY_VAULT && E.CANARY_HUB_KEY) checks.push({ name: "vault", run: async () => {
  const raw = readFileSync(E.CANARY_HUB_KEY!, "utf8").trim();
  const token = raw.startsWith("{") ? (JSON.parse(raw) as { token: string }).token : raw;
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await within(fetch(`${E.CANARY_HUB!.replace(/\/$/, "")}/vault/${E.CANARY_VAULT}/api/${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), 20_000, `${method} ${path.split("?")[0]}`);
    if (!r.ok) throw new Error(`${method} ${path.split("?")[0]}: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  const content = `Made-up: the canary was here ${randomBytes(4).toString("hex")}.`;
  const made = await api("POST", "notes", { path: `Canary/${new Date().toISOString().replace(/[:.]/g, "-")}`, content });
  try {
    const back = await api("GET", `notes?id=${encodeURIComponent(String(made.id))}`);
    if (back.content !== content) throw new Error("the note read back differs from the one written");
  } finally { await api("DELETE", `notes/${made.id}`); }
} });

if (E.CANARY_PUSH) checks.push({ name: "push", run: async () => {
  const r = await within(fetch(new URL("health", E.CANARY_PUSH)), 15_000, "health");
  const h = await r.json() as { ok?: boolean; relays?: { relay: string; rooms: number }[] };
  if (!r.ok || h.ok !== true) throw new Error(`health ${r.status}`);
  if (!h.relays?.length) throw new Error("the gateway watches no relay");
} });

if (E.CANARY_MAIL && E.CANARY_KEYS) checks.push({ name: "mail", run: async () => {
  const url = new URL("session", E.CANARY_MAIL).toString(), body = "{}";
  const r = await within(fetch(url, { method: "POST", headers: { authorization: nip98(bytes(readKey("canary.hex")), url, "POST", body), "content-type": "application/json" }, body }), 15_000, "session");
  if (!refused(r.status)) throw new Error(`a key it doesn't know got ${r.status}, not 401 or 403`);
} });

if (E.CANARY_CAL && E.CANARY_KEYS) checks.push({ name: "calendar", run: async () => {
  const url = `${E.CANARY_CAL.replace(/\/$/, "")}/cal/v1/session`;
  const r = await within(fetch(url, { headers: { authorization: nip98(bytes(readKey("canary.hex")), url, "GET") } }), 15_000, "session");
  const said = await r.text();
  // "pubkey not allowed" is the door's answer after the signature checked out; any other 401 means it didn't
  if (r.status !== 401 || !said.includes("pubkey not allowed")) throw new Error(`a key it doesn't know got ${r.status}, not the door's refusal`);
} });

if (E.CANARY_REPO) checks.push({ name: "services", run: async () => {
  const gh = (...a: string[]) => execFileSync("gh", ["-R", E.CANARY_REPO!, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  const runs = JSON.parse(gh("run", "list", "--workflow", "services.yml", "--branch", "next", "--event", "workflow_dispatch", "--status", "completed", "--limit", "1", "--json", "conclusion,createdAt,url")) as { conclusion: string; createdAt: string; url: string }[];
  // today's run, started after the check: tomorrow's canary reads it
  gh("workflow", "run", "services.yml", "--ref", "next");
  const last = runs[0];
  if (!last) throw new Error("no completed Services run on next yet");
  log(`  services: last run ${last.url}`);
  if (last.conclusion !== "success") throw new Error(`the last Services run on next: ${last.conclusion}`);
  if (Date.now() - Date.parse(last.createdAt) > 48 * 3600_000) throw new Error(`the last Services run on next is from ${last.createdAt}`);
} });

let passed = 0;
const failed: string[] = [];
for (const c of checks) {
  try { await c.run(); passed++; log(`ok    ${c.name}`); }
  catch (e) { failed.push(c.name); log(`FAIL  ${c.name}: ${e instanceof Error ? e.message : String(e)}`); }
}
console.log(`parachute-canary: ${passed} passed, ${failed.length} failed`);
process.exit(failed.length || !checks.length ? 1 : 0);
