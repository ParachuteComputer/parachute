// The gateway's promises, each a test that fails if broken: only the person's own signature over exactly this request
// registers; a push carries no words and opens only with the app's keys; it goes only to someone the room lists, never
// for their own message; a gone endpoint is unregistered. Run: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { checkNip98, sha256Hex, Burned } from "../src/nip98.ts";
import { b64u, decrypt, encrypt } from "../src/webpush.ts";
import { matches, MAX_MENTIONS } from "../src/match.ts";
import { parseRegister, Registry, type Reg } from "../src/registry.ts";
import { endpointOk, privateAddress } from "../src/urls.ts";
import { Pusher } from "../src/push.ts";
import { createGateway } from "../src/server.ts";

const now = () => Math.floor(Date.now() / 1000);
const enc = (s: string) => new TextEncoder().encode(s);
const nip98 = (sk: Uint8Array, url: string, method: string, body: string, at = now(), kind = 27235) =>
  `Nostr ${Buffer.from(JSON.stringify(finalizeEvent({ kind, created_at: at, content: "", tags: [["u", url], ["method", method], ["payload", sha256Hex(enc(body))]] }, sk))).toString("base64")}`;

/** A device's push keys, as the UnifiedPush connector makes them. */
function device() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  const auth = randomBytes(16);
  return { priv: new Uint8Array(e.getPrivateKey()), auth: new Uint8Array(auth), keys: { p256dh: b64u.encode(e.getPublicKey()), auth: b64u.encode(auth) } };
}

test("Web Push encryption matches RFC 8291's example, and opens with the receiver's keys only", () => {
  const out = encrypt(enc("When I grow up, I want to be a watermelon"), { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    { senderPrivate: b64u.decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), salt: b64u.decode("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(b64u.encode(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  const d = device(), other = device();
  const sealed = encrypt(enc("hello"), d.keys);
  assert.equal(new TextDecoder().decode(decrypt(sealed, d.priv, d.auth)), "hello");
  assert.throws(() => decrypt(sealed, other.priv, other.auth));
});

test("a registration's signature: only this URL, method and body, now, once", () => {
  const sk = generateSecretKey(), url = "https://push.example/register", body = '{"a":1}';
  const ok = (h: string, over: Partial<{ url: string; method: string; body: string; now: number }> = {}) =>
    checkNip98(h, { url: over.url ?? url, method: over.method ?? "POST", body: enc(over.body ?? body), now: over.now ?? now() });
  const good = ok(nip98(sk, url, "POST", body));
  assert.ok(good.ok && good.pubkey === getPublicKey(sk));
  assert.equal(ok(nip98(sk, "https://push.example/unregister", "POST", body)).ok, false, "another URL");
  assert.equal(ok(nip98(sk, "https://evil.example/register", "POST", body)).ok, false, "another host");
  assert.equal(ok(nip98(sk, url, "POST", body), { url: "https://push.example/register?x" }).ok, false);
  assert.equal(ok(nip98(sk, url, "DELETE", body)).ok, false, "another method");
  assert.equal(ok(nip98(sk, url, "POST", '{"a":2}')).ok, false, "another body");
  assert.equal(ok(nip98(sk, url, "POST", body, now() - 120)).ok, false, "expired");
  assert.equal(ok(nip98(sk, url, "POST", body, now() + 120)).ok, false, "from the future");
  assert.equal(ok(nip98(sk, url, "POST", body, now(), 27236)).ok, false, "another kind");
  assert.equal(ok("Bearer x").ok, false);
  assert.equal(ok(undefined as unknown as string).ok, false);
  // another key's signature on this pubkey's event: the id or signature no longer verifies
  const ev = JSON.parse(Buffer.from(nip98(sk, url, "POST", body).slice(6), "base64").toString());
  ev.pubkey = getPublicKey(generateSecretKey());
  assert.equal(ok(`Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`).ok, false, "a key that didn't sign it");
  const b = new Burned();
  assert.equal(b.use("x", now()), true);
  assert.equal(b.use("x", now()), false, "once");
});

const relay = "ws://localhost:3871";
const reg = (over: Partial<Reg> = {}): Reg => ({ pubkey: "a".repeat(64), endpoint: "https://ntfy.example/upX?up=1", keys: device().keys, relay, rooms: null, mentions: true, from: [], created: now() - 60, expires: now() + 100, ...over });
const msg = (over: Partial<{ pubkey: string; tags: string[][]; kind: number; created_at: number }> = {}) => ({ id: "e".repeat(64), pubkey: "b".repeat(64), kind: 9, created_at: now(), content: "the secret words", tags: [["h", "garden"], ["p", "a".repeat(64)]], ...over });
const members = (room: string) => (room === "garden" ? new Set(["a".repeat(64), "b".repeat(64), "c".repeat(64)]) : undefined);

test("who a message is for: a mention or a listened-for author, in a room they are in, never their own", () => {
  const [m] = matches(msg(), relay, [reg()], members);
  assert.deepEqual(m.push, { v: 1, relay, room: "garden", event: "e".repeat(64), kind: 9, why: "mention" });
  assert.ok(!JSON.stringify(m.push).includes("secret") && !JSON.stringify(m.push).includes("b".repeat(64)), "no words, no author");
  assert.equal(matches(msg({ pubkey: "a".repeat(64) }), relay, [reg()], members).length, 0, "never their own");
  assert.equal(matches(msg({ tags: [["h", "finance"], ["p", "a".repeat(64)]] }), relay, [reg()], members).length, 0, "a room the gateway has no members for");
  assert.equal(matches(msg(), relay, [reg({ pubkey: "d".repeat(64) })], (r) => members(r)).length, 0, "not a member: told nothing, even when named");
  assert.equal(matches(msg(), relay, [reg({ rooms: ["other"] })], members).length, 0, "only the rooms it named");
  assert.equal(matches(msg(), relay, [reg({ rooms: ["garden"] })], members).length, 1);
  assert.equal(matches(msg(), "wss://elsewhere.example", [reg()], members).length, 0, "another relay");
  assert.equal(matches(msg({ tags: [["h", "garden"]] }), relay, [reg()], members).length, 0, "not named");
  const fromB = matches(msg({ tags: [["h", "garden"]] }), relay, [reg({ mentions: false, from: ["b".repeat(64)] })], members);
  assert.equal(fromB[0]?.push.why, "from");
  const many = [["h", "garden"], ...Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => ["p", i === 0 ? "a".repeat(64) : i.toString(16).padStart(64, "0")])];
  assert.equal(matches(msg({ tags: many }), relay, [reg()], members).length, 0, "a broadcast isn't a mention");
  assert.equal(matches(msg({ kind: 7 }), relay, [reg()], members).length, 0, "messages only");
  assert.equal(matches(msg({ created_at: now() - 120 }), relay, [reg()], members).length, 0, "nothing from before it registered");
  assert.equal(matches(msg({ tags: [["h", "garden"], ["h", "x"], ["p", "a".repeat(64)]] }), relay, [reg()], members).length, 0, "one room");
});

test("endpoints: https to a public host; http only to this machine when allowed", () => {
  assert.ok(endpointOk("https://ntfy.example/upAbc?up=1", false).ok);
  for (const pub of ["8.8.8.8", "1.1.1.1", "142.250.1.1", "2606:4700::1111"]) assert.equal(privateAddress(pub), false, `${pub} is public`);
  for (const priv of ["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::7f00:1", "10.0.0.1", "169.254.169.254", "fd00::1"]) assert.equal(privateAddress(priv), true, `${priv} is private`);
  assert.ok(endpointOk("https://8.8.8.8/up", false).ok, "a public address written as the host");
  for (const e of ["http://ntfy.example/up", "https://127.0.0.1/up", "https://10.1.2.3/up", "https://[::1]/up", "https://192.168.1.4/up", "https://u:p@ntfy.example/up", "https://ntfy.example/up#x", "ftp://x/", "not a url", "http://localhost:18566/up",
    "https://[::ffff:127.0.0.1]/x", "https://[::ffff:a9fe:a9fe]/x", "https://[::7f00:1]/x", "https://[64:ff9b::a00:1]/x", "https://[2002:a00:1::]/x", "https://[fec0::1]/x", "https://100.100.1.1/x"])
    assert.equal(endpointOk(e, false).ok, false, e);
  assert.ok(endpointOk("http://localhost:18566/upAbc?up=1", true).ok);
  assert.equal(endpointOk("http://10.0.0.2/up", true).ok, false);
  assert.ok(endpointOk("https://uni.tailnet.ts.net:8565/upAbc?up=1", false, ["uni.tailnet.ts.net"]).ok, "a push server the operator named");
  assert.equal(endpointOk("http://uni.tailnet.ts.net/up", false, ["uni.tailnet.ts.net"]).ok, false, "https only");
  const opts = { relays: [relay], allowLoopback: false };
  const body = { endpoint: "https://ntfy.example/upX?up=1", keys: device().keys, relay, rooms: null, mentions: true, from: [] };
  assert.ok(parseRegister(body, "a".repeat(64), opts, now()).ok);
  for (const bad of [{ relay: "wss://other.example" }, { keys: { p256dh: "AAAA", auth: "BBBB" } }, { mentions: false }, { rooms: [] }, { rooms: ["a b"] }, { from: ["B".repeat(64)] }, { extra: 1 }])
    assert.equal(parseRegister({ ...body, ...bad }, "a".repeat(64), opts, now()).ok, false, JSON.stringify(bad));
});

test("a push is sealed, carries no words, and a gone endpoint is unregistered", async () => {
  const got: { body: Buffer; headers: Record<string, unknown> }[] = [];
  let status = 200;
  const srv = createServer((req, res) => { const parts: Buffer[] = []; req.on("data", (c) => parts.push(c)); req.on("end", () => { got.push({ body: Buffer.concat(parts), headers: req.headers }); res.writeHead(status).end(); }); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const endpoint = `http://localhost:${(srv.address() as AddressInfo).port}/upX?up=1`;
  const d = device();
  const registry = new Registry(null);
  const r = reg({ endpoint, keys: d.keys });
  registry.put(r, now());
  const pusher = new Pusher({ allowLoopback: true, log: () => {}, gone: (e) => registry.dropEndpoint(e) });
  const [m] = matches(msg(), relay, [r], members);
  assert.equal(await pusher.send(r, m.push), "sent");
  assert.equal(got[0].headers["content-encoding"], "aes128gcm");
  assert.ok(!got[0].body.toString("latin1").includes("secret") && !got[0].body.toString("latin1").includes("garden"), "the push server sees no room and no words");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decrypt(new Uint8Array(got[0].body), d.priv, d.auth))), m.push);
  status = 410;
  assert.equal(await pusher.send(r, m.push), "gone");
  assert.equal(registry.all(now()).length, 0, "unregistered on 410");
  const loose = new Pusher({ allowLoopback: false, log: () => {}, gone: () => {} });
  assert.equal(await loose.send(reg({ endpoint: `https://[::ffff:7f00:1]:${(srv.address() as AddressInfo).port}/x` }), m.push), "failed", "an address written as the host is checked at send time too");
  assert.equal(await loose.send(reg({ endpoint: endpoint.replace("http:", "https:") }), m.push), "failed", "a name that resolves to this machine gets nothing");
  const many = new Pusher({ allowLoopback: true, log: () => {}, gone: () => {} });
  status = 200;
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await many.send(reg({ endpoint, keys: d.keys }), m.push));
  assert.equal(results.filter((x) => x === "limited").length, 2, "a burst of 10, then held back");
  srv.close();
});

test("the HTTP side: registers with the person's own signature over the gateway's own URL, once", async () => {
  const g = createGateway({ url: "http://push.test/", relays: [relay], secret: generateSecretKey(), file: null, allowLoopback: false, log: () => {} });
  await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r));
  const at = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
  const sk = generateSecretKey();
  const body = JSON.stringify({ endpoint: "https://ntfy.example/upX?up=1", keys: device().keys, relay, rooms: ["garden"], mentions: true, from: [] });
  const post = (path: string, auth: string, b = body, method = "POST") => fetch(`${at}/${path}`, { method, headers: { authorization: auth, "content-type": "application/json" }, body: b });
  const auth = nip98(sk, "http://push.test/register", "POST", body);
  assert.equal((await post("register", auth)).status, 200);
  assert.equal((await post("register", auth)).status, 401, "a signature works once");
  assert.equal((await post("register", nip98(sk, `${at}/register`, "POST", body))).status, 401, "signed for the address it was reached at, not its own");
  assert.equal(g.registry.all(now()).length, 1);
  assert.equal(g.registry.all(now())[0].pubkey, getPublicKey(sk), "registered as the signer");
  const un = JSON.stringify({ endpoint: "https://ntfy.example/upX?up=1", relay });
  assert.equal((await post("unregister", nip98(generateSecretKey(), "http://push.test/unregister", "POST", un), un)).status, 200);
  assert.equal(g.registry.all(now()).length, 1, "another key can't unregister it");
  assert.equal((await post("unregister", nip98(sk, "http://push.test/unregister", "DELETE", un), un, "DELETE")).status, 200);
  assert.equal(g.registry.all(now()).length, 0);
  assert.equal((await fetch(`${at}/health`)).status, 200);
  g.close();
});
