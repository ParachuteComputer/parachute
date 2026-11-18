// End to end on this machine: our Buzz relay (ws://localhost:3871, production's image and auth), the gateway, a
// throwaway ntfy (http://127.0.0.1:18566) and a subscriber on the ntfy topic standing in for the phone. Bob names
// Alice in a room they share: the subscriber gets one push, which opens with the device's keys to the room, the event
// id and "mention", and carries none of the message's words. Bob naming her in a room she isn't in, and her own
// message, push nothing; after she unregisters, nothing either. A key no room lists registers too: the gateway's next
// read of the relay's member lists drops it, and confirms Alice.
//   PUSH_E2E_SECRETS=<dir with owner.hex alice.hex bob.hex gateway.hex> node test/e2e.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { createGateway } from "../src/server.ts";
import { b64u, decrypt } from "../src/webpush.ts";
import { sha256Hex } from "../src/nip98.ts";

const RELAY = process.env.PUSH_E2E_RELAY ?? "ws://localhost:3871";
const NTFY = process.env.PUSH_E2E_NTFY ?? "http://127.0.0.1:18566";
const SECRETS = process.env.PUSH_E2E_SECRETS ?? join(import.meta.dirname, "../../../../infra/secrets");
const key = (n: string) => Uint8Array.from(Buffer.from(readFileSync(join(SECRETS, `${n}.hex`), "utf8").trim(), "hex"));
const [owner, alice, bob, gw] = ["owner", "alice", "bob", "gateway"].map(key);
const pk = (sk: Uint8Array) => getPublicKey(sk);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`· ${s}`);

/** Someone signed in to the relay (NIP-42), publishing and waiting for OK. */
async function person(sk: Uint8Array) {
  const ws = new WebSocket(RELAY);
  const waiting = new Map<string, (ok: boolean, msg: string) => void>();
  let signedIn!: () => void;
  const ready = new Promise<void>((r) => (signedIn = r));
  ws.onmessage = (m) => {
    const x = JSON.parse(String(m.data));
    if (x[0] === "AUTH") { const ev = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", RELAY], ["challenge", x[1]]], content: "" }, sk); waiting.set(ev.id, () => signedIn()); ws.send(JSON.stringify(["AUTH", ev])); }
    if (x[0] === "OK") { const w = waiting.get(x[1]); waiting.delete(x[1]); w?.(x[2], x[3]); }
  };
  await ready;
  return {
    publish: (t: { kind: number; content?: string; tags?: string[][] }) => new Promise<{ ok: boolean; msg: string; id: string }>((res) => {
      const ev = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), content: "", tags: [], ...t }, sk);
      waiting.set(ev.id, (ok, msg) => res({ ok, msg, id: ev.id }));
      ws.send(JSON.stringify(["EVENT", ev]));
    }),
    close: () => ws.close(),
  };
}

/** The phone's side: a subscriber on the ntfy topic, collecting what arrives. */
async function subscriber(topic: string) {
  const got: { raw: string; bytes: Uint8Array }[] = [];
  const ctl = new AbortController();
  const res = await fetch(`${NTFY}/${topic}/json`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  void (async () => {
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          const m = JSON.parse(line);
          if (m.event === "open") open();
          if (m.event === "message") got.push({ raw: line, bytes: m.encoding === "base64" ? new Uint8Array(Buffer.from(m.message, "base64")) : new TextEncoder().encode(m.message) });
        }
      }
    } catch { /* aborted */ }
  })();
  await opened;
  return { got, close: () => ctl.abort() };
}

async function until(f: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (f()) return true; await sleep(100); }
  return f();
}

// ── the relay: the owner lets the gateway in and adds it to the room, as a room's admins would ──
step("relay: the owner lets alice, bob and the gateway in; a shared room, and a room alice isn't in");
const o = await person(owner);
const shared = crypto.randomUUID(), notHers = crypto.randomUUID();
for (const p of [alice, bob, gw]) assert.ok((await o.publish({ kind: 9030, tags: [["p", pk(p)]] })).ok || true);
for (const [room, people] of [[shared, [alice, bob, gw]], [notHers, [bob, gw]]] as const) {
  await o.publish({ kind: 9007, tags: [["h", room], ["name", "push e2e"], ["visibility", "private"], ["channel_type", "stream"]] });
  for (const p of people) assert.ok((await o.publish({ kind: 9000, tags: [["h", room], ["p", pk(p)]] })).ok);
}
o.close();

// ── the gateway, on this machine ──
const logs: string[] = [];
// the gateway's public address (what signatures name) is where it listens
const port = Number(process.env.PUSH_E2E_PORT ?? 18791);
const gateway = createGateway({ url: `http://127.0.0.1:${port}/`, relays: [RELAY], secret: gw, file: null, allowLoopback: true, log: (l) => logs.push(l) });
await new Promise<void>((r) => gateway.server.listen(port, "127.0.0.1", r));
gateway.start();
const base = `http://127.0.0.1:${port}/`;

// ── the phone: push keys (as the UnifiedPush connector makes them) and its ntfy topic ──
const device = createECDH("prime256v1");
device.generateKeys();
const auth = randomBytes(16);
const keys = { p256dh: b64u.encode(device.getPublicKey()), auth: b64u.encode(auth) };
const topic = `up${randomBytes(9).toString("hex")}`;
const endpoint = `${NTFY}/${topic}?up=1`;
const sub = await subscriber(topic);

async function signed(path: string, body: unknown, sk: Uint8Array) {
  const raw = JSON.stringify(body);
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["u", `${base}${path}`], ["method", "POST"], ["payload", sha256Hex(new TextEncoder().encode(raw))]] }, sk);
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`, "content-type": "application/json" }, body: raw });
  return { status: r.status, body: await r.json() };
}

// messages earlier runs left in her rooms are older than her registration: wait out the clocks' grace
await sleep(6000);
step("alice registers her endpoint, signed with her key");
const reg = await signed("register", { endpoint, keys, relay: RELAY, rooms: null, mentions: true, from: [] }, alice);
assert.equal(reg.status, 200, JSON.stringify(reg.body));
assert.ok(await until(() => gateway.watchers[0].rooms().includes(shared), 15_000), `the gateway listens in the shared room (${logs.join(" | ")})`);
assert.ok(!gateway.watchers[0].rooms().includes(notHers), "and not in a room she isn't in");
await sleep(500);

step("a key no room lists registers: the next read of the member lists drops it, and confirms alice");
const stranger = generateSecretKey();
const sreg = await signed("register", { endpoint: `${NTFY}/up${randomBytes(9).toString("hex")}?up=1`, keys, relay: RELAY, rooms: null, mentions: true, from: [] }, stranger);
assert.equal(sreg.status, 200, JSON.stringify(sreg.body));
assert.ok(await until(() => !gateway.registry.all(Math.floor(Date.now() / 1000)).some((r) => r.pubkey === pk(stranger)), 15_000), `the stranger's registration went (${logs.join(" | ")})`);
const hers = gateway.registry.all(Math.floor(Date.now() / 1000)).filter((r) => r.pubkey === pk(alice));
assert.ok(hers.length === 1 && !hers[0].pending, "alice's stays, confirmed");
await sleep(500);

step("bob names alice in the shared room");
const b = await person(bob);
const words = "the seedlings need water before noon";
const sent = await b.publish({ kind: 9, content: words, tags: [["h", shared], ["p", pk(alice)]] });
assert.ok(sent.ok, sent.msg);
assert.ok(await until(() => sub.got.length >= 1, 15_000), `a push reached the topic (${logs.join(" | ")})`);
const [first] = sub.got;
assert.ok(!first.raw.includes("seedlings") && !first.raw.includes(shared) && !first.raw.includes(pk(bob)), "ntfy saw no words, no room, no author");
const opened = JSON.parse(new TextDecoder().decode(decrypt(first.bytes, new Uint8Array(device.getPrivateKey()), new Uint8Array(auth))));
assert.deepEqual(opened, { v: 1, relay: RELAY, room: shared, event: sent.id, kind: 9, why: "mention", to: pk(alice) });
console.log(`  push opened on the device: ${JSON.stringify(opened)}`);

step("no push: bob names her in a room she isn't in; her own message naming herself");
await b.publish({ kind: 9, content: "where is alice", tags: [["h", notHers], ["p", pk(alice)]] });
const a = await person(alice);
await a.publish({ kind: 9, content: "note to self", tags: [["h", shared], ["p", pk(alice)]] });
await sleep(3000);
assert.equal(sub.got.length, 1, "nothing more");

step("alice unregisters; bob names her again: nothing");
assert.equal((await signed("unregister", { endpoint, relay: RELAY }, alice)).status, 200);
await sleep(800);
await b.publish({ kind: 9, content: "still there?", tags: [["h", shared], ["p", pk(alice)]] });
await sleep(3000);
assert.equal(sub.got.length, 1, "nothing after unregistering");

a.close(); b.close(); sub.close(); gateway.close();
console.log("e2e: ok");
process.exit(0);
