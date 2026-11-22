// parachute-canary: once a day, the services a person's Parachute stands on, checked for real with a test identity of
// its own (never the person's key, rooms or notes). Each check is one thing the app does every day:
//   relay     the test key signs in, posts a made-up line in its own private room, and reads it back
//   card      a made-up "Uni" key seals an approval card to the test key in that room; the test key checks it as the app
//             does and answers Approve (gift wrap, rumor 46042); the made-up Uni opens the answer as Uni does
//   vault     a note written to the test vault on the hub, read back the same, then deleted
//   push      the test key registers a push endpoint of its own with the push gateway (renewed each day, as the app
//             does), the made-up Uni names it in their room, and the sealed push arrives through the push server
//             (ntfy, UnifiedPush) and opens with the endpoint's keys, naming that room and message
//   mail      the mail gateway answers a signed request: it refuses the test key by its own check ("pubkey not allowed",
//             said only after the signature checked out)
//   calendar  the calendar door, the same
//   updates   the update feed builds read (src/shell/updates.ts) is a feed, and each file it names is there to download
//   services  the last Services run on next (every real-server spec, in CI) passed and is under two days old; then it
//             starts today's
// Unset services are not checked. Prints one line, the counts; what failed and why goes to CANARY_LOG (mode 600).
// Exits 1 when anything failed, so a timer's failure alert fires.
//
//   CANARY_ENV=<file> node scripts/canary.ts      (or the variables in the environment)
// CANARY_KEYS     a folder (mode 700) with canary.hex (the test person), uni.hex (its made-up Uni), room (their room's id)
// CANARY_RELAY    wss://…           CANARY_HUB  https://… (the hub)    CANARY_VAULT  the test vault
// CANARY_HUB_KEY  a file with a write key for that vault (the token, or `parachute keys new --json`'s output)
// CANARY_PUSH     the push gateway's base URL; CANARY_PUSH_KEY its relay key (the canary adds it to its room);
//                 CANARY_NTFY the push server (ntfy) its endpoint is on, read with the user `CANARY_NTFY_USER` (default
//                 canary, read-only on topics upcanary*) and the password in CANARY_KEYS/ntfy.pw
// CANARY_MAIL     the mail gateway's /mail/ URL      CANARY_CAL  the calendar door's base URL
// CANARY_FEED     the update feed's address (the latest.json builds are made with: PARACHUTE_UPDATE_FEED)
// CANARY_REPO     owner/repo whose Services workflow it reads and starts (needs `gh` signed in)
// CANARY_LOG      where the details go (default ~/.local/state/parachute-canary/last.log)
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { person } from "../e2e/services/client.ts";
import { checkCard, makeCard, openAnswer, replyWrap, sealPub } from "../src/services/e2eCards.ts";
import { b64u, decrypt } from "../services/push-gateway/src/webpush.ts";
import { parseFeed } from "../src/shell/feed.ts";

if (process.env.CANARY_ENV) for (const line of readFileSync(process.env.CANARY_ENV, "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const E = process.env;
const LOG = E.CANARY_LOG || join(E.HOME ?? ".", ".local/state/parachute-canary/last.log");
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, `parachute-canary ${new Date().toISOString()}\n`, { mode: 0o600 });
chmodSync(LOG, 0o600);
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
/** A request whose answer, body and all, comes within `ms`. */
const get = (url: string | URL, init: RequestInit = {}, ms = 15_000) => fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms) });
const under = (base: string, path: string) => `${base.replace(/\/$/, "")}/${path}`;

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
    const r = await get(under(E.CANARY_HUB!, `vault/${E.CANARY_VAULT}/api/${path}`), { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, 20_000);
    if (!r.ok) throw new Error(`${method} ${path.split("?")[0]}: ${r.status}`);
    return await r.json() as Record<string, unknown>;
  };
  const content = `Made-up: the canary was here ${randomBytes(4).toString("hex")}.`;
  const made = await api("POST", "notes", { path: `Canary/${new Date().toISOString().replace(/[:.]/g, "-")}`, content });
  let read: unknown = null;
  try {
    const back = await api("GET", `notes?id=${encodeURIComponent(String(made.id))}`);
    if (back.content !== content) read = new Error("the note read back differs from the one written");
  } catch (e) { read = e; }
  // the cleanup's own failure is said apart, never in place of the read's
  try { await api("DELETE", `notes/${made.id}`); } catch (e) { log(`  vault: couldn't delete the note: ${e instanceof Error ? e.message : String(e)}`); if (!read) read = e; }
  if (read) throw read;
} });

if (E.CANARY_PUSH && E.CANARY_NTFY && E.CANARY_KEYS && E.CANARY_RELAY) checks.push({ name: "push", run: async () => {
  const relay = E.CANARY_RELAY!, room = readKey("room"), canarySk = bytes(readKey("canary.hex")), me = getPublicKey(canarySk);
  // the endpoint's keys and topic, made once and kept (as a phone keeps its own)
  const devFile = join(E.CANARY_KEYS!, "push.json");
  if (!existsSync(devFile)) {
    const d = createECDH("prime256v1"); d.generateKeys();
    writeFileSync(devFile, JSON.stringify({ topic: `upcanary${randomBytes(6).toString("hex")}`, priv: b64u.encode(d.getPrivateKey()), pub: b64u.encode(d.getPublicKey()), auth: b64u.encode(randomBytes(16)) }), { mode: 0o600 });
  }
  const dev = JSON.parse(readFileSync(devFile, "utf8")) as { topic: string; priv: string; pub: string; auth: string };
  const endpoint = `${under(E.CANARY_NTFY!, dev.topic)}?up=1`;
  // the gateway is in the room (its creator, the test key, adds it; already there is fine)
  const [c, uni] = await within(Promise.all([person(relay, readKey("canary.hex")), person(relay, readKey("uni.hex"))]), 20_000, "sign-in");
  const ctl = new AbortController();
  try {
    if (E.CANARY_PUSH_KEY) {
      const r = await within(c.publish({ kind: 9000, tags: [["h", room], ["p", E.CANARY_PUSH_KEY]] }), 20_000, "add the gateway");
      if (!r.ok) log(`  push: adding the gateway to the room: ${r.msg}`);
    }
    // listen on the push server first, as the phone's distributor does
    const pw = readKey("ntfy.pw"), user = E.CANARY_NTFY_USER || "canary";
    const sub = await get(`${under(E.CANARY_NTFY!, dev.topic)}/json`, { headers: { authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}` }, signal: ctl.signal } as RequestInit, 300_000).catch((e) => { throw new Error(`the push server: ${e instanceof Error ? e.message : String(e)}`); });
    if (!sub.ok || !sub.body) throw new Error(`the push server answered ${sub.status}`);
    const got: Uint8Array[] = [];
    let opened!: () => void; const open = new Promise<void>((r) => { opened = r; });
    let closed = false;
    void (async () => { const rd = sub.body!.getReader(); let buf = ""; try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += new TextDecoder().decode(value); let i;
      while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.event === "open") opened();
        if (m.event === "message") got.push(m.encoding === "base64" ? new Uint8Array(Buffer.from(m.message, "base64")) : new TextEncoder().encode(m.message)); } } } catch { /* cut */ } closed = true; })();
    await within(open, 15_000, "the push server's stream");
    // register (renews its 30 days), signed as the app signs it
    const regUrl = under(E.CANARY_PUSH!, "register");
    const body = JSON.stringify({ endpoint, keys: { p256dh: dev.pub, auth: dev.auth }, relay, rooms: [room], mentions: true, from: [] });
    const reg = await get(regUrl, { method: "POST", headers: { authorization: nip98(canarySk, regUrl, "POST", body), "content-type": "application/json" }, body });
    if (!reg.ok) throw new Error(`register: ${reg.status} ${(await reg.text()).slice(0, 80)}`);
    // the gateway confirms the key from the room's member list; give it a moment, then the made-up Uni names it
    await sleep(8000);
    let posted = "", why = "";
    for (let tries = 0; tries < 3 && !why; tries++) {
      const r = await within(uni.publish({ kind: 9, content: `Made-up: canary, are you there? ${randomBytes(3).toString("hex")}`, tags: [["h", room], ["p", me]] }), 20_000, "mention");
      if (!r.ok) throw new Error(`the relay refused the mention: ${r.msg}`);
      posted = r.ev.id;
      const end = Date.now() + 30_000;
      while (Date.now() < end && !why) {
        for (const m of got.splice(0)) {
          try {
            const p = JSON.parse(new TextDecoder().decode(decrypt(m, b64u.decode(dev.priv), b64u.decode(dev.auth)))) as { room?: string; event?: string; to?: string; why?: string };
            if (p.room === room && p.event === posted && p.to === me) why = p.why ?? "?";
          } catch { /* not ours, or not for this key */ }
        }
        if (!why && closed) throw new Error("the push server's stream closed");
        if (!why) await sleep(500);
      }
    }
    if (!why) throw new Error("no push for the mention reached the push server's topic");
  } finally { ctl.abort(); c.close(); uni.close(); }
} });

/** A service that checks NIP-98 refuses the test key, and says so only after the signature checked out. */
async function refusesByItsCheck(url: string, method: "GET" | "POST", body?: string) {
  const r = await get(url, { method, headers: { authorization: nip98(bytes(readKey("canary.hex")), url, method, body), "content-type": "application/json" }, body });
  const said = await r.text();
  if (r.status !== 401 || !said.includes("pubkey not allowed")) throw new Error(`a key it doesn't know got ${r.status} ${said.slice(0, 60)}, not its refusal`);
}
if (E.CANARY_MAIL && E.CANARY_KEYS) checks.push({ name: "mail", run: () => refusesByItsCheck(under(E.CANARY_MAIL!, "session"), "POST", "{}") });
if (E.CANARY_CAL && E.CANARY_KEYS) checks.push({ name: "calendar", run: () => refusesByItsCheck(under(E.CANARY_CAL!, "cal/v1/session"), "GET") });

if (E.CANARY_FEED) checks.push({ name: "updates", run: async () => {
  const r = await get(E.CANARY_FEED!);
  if (!r.ok) throw new Error(`the feed answered ${r.status}`);
  const feed = parseFeed(await r.text(), E.CANARY_FEED!);
  if (!feed || !Object.keys(feed.files).length) throw new Error("the feed isn't one, or names no file on its own origin");
  for (const [platform, url] of Object.entries(feed.files)) {
    const f = await get(url, { method: "HEAD" });
    if (!f.ok) throw new Error(`${platform}'s file answered ${f.status}`);
  }
} });

if (E.CANARY_REPO) checks.push({ name: "services", run: async () => {
  const gh = (...a: string[]) => execFileSync("gh", ["-R", E.CANARY_REPO!, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  // today's run first, so a failed read below can't keep tomorrow's from having one (the list holds finished runs only)
  gh("workflow", "run", "services.yml", "--ref", "next");
  // the newest run this account started that finished (one cancelled by a newer start says nothing either way; a
  // dispatch by hand with another core is someone's experiment). When next is promoted to main, the schedule runs it.
  const runs = (JSON.parse(gh("run", "list", "--workflow", "services.yml", "--branch", "next", "--event", "workflow_dispatch", "--user", execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim(), "--status", "completed", "--limit", "10", "--json", "conclusion,createdAt,url")) as { conclusion: string; createdAt: string; url: string }[])
    .filter((r) => r.conclusion !== "cancelled" && r.conclusion !== "skipped");
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
  catch (e) { failed.push(c.name); log(`FAIL  ${c.name}: ${(e instanceof Error ? e.message : String(e)).split("\n").slice(0, 2).join(" ").slice(0, 300)}`); }
}
console.log(`parachute-canary: ${passed} passed, ${failed.length} failed`);
process.exit(failed.length || !checks.length ? 1 : 0);
