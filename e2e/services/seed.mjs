// Seeds the throwaway servers of e2e/services/compose.yml (run by up.sh, one step at a time). Every key and password is
// made up here, per run, and kept in the services folder (mode 600); nothing is printed.
//   node seed.mjs keys <dir>            the Nostr keys (owner, alice, bob, unibot), relay.env, stalwart.env
//   node seed.mjs mail-bootstrap <dir>  a fresh Stalwart's first setup (then up.sh restarts it)
//   node seed.mjs mail <dir>            alice, bob and uni@test.test; Uni's mail shared with alice; the gateway's config
//   node seed.mjs relay <dir>           the relay's owner lets alice, bob and Uni's key (unibot) in, as on a relay
//                                       people use: a spec connects them before it makes its rooms
//   node seed.mjs matrix <dir>          alice and bob on the homeserver, the Garden and Kitchen rooms, their tokens
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import WebSocket from "ws";

const [step, dir] = process.argv.slice(2);
if (!step || !dir) throw new Error("usage: node seed.mjs <keys|mail-bootstrap|mail|relay|matrix> <dir>");
const env = (k, d) => process.env[k] || d;
const STALWART = `https://127.0.0.1:${env("STALWART_PORT", "18443")}`;
const SETUP = `http://127.0.0.1:${env("STALWART_SETUP_PORT", "18080")}`;
const MATRIX = `http://127.0.0.1:${env("MATRIX_PORT", "18008")}`;
const RELAY = `ws://localhost:${env("RELAY_PORT", "3871")}`;
const MAIL_URL = `http://127.0.0.1:${env("MAIL_PORT", "19951")}`;
const CORE = "urn:ietf:params:jmap:core", MAIL = "urn:ietf:params:jmap:mail", STAL = "urn:stalwart:jmap";

const put = (f, v) => { mkdirSync(join(f, ".."), { recursive: true, mode: 0o700 }); writeFileSync(f, v, { mode: 0o600 }); };
const read = (f) => readFileSync(f, "utf8").trim();
const secret = (f, make) => { if (!existsSync(f)) put(f, make()); return read(f); };
const hex = (n) => randomBytes(n).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, tries = 90) {
  for (let i = 0; ; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) { if (i >= tries) throw e; }
    if (i >= tries) throw new Error(`timed out: ${what}`);
    await sleep(1000);
  }
}

// Stalwart's certificate is its own (self-signed): checked nowhere, as the gateway doesn't either; loopback only
function stalwart(path, user, pw, body) {
  return new Promise((res, rej) => {
    const r = request(`${STALWART}${path}`, { method: body ? "POST" : "GET", rejectUnauthorized: false,
      headers: { authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`, "content-type": "application/json" } }, (resp) => {
      let t = ""; resp.on("data", (c) => (t += c)); resp.on("end", () => { try { if (resp.statusCode >= 300) throw new Error(`${path} ${resp.statusCode}`); res(JSON.parse(t)); } catch (e) { rej(e); } });
    });
    r.on("error", rej); r.end(body ? JSON.stringify(body) : undefined);
  });
}
const session = (user, pw) => stalwart("/jmap/session", user, pw);
const jmap = async (user, pw, calls, using = [CORE, MAIL, STAL, "urn:ietf:params:jmap:principals"]) => {
  const out = (await stalwart("/jmap/", user, pw, { using, methodCalls: calls })).methodResponses;
  const err = out.find(([n]) => n === "error"); if (err) throw new Error(`${calls[0][0]}: ${JSON.stringify(err[1])}`);
  return out;
};

const keysDir = join(dir, "keys"), mailDir = join(dir, "mail"), mxDir = join(dir, "matrix");
const PEOPLE = ["owner", "alice", "bob", "unibot"];
const pub = (n) => getPublicKey(Uint8Array.from(Buffer.from(read(join(keysDir, `${n}.hex`)), "hex")));

if (step === "keys") {
  for (const n of PEOPLE) secret(join(keysDir, `${n}.hex`), () => Buffer.from(generateSecretKey()).toString("hex"));
  if (!existsSync(join(dir, "relay.env"))) put(join(dir, "relay.env"), `RELAY_OWNER_PUBKEY=${pub("owner")}\nBUZZ_RELAY_PRIVATE_KEY=${hex(32)}\n`);
  if (!existsSync(join(dir, "stalwart.env"))) put(join(dir, "stalwart.env"), `STALWART_RECOVERY_ADMIN=admin:${hex(16)}\n`);
} else if (step === "mail-bootstrap") {
  // a fresh Stalwart opens its setup port with the recovery admin; Bootstrap/set writes its config and makes the
  // domain's admin, whose password it answers with once
  const adminFile = join(mailDir, "secrets", "admin.pw");
  if (existsSync(adminFile)) process.exit(0);
  const [, rpw] = read(join(dir, "stalwart.env")).split("=")[1].split(":");
  const auth = `Basic ${Buffer.from(`admin:${rpw}`).toString("base64")}`;
  const call = async (calls) => (await (await fetch(`${SETUP}/jmap/`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ using: [CORE, STAL], methodCalls: calls }) })).json()).methodResponses;
  const acct = await until("Stalwart's setup port", async () => {
    const r = await fetch(`${SETUP}/jmap/session`, { headers: { authorization: auth } });
    return r.ok && Object.keys((await r.json()).accounts)[0];
  });
  const [[name, out]] = await call([["x:Bootstrap/set", { accountId: acct, update: { singleton: {
    serverHostname: "mail.test.test", defaultDomain: "test.test", requestTlsCertificate: false, generateDkimKeys: false } } }, "b"]]);
  const made = out.updated?.singleton;
  if (name !== "x:Bootstrap/set" || made?.username !== "admin@test.test" || !made.secret) throw new Error(`Stalwart bootstrap: ${name} ${JSON.stringify(Object.keys(out))}`);
  put(adminFile, made.secret);
} else if (step === "mail") {
  const admin = ["admin@test.test", read(join(mailDir, "secrets", "admin.pw"))];
  const s = await until("Stalwart after its setup", () => session(...admin));
  const aid = s.primaryAccounts[STAL];
  const [, [, doms]] = await jmap(...admin, [["x:Domain/query", { accountId: aid }, "q"], ["x:Domain/get", { accountId: aid, "#ids": { resultOf: "q", name: "x:Domain/query", path: "/ids" }, properties: ["name"] }, "g"]]);
  const domainId = doms.list.find((d) => d.name === "test.test").id;
  const pw = {};
  for (const n of ["alice", "bob", "uni"]) {
    pw[n] = secret(join(mailDir, "secrets", `${n}.pw`), () => hex(16));
    if (await session(`${n}@test.test`, pw[n]).catch(() => null)) continue;
    const [[, r]] = await jmap(...admin, [["x:Account/set", { accountId: aid, create: { u: { "@type": "User", name: n, domainId, credentials: { 0: { "@type": "Password", secret: pw[n] } } } } }, "c"]]);
    if (!r.created?.u) throw new Error(`Stalwart: ${n} not made: ${JSON.stringify(r.notCreated)}`);
  }
  // Uni's mailboxes shared with alice (read, seen, keywords), so her session lists Uni's account and the gateway can
  // give her key the owner-on-Uni operations
  const acct = async (n) => (await until(`${n}'s session`, () => session(`${n}@test.test`, pw[n]))).primaryAccounts[MAIL];
  const uniAcct = await acct("uni"), aliceAcct = await acct("alice");
  const [[, boxes]] = await jmap("uni@test.test", pw.uni, [["Mailbox/get", { accountId: uniAcct, properties: ["name"] }, "b"]]);
  const rights = { mayReadItems: true, mayAddItems: false, mayRemoveItems: false, maySetSeen: true, maySetKeywords: true, mayCreateChild: false, mayRename: false, mayDelete: false, maySubmit: false };
  const [[, shared]] = await jmap("uni@test.test", pw.uni, [["Mailbox/set", { accountId: uniAcct, update: Object.fromEntries(boxes.list.map((b) => [b.id, { shareWith: { [aliceAcct]: rights } }])) }, "s"]]);
  if (Object.keys(shared.notUpdated ?? {}).length) throw new Error(`Stalwart: sharing Uni's mail: ${JSON.stringify(shared.notUpdated)}`);

  // the gateway's own files, as it reads them from its HOME (/gw/home in the container)
  const own = ["mark_seen", "flag", "archive", "draft.save", "draft.review", "draft.discard", "send", "send.check"];
  const H = "/gw/home";
  put(join(mailDir, ".config/uni/mail-bridge.json"), JSON.stringify({
    jmap: "https://stalwart:443",
    public_url: MAIL_URL,
    public_aliases: ["http://127.0.0.1:19952"], // the browser's pass-through (e2e/services/client.ts corsProxy)
    principals: Object.fromEntries(["alice", "bob", "uni"].map((n) => [`${n}@test.test`, { password_file: `${H}/secrets/${n}.pw` }])),
    keys: { [pub("alice")]: "alice@test.test", [pub("bob")]: "bob@test.test", [pub("unibot")]: "uni@test.test" },
    roles: { "alice@test.test": "owner", "bob@test.test": "owner", "uni@test.test": "uni" },
    operations: {
      "alice@test.test": { "alice@test.test": own, "uni@test.test": ["mark_seen", "flag", "send.check", "send.parked", "send.approve", "send.decline"] },
      "bob@test.test": { "bob@test.test": own },
      "uni@test.test": { "uni@test.test": own },
    },
    ledger: `${H}/.local/state/ledger.sqlite3`,
    outbound_policy: `${H}/.config/uni/outbound-policy.json`,
    needs_aaron_spool: `${H}/.local/state/needs-aaron`,
  }, null, 1));
  put(join(mailDir, ".config/uni/mail-allow"), ["alice", "bob", "unibot"].map(pub).join("\n") + "\n");
  // Uni's outbound rules: mail to bob waits for the owner (mail.spec's second test)
  put(join(mailDir, ".config/uni/outbound-policy.json"), JSON.stringify({ default: "refuse", rules: [{ to: "bob@test.test", outcome: "needs-aaron" }] }));
  mkdirSync(join(mailDir, ".local/state"), { recursive: true });
} else if (step === "relay") {
  // NIP-42 sign-in as the owner, then one 9030 (let in) per person; each must be accepted
  const sk = Uint8Array.from(Buffer.from(read(join(keysDir, "owner.hex")), "hex"));
  setTimeout(() => { console.error("relay: letting people in took over 30 s"); process.exit(1); }, 30_000).unref();
  const ws = new WebSocket(RELAY);
  const waiting = new Map();
  // sends an event and waits for the relay's OK for it (registered before it can arrive)
  const send = (type, ev) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`relay: no answer to ${type}`)), 15000);
    waiting.set(ev.id, (good, msg) => { clearTimeout(t); good ? res() : rej(new Error(`relay: ${type}: ${msg}`)); });
    ws.send(JSON.stringify([type, ev]));
  });
  let signedIn;
  const challenged = new Promise((r) => { signedIn = r; });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m[0] === "AUTH") signedIn(send("AUTH", finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", RELAY], ["challenge", m[1]]], content: "" }, sk)));
    if (m[0] === "OK") waiting.get(m[1])?.(m[2], m[3]);
  });
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  await challenged; // resolves with the sign-in's answer
  for (const n of ["alice", "bob", "unibot"]) await send("EVENT", finalizeEvent({ kind: 9030, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["p", pub(n)]] }, sk));
  ws.close();
} else if (step === "matrix") {
  const C = `${MATRIX}/_matrix/client/v3`;
  const j = async (m, p, tok, body) => {
    const r = await fetch(C + p, { method: m, headers: { "content-type": "application/json", ...(tok && { authorization: `Bearer ${tok}` }) }, body: body && JSON.stringify(body) });
    const t = await r.json(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.errcode}: ${t.error}`); return t;
  };
  await until("the homeserver", async () => (await fetch(`${MATRIX}/_matrix/client/versions`)).ok);
  if (existsSync(join(mxDir, "bob.token"))) {
    const ok = await fetch(`${C}/account/whoami`, { headers: { authorization: `Bearer ${read(join(mxDir, "bob.token"))}` } });
    if (ok.ok) process.exit(0);
  }
  const user = async (name) => {
    const pw = hex(16);
    const first = await (await fetch(`${C}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const r = await j("POST", "/register", null, { username: name, password: pw, initial_device_display_name: "e2e",
      auth: { type: "m.login.registration_token", token: "throwaway-registration", session: first.session } });
    put(join(mxDir, `${name}.token`), r.access_token);
    return { id: r.user_id, tok: r.access_token };
  };
  const a = await user("alice"), b = await user("bob");
  const rooms = {};
  for (const n of ["Garden", "Kitchen"]) {
    const c = await j("POST", "/createRoom", b.tok, { name: n, preset: "private_chat", invite: [a.id] });
    await j("POST", `/join/${encodeURIComponent(c.room_id)}`, a.tok, {});
    rooms[n] = c.room_id;
  }
  for (const t of ["Hello from bob", "Second message from bob"])
    await j("PUT", `/rooms/${encodeURIComponent(rooms.Garden)}/send/m.room.message/${hex(6)}`, b.tok, { msgtype: "m.text", body: t });
} else throw new Error(`no step ${step}`);
