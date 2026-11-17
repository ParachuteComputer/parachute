// A second person on a real relay, for the local tests against our Buzz relay: signs in (NIP-42) with a test key,
// publishes, queries, uploads a file (Blossom, kind 24242).
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";

export async function person(relay: string, secretHex: string) {
  const sk = Uint8Array.from(Buffer.from(secretHex, "hex"));
  const ws = new WebSocket(relay);
  const waiting = new Map<string, (ok: boolean, msg: string) => void>(), subs = new Map<string, { events: Event[]; done: (e: Event[]) => void }>();
  let authed: () => void = () => {};
  const signedIn = new Promise<void>((r) => { authed = r; });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m[0] === "AUTH") { const ev = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", m[1]]], content: "" }, sk); waiting.set(ev.id, () => authed()); ws.send(JSON.stringify(["AUTH", ev])); }
    if (m[0] === "OK") { const w = waiting.get(m[1]); if (w) { waiting.delete(m[1]); w(m[2], m[3]); } }
    if (m[0] === "EVENT") subs.get(m[1])?.events.push(m[2]);
    if (m[0] === "EOSE" || m[0] === "CLOSED") { const s = subs.get(m[1]); if (s) { subs.delete(m[1]); s.done(s.events); } }
  });
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  await signedIn;
  const http = relay.replace(/^ws/, "http");
  const auth = (t: string, x: string) => `Nostr ${Buffer.from(JSON.stringify(finalizeEvent({ kind: 24242, created_at: Math.floor(Date.now() / 1000), content: t, tags: [["t", t], ["x", x], ["server", new URL(http).host], ["expiration", String(Math.floor(Date.now() / 1000) + 300)]] }, sk))).toString("base64")}`;
  return {
    pubkey: getPublicKey(sk),
    publish: (t: { kind: number; content?: string; tags?: string[][] }) => new Promise<{ ok: boolean; msg: string; ev: Event }>((res) => {
      const ev = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), content: "", tags: [], ...t }, sk);
      waiting.set(ev.id, (ok, msg) => res({ ok, msg, ev })); ws.send(JSON.stringify(["EVENT", ev]));
    }),
    query: (...filters: Record<string, unknown>[]) => new Promise<Event[]>((res) => { const id = `q${Math.random().toString(36).slice(2)}`; subs.set(id, { events: [], done: res }); ws.send(JSON.stringify(["REQ", id, ...filters])); }),
    upload: async (bytes: Buffer, type: string) => {
      const x = createHash("sha256").update(bytes).digest("hex");
      const r = await fetch(`${http}/upload`, { method: "PUT", headers: { authorization: auth("upload", x), "x-sha-256": x, "content-type": type }, body: bytes });
      if (!r.ok) throw new Error(`upload ${r.status} ${await r.text()}`);
      return r.json() as Promise<{ url: string; sha256: string; size: number; type: string }>;
    },
    close: () => ws.close(),
  };
}
