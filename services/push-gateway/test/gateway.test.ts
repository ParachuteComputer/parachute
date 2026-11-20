// The gateway's promises, each a test that fails if broken: only the person's own signature over exactly this request
// registers; a push carries no words and opens only with the app's keys; it goes only to someone the room lists, never
// for their own message; a gone endpoint is unregistered. Run: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { checkNip98, sha256Hex, Burned } from "../src/nip98.ts";
import { b64u, decrypt, encrypt } from "../src/webpush.ts";
import { matches, MAX_MENTIONS } from "../src/match.ts";
import { LIMITS, parseRegister, Registry, type Reg } from "../src/registry.ts";
import { endpointOk, privateAddress, trustedHosts } from "../src/urls.ts";
import { Pusher, sendable } from "../src/push.ts";
import { clientAddress, createGateway } from "../src/server.ts";
import { rosterFilters } from "../src/watch.ts";

const now = () => Math.floor(Date.now() / 1000);
/** Listen on a fixed port in 20000–32000 (this machine's ephemeral range can run out under listen(0)). */
async function listenFree(srv: Server): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    const ok = await new Promise<boolean>((res) => { srv.once("error", () => res(false)); srv.listen(p, "127.0.0.1", () => res(true)); });
    if (ok) return p;
  }
  throw new Error("no free port");
}
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
  assert.deepEqual(m.push, { v: 1, relay, room: "garden", event: "e".repeat(64), kind: 9, why: "mention", to: "a".repeat(64) });
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
  const T = ["uni.tailnet.ts.net:8565"];
  assert.ok(endpointOk("https://uni.tailnet.ts.net:8565/upAbc12345?up=1", false, T).ok, "a push server the operator named");
  assert.ok(endpointOk("https://Uni.Tailnet.ts.net.:8565/upAbc12345", false, T).ok, "its name in any case, with a trailing dot");
  assert.ok(endpointOk("https://uni.tailnet.ts.net/push/Abc12345", false, ["uni.tailnet.ts.net:443/push/"]).ok, "named with its own push path");
  assert.equal(endpointOk("http://uni.tailnet.ts.net:8565/upAbc12345", false, T).ok, false, "https only");
  // a trusted host is trusted for its push server only: its port and the UnifiedPush path, not the hub or mail beside it
  for (const e of ["https://uni.tailnet.ts.net/vault/uni/api/notes", "https://uni.tailnet.ts.net:8452/mail/send", "https://uni.tailnet.ts.net:8565/vault",
    "https://uni.tailnet.ts.net:8565/up", "https://uni.tailnet.ts.net:8565/upload", "https://uni.tailnet.ts.net:8565/upAbc12345/x", "https://uni.tailnet.ts.net:8565/up..%2fx12345",
    "https://uni.tailnet.ts.net:8565/upAbc12345?x=1", "https://uni.tailnet.ts.net/upAbc12345", "https://uni.tailnet.ts.net:8566/upAbc12345", "https://uni.tailnet.ts.net:8565/push/Abc12345",
    "https://uni.tailnet.ts.net.:8565/vault", "https://UNI.tailnet.ts.net:8452/mail/"])
    assert.equal(endpointOk(e, false, T).ok, false, e);
  assert.equal(endpointOk("https://uni.tailnet.ts.net/push/Abc12345/x", false, ["uni.tailnet.ts.net:443/push/"]).ok, false, "one segment after its path");
  assert.equal(endpointOk("https://other.tailnet.ts.net:8565/upAbc12345", false, T).ok, true, "another name is checked as any public name (after DNS)");
  // a bare host (the old form), an address, or anything loose stops the gateway at start
  for (const bad of ["uni.tailnet.ts.net", "https://uni.tailnet.ts.net:8565", "uni.tailnet.ts.net:0", "uni.tailnet.ts.net:99999", "uni.tailnet.ts.net:8565/up?x", "u@uni.tailnet.ts.net:8565",
    "uni.tailnet.ts.net:8565/", "100.64.1.2:8565", "[fd00::1]:8565", "-.-:8565", "uni.ts.net.:8565", "uni..ts.net:8565", "uni.ts.net:8565//"])
    assert.throws(() => trustedHosts([bad]), /PRIVATE_HOSTS/, bad);
  assert.deepEqual(trustedHosts(["Uni.Tailnet.ts.net:8565", " x.example:443/Push/ "]).map((t) => [t.host, t.port, t.path]), [["uni.tailnet.ts.net", "8565", "/up"], ["x.example", "443", "/Push/"]]);
  // the same rule at send time, before any connection (a kept-alive one skips the address check in the lookup)
  const at = (u: string) => sendable(new URL(u), false, T);
  assert.deepEqual(at("https://uni.tailnet.ts.net:8565/upAbc12345?up=1"), { ok: true, trusted: true });
  assert.deepEqual(at("https://ntfy.example/upAbc12345"), { ok: true, trusted: false });
  for (const u of ["https://uni.tailnet.ts.net:8565/vault/uni/api/notes", "https://uni.tailnet.ts.net/vault/uni/api/notes", "https://uni.tailnet.ts.net.:8565/x", "https://10.0.0.2/upAbc12345"])
    assert.deepEqual(at(u), { ok: false }, u);
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
  const port = await listenFree(srv);
  const endpoint = `http://localhost:${port}/upX?up=1`;
  const d = device();
  const registry = new Registry(null);
  const r = reg({ endpoint, keys: d.keys });
  registry.put(r, now());
  const pusher = new Pusher({ allowLoopback: true, log: () => {}, gone: (e) => registry.dropEndpoint(e) });
  const [m] = matches(msg(), relay, [r], members);
  assert.equal(await pusher.send(r, m.push), "sent");
  assert.equal(got[0].headers["content-encoding"], "aes128gcm");
  assert.ok(!got[0].body.toString("latin1").includes("secret") && !got[0].body.toString("latin1").includes("garden"), "the push server sees no room and no words");
  const opened = JSON.parse(new TextDecoder().decode(decrypt(new Uint8Array(got[0].body), d.priv, d.auth)));
  assert.deepEqual(opened, m.push);
  assert.equal(opened.to, r.pubkey, "the key it was registered for rides inside the seal: a phone whose key changed drops it");
  status = 410;
  assert.equal(await pusher.send(r, m.push), "gone");
  assert.equal(registry.all(now()).length, 0, "unregistered on 410");
  const loose = new Pusher({ allowLoopback: false, log: () => {}, gone: () => {} });
  assert.equal(await loose.send(reg({ endpoint: `https://[::ffff:7f00:1]:${port}/x` }), m.push), "failed", "an address written as the host is checked at send time too");
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
  const at = `http://127.0.0.1:${await listenFree(g.server)}`;
  const sk = generateSecretKey();
  const body = JSON.stringify({ endpoint: "https://ntfy.example/upX?up=1", keys: device().keys, relay, rooms: ["garden"], mentions: true, from: [] });
  const post = (path: string, auth: string, b = body, method = "POST") => fetch(`${at}/${path}`, { method, headers: { authorization: auth, "content-type": "application/json" }, body: b });
  const auth = nip98(sk, "http://push.test/register", "POST", body);
  const first = await post("register", auth);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).pending, true, "a key no member list has shown yet: the app asks again sooner");
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

const hex = (i: number) => i.toString(16).padStart(64, "0");

test("a key no room lists waits in a small pool of its own and goes at the next member-list read", () => {
  const registry = new Registry(null);
  const t = now();
  // a real person: registered, then seen in a member list
  const alice = "a".repeat(64);
  assert.equal((registry.put(reg({ pubkey: alice, created: t - 1000 }), t) as { pending: boolean }).pending, true, "a new key waits");
  assert.deepEqual(registry.judge(relay, new Set([alice]), new Set([alice, "b".repeat(64)])), { confirmed: 1, dropped: 0 });
  // a flood of fresh keys: the pool keeps the newest LIMITS.pending, oldest made first out; alice is untouched
  for (let i = 1; i <= LIMITS.pending + 5; i++) assert.ok(registry.put(reg({ pubkey: hex(i), endpoint: `https://ntfy.example/up${i}?up=1`, created: t - 900 + i }), t).ok);
  const all = registry.all(t);
  assert.equal(all.filter((r) => r.pending).length, LIMITS.pending, "the pending pool is bounded");
  assert.ok(all.some((r) => r.pubkey === alice && !r.pending), "a confirmed person isn't pushed out");
  assert.ok(!all.some((r) => r.pubkey === hex(1)) && all.some((r) => r.pubkey === hex(6)), "the oldest pending went first");
  // a confirmed key's new endpoint (another gateway instance, a new phone) is confirmed at once and not a newcomer
  const second = reg({ pubkey: alice, endpoint: "https://ntfy.example/upOther?up=1" });
  assert.equal(registry.newcomer(second, t), false);
  assert.equal((registry.put(second, t) as { pending: boolean }).pending, false);
  assert.equal(registry.newcomer(reg({ pubkey: hex(9999) }), t), true);
  // the next read: asked about some pending keys, one of them listed; the listed one stays, the rest asked about go,
  // the ones not asked about wait for a read that asks
  const asked = new Set([hex(6), hex(7), hex(8)]);
  assert.deepEqual(registry.judge(relay, asked, new Set([alice, hex(7)])), { confirmed: 1, dropped: 2 });
  const after = registry.all(t);
  assert.ok(after.some((r) => r.pubkey === hex(7) && !r.pending), "listed: confirmed");
  assert.ok(!after.some((r) => r.pubkey === hex(6) || r.pubkey === hex(8)), "in no member list: dropped");
  assert.ok(after.some((r) => r.pubkey === hex(9) && r.pending), "not asked about: still waiting");
  assert.equal(after.filter((r) => r.pubkey === alice).length, 2, "confirmed ones stay even when a read doesn't list them");
  assert.deepEqual(registry.judge(relay, asked, new Set([alice, hex(7)])), { confirmed: 0, dropped: 0 }, "a second read changes nothing (no save, no new read)");
  assert.deepEqual(registry.judge("wss://elsewhere.example", new Set([hex(9)]), new Set()), { confirmed: 0, dropped: 0 }, "another relay's read judges only its own");
});

test("a read of the member lists keeps room for confirmed people and for newcomers, and asks no newcomer's rooms", () => {
  const regs = [
    ...Array.from({ length: 950 }, (_, i) => reg({ pubkey: hex(i), rooms: ["garden"] })),
    ...Array.from({ length: LIMITS.pending }, (_, i) => reg({ pubkey: hex(10_000 + i), rooms: [`flood${i}`], pending: true })),
  ];
  const { filters, asked, whole } = rosterFilters(regs, "f".repeat(64), LIMITS.pending);
  assert.ok(filters.length <= 10);
  assert.ok(Array.from({ length: LIMITS.pending }, (_, i) => hex(10_000 + i)).every((k) => asked.has(k)), "every newcomer asked about");
  assert.equal([...asked].filter((k) => k < hex(10_000)).length, 800, "confirmed people fill the rest");
  assert.equal(whole, false);
  assert.ok(!JSON.stringify(filters).includes("flood"), "a newcomer's named rooms aren't read");
  assert.ok(filters.every((f) => (f.authors as string[])[0] === "f".repeat(64)), "only the relay's own lists");
  // a flood can't push people out: with a full pool of newcomers, 800 confirmed people are still all read
  const small = rosterFilters(regs.slice(150), null, LIMITS.pending);
  assert.ok(Array.from({ length: 800 }, (_, i) => hex(150 + i)).every((k) => small.asked.has(k)));
});

test("new keys' registrations are limited per client address; X-Forwarded-For counts only from a trusted proxy", async () => {
  assert.equal(clientAddress("127.0.0.1", "6.6.6.6", false), "127.0.0.1", "the header is ignored unless trusted");
  assert.equal(clientAddress("127.0.0.1", "6.6.6.6, 1.2.3.4", true), "1.2.3.4", "the last hop, which the proxy added");
  assert.equal(clientAddress("127.0.0.1", ["9.9.9.9", "6.6.6.6, 1.2.3.4"], true), "1.2.3.4");
  assert.equal(clientAddress("127.0.0.1", "1.2.3.4, junk", true), "127.0.0.1", "a last hop that isn't an address: the socket's");
  assert.equal(clientAddress("::ffff:10.1.2.3", undefined, true), "10.1.2.3");
  assert.equal(clientAddress("2001:db8:1:2:3:4:5:6", undefined, false), "2001:db8:1:2::/64");
  assert.equal(clientAddress("2001:db8::7", undefined, false), "2001:db8:0:0::/64", "one /64, however it is written");
  assert.equal(clientAddress(undefined, "2001:db8:0:0:ffff::1", true), "2001:db8:0:0::/64");

  for (const trustProxy of [true, false]) {
    const g = createGateway({ url: "http://push.test/", relays: [relay], secret: generateSecretKey(), file: null, allowLoopback: false, trustProxy, log: () => {} });
    const at = `http://127.0.0.1:${await listenFree(g.server)}`;
    const register = async (sk: Uint8Array, xff: string, n = 0) => {
      const body = JSON.stringify({ endpoint: `https://ntfy.example/up${n}?up=1`, keys: device().keys, relay, rooms: null, mentions: true, from: [] });
      return (await fetch(`${at}/register`, { method: "POST", headers: { authorization: nip98(sk, "http://push.test/register", "POST", body), "x-forwarded-for": xff }, body })).status;
    };
    const statuses = [];
    // one address, many fresh keys, each claiming another address in the part of the header a client writes
    for (let i = 0; i < 31; i++) statuses.push(await register(generateSecretKey(), `10.0.0.${i}, 1.2.3.4`));
    assert.deepEqual([statuses.filter((s) => s === 200).length, statuses[30]], [30, 429], `a burst of 30 from one address (trustProxy ${trustProxy})`);
    const elsewhere = await register(generateSecretKey(), "6.6.6.6, 5.6.7.8");
    assert.equal(elsewhere, trustProxy ? 200 : 429, trustProxy ? "another client behind the proxy has its own budget" : "untrusted, the header changes nothing");
    // a key already registered renews without spending the address's budget
    const known = generateSecretKey();
    g.registry.put({ ...reg({ pubkey: getPublicKey(known), endpoint: "https://ntfy.example/up7?up=1" }), pending: undefined }, now());
    assert.equal(await register(known, "1.2.3.4", 7), 200, "a confirmed key isn't a newcomer");
    g.close();
  }
});

test("one address can't drain the budget everyone shares, with fresh keys or unregisters", async () => {
  const g = createGateway({ url: "http://push.test/", relays: [relay], secret: generateSecretKey(), file: null, allowLoopback: false, trustProxy: true, log: () => {} });
  const at = `http://127.0.0.1:${await listenFree(g.server)}`;
  try {
  const send = async (route: string, sk: Uint8Array, xff: string, body: string) =>
    (await fetch(`${at}/${route}`, { method: "POST", headers: { authorization: nip98(sk, `http://push.test/${route}`, "POST", body), "x-forwarded-for": xff }, body })).status;
  const statuses: number[] = [];
  for (let i = 0; i < 80; i++) statuses.push(await send("unregister", generateSecretKey(), "1.2.3.4", JSON.stringify({ relay, endpoint: `https://ntfy.example/x${i}` })));
  assert.equal(statuses.filter((s) => s === 200).length, 60, "one address: its own burst, then refused");
  const body = JSON.stringify({ endpoint: "https://ntfy.example/real?up=1", keys: device().keys, relay, rooms: null, mentions: true, from: [] });
  assert.equal(await send("register", generateSecretKey(), "5.6.7.8", body), 200, "someone else still gets in");
  } finally { g.close(); }
});

test("signals: the person's own signature moves their numbers; a change reaches their phones as applet, signal and count only; a message adds one, once", async () => {
  const got: Buffer[] = [];
  const srv = createServer((req, res) => { const parts: Buffer[] = []; req.on("data", (c) => parts.push(c)); req.on("end", () => { got.push(Buffer.concat(parts)); res.writeHead(201).end(); }); });
  const endpoint = `http://localhost:${await listenFree(srv)}/upS?up=1`;
  const g = createGateway({ url: "http://push.test/", relays: [relay], secret: generateSecretKey(), file: null, allowLoopback: true, log: () => {} });
  const at = `http://127.0.0.1:${await listenFree(g.server)}`;
  const sk = generateSecretKey(), me = getPublicKey(sk), d = device();
  const subject = "c2lnbmFsLWFwcGxldC0x", rooms = "r00m";
  const send = (key: Uint8Array, body: unknown) => {
    const b = JSON.stringify(body);
    const ev = finalizeEvent({ kind: 27235, created_at: now(), content: "", tags: [["u", "http://push.test/signals"], ["method", "POST"], ["payload", sha256Hex(enc(b))], ["nonce", randomBytes(8).toString("hex")]] }, key);
    return fetch(`${at}/signals`, { method: "POST", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`, "content-type": "application/json" }, body: b });
  };
  const opened = () => got.map((b) => JSON.parse(new TextDecoder().decode(decrypt(new Uint8Array(b), d.priv, d.auth))));
  const settle = () => new Promise((r) => setTimeout(r, 150));

  try {
  assert.equal((await send(sk, { set: [] })).status, 403, "a key with no registration here keeps no numbers");
  const r = reg({ pubkey: me, endpoint, keys: d.keys, signals: [{ subject: "cm9vbXMtYXBwbGV0", signal: "for-you", rooms: null }] });
  g.registry.put(r, now());
  assert.equal((await send(sk, { set: [] })).status, 403, "nor one whose registration no member list has shown yet");
  g.registry.judge(relay, new Set([me]), new Set([me]));
  assert.equal((await send(sk, { set: [] })).status, 200, "once a member list shows the key");

  const set = await send(sk, { set: [{ subject, signal: "new", count: 2 }] });
  assert.equal(set.status, 200);
  assert.deepEqual((await set.json()).counts.map((c: { subject: string; signal: string; count: number }) => [c.subject, c.signal, c.count]), [[subject, "new", 2]]);
  await settle();
  assert.equal(got.length, 1, "the change is pushed to the person's phone");
  assert.deepEqual(opened()[0], { v: 1, kind: "signal", subject, signal: "new", count: 2, to: me }, "which applet (an opaque id), which signal, the count: nothing else");
  assert.ok(!got[0].toString("latin1").includes(subject), "sealed: the push server sees none of it");
  await send(sk, { set: [{ subject, signal: "new", count: 2 }] });
  await settle();
  assert.equal(got.length, 1, "the same number again pushes nothing");

  for (const bad of [{ set: [{ subject, signal: "new", count: -1 }] }, { set: [{ subject: "x", signal: "new", count: 1 }] }, { set: [{ subject, signal: "New", count: 1 }] }, { set: [{ subject, signal: "new", count: 1, words: "hi" }] }, { push: 1 }]) {
    assert.equal((await send(sk, bad)).status, 400, JSON.stringify(bad));
  }
  const other = generateSecretKey();
  g.registry.put(reg({ pubkey: getPublicKey(other), endpoint: "https://ntfy.example/upO?up=1" }), now());
  g.registry.judge(relay, new Set([getPublicKey(other)]), new Set([getPublicKey(other)]));
  assert.deepEqual((await (await send(other, { set: [] })).json()).counts, [], "another key reads only its own numbers");

  // a message for the person counts toward the signal its registration names, once however many phones hear it
  const second = reg({ pubkey: me, endpoint: endpoint.replace("upS", "upT"), keys: device().keys, signals: r.signals });
  g.registry.put(second, now());
  const push = { v: 1 as const, relay, room: rooms, event: "e".repeat(64), kind: 9, why: "mention" as const, to: me };
  g.relayPush(r, push);
  g.relayPush(second, push);
  g.relayPush(r, { ...push, event: "f".repeat(64) });
  assert.equal(g.counts.of(me, now()).find((c) => c.signal === "for-you")?.count, 2, "two messages, two phones: two");
  const roomOnly = reg({ pubkey: me, endpoint: endpoint.replace("upS", "upU"), signals: [{ subject: "YXJlYS1hcHBsZXQ", signal: "for-you", rooms: ["other"] }] });
  g.relayPush(roomOnly, { ...push, event: "1".repeat(64) });
  assert.equal(g.counts.of(me, now()).find((c) => c.subject === "YXJlYS1hcHBsZXQ"), undefined, "a signal named for other rooms doesn't count this one");
  } finally { g.close(); srv.close(); }
});

test("counts never hold back a message: their own budget, and the newest held count still arrives", async () => {
  const got: Buffer[] = [];
  const srv = createServer((req, res) => { const parts: Buffer[] = []; req.on("data", (c) => parts.push(c)); req.on("end", () => { got.push(Buffer.concat(parts)); res.writeHead(201).end(); }); });
  const endpoint = `http://localhost:${await listenFree(srv)}/upB?up=1`;
  const d = device();
  const r = reg({ endpoint, keys: d.keys });
  const pusher = new Pusher({ allowLoopback: true, log: () => {}, gone: () => {} });
  try {
    const count = (n: number) => ({ v: 1 as const, kind: "signal" as const, subject: "bWFpbC1hcHBsZXQ", signal: "unread", count: n, to: r.pubkey });
    const results = [];
    for (let n = 12; n >= 0; n--) results.push(await pusher.send(r, count(n)));
    assert.ok(results.includes("limited"), "a run of counts is held back past its budget");
    const [m] = matches(msg(), relay, [r], members);
    assert.equal(await pusher.send(r, m.push), "sent", "a message still goes at once");
    await new Promise((res) => setTimeout(res, 3_400));
    const opened = got.map((b) => JSON.parse(new TextDecoder().decode(decrypt(new Uint8Array(b), d.priv, d.auth))));
    assert.equal(opened.filter((o) => o.kind === "signal").at(-1).count, 0, "the newest count held back is sent when there is room");
  } finally { pusher.close(); srv.close(); }
});
