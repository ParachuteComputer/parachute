// A second person on a real relay, for the local tests against our Buzz relay: signs in (NIP-42) with a test key,
// publishes, queries, uploads a file (Blossom, kind 24242).
import WebSocket from "ws";
import { createHash, randomBytes } from "node:crypto";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";

export async function person(relay: string, secretHex: string) {
  const sk = Uint8Array.from(Buffer.from(secretHex, "hex"));
  const ws = new WebSocket(relay);
  const waiting = new Map<string, (ok: boolean, msg: string) => void>(), subs = new Map<string, { events: Event[]; done: (e: Event[]) => void }>();
  // a refused sign-in (a key the relay hasn't let in) fails here, not later as "auth-required" on some publish
  let authed: (ok: boolean, msg: string) => void = () => {};
  const signedIn = new Promise<void>((r, j) => { authed = (ok, msg) => ok ? r() : j(new Error(`relay refused ${getPublicKey(sk).slice(0, 8)}'s sign-in: ${msg}`)); });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m[0] === "AUTH") { const ev = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", m[1]]], content: "" }, sk); waiting.set(ev.id, authed); ws.send(JSON.stringify(["AUTH", ev])); }
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
    /** An event signed elsewhere (a card a synthetic Uni made), as it is. */
    send: (ev: Event) => new Promise<{ ok: boolean; msg: string }>((res) => { waiting.set(ev.id, (ok, msg) => res({ ok, msg })); ws.send(JSON.stringify(["EVENT", ev])); }),
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

/** Someone with a mailbox behind the mail gateway (the Uni app's bridge): each request signed NIP-98 with their key. */
export function mailAs(bridge: string, secretHex: string) {
  const sk = Uint8Array.from(Buffer.from(secretHex, "hex"));
  const post = async (path: string, body: unknown) => {
    const raw = JSON.stringify(body);
    const url = `${bridge}/mail/${path}`;
    const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["u", url], ["method", "POST"], ["payload", createHash("sha256").update(raw).digest("hex")], ["nonce", randomBytes(8).toString("hex")]] }, sk);
    const r = await fetch(url, { method: "POST", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`, "content-type": "application/json" }, body: raw });
    const out = await r.json();
    if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(out)}`);
    return out;
  };
  return {
    post,
    async send(to: string, subject: string, text: string) {
      const s = await post("session", {});
      const account = s.primaryAccounts["urn:ietf:params:jmap:mail"];
      const d = await post("op", { op: "draft.save", accountId: account, fields: { to: [{ email: to }], subject, text } });
      const r = await post("op", { op: "send", accountId: account, opId: randomHex(), draftId: d.draftId, fingerprint: d.fingerprint });
      if (r.state !== "cleaned" && r.state !== "submitted") throw new Error(`send: ${JSON.stringify(r)}`);
    },
    async inbox(): Promise<{ subject: string; from: { email: string }[]; preview: string }[]> {
      const s = await post("session", {});
      const account = s.primaryAccounts["urn:ietf:params:jmap:mail"];
      const r = await post("jmap", { calls: [["Mailbox/query", { accountId: account, filter: { role: "inbox" } }, "m"]] });
      const inbox = r.methodResponses[0][1].ids[0];
      const e = await post("jmap", { calls: [["Email/query", { accountId: account, filter: { inMailbox: inbox }, sort: [{ property: "receivedAt", isAscending: false }], limit: 20 }, "q"], ["Email/get", { accountId: account, "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["subject", "from", "preview"] }, "g"]] });
      return e.methodResponses[1][1].list;
    },
  };
}
const randomHex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A pass-through to a server that sends no CORS headers (the mail gateway), for the browser the tests drive: the app
 *  itself sends from its native side and needs none. */
export async function corsProxy(target: string, port: number) {
  const { createServer } = await import("node:http");
  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "POST, GET");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const r = await fetch(`${target}${req.url}`, { method: req.method, headers: { "content-type": String(req.headers["content-type"] ?? "application/json"), ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
