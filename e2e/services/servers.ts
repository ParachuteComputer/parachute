// Fakes of servers we don't run, for the services tests in CI (docs/design/SERVICES.md): on loopback, each check real.
//   relay   a Nostr relay that asks NIP-42 sign-in before any REQ or EVENT (as a Buzz relay does), checks every event's
//           id and signature, keeps them, answers REQs (ids, authors, kinds, #tags, since, until, limit), and on the
//           same port a Blossom-style media server: PUT /upload and GET /media/<sha256>.<ext>, both needing kind 24242.
//   http    a server that checks NIP-98 on /mail/* (signature, u = the exact URL, method, payload hash) and records
//           every request, signed or not.
// The same tests run against the real ones in the Services workflow, and locally (e2e/services/README.md).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyEvent, type Event } from "nostr-tools/pure";

export type Seen = { method: string; url: string; auth: string | null; pubkey: string | null; error: string | null; body: string };
const read = (req: IncomingMessage) => new Promise<Buffer>((res) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const decode = (h: string | undefined): Event | null => {
  if (!h?.startsWith("Nostr ")) return null;
  try { return JSON.parse(Buffer.from(h.slice(6), "base64").toString("utf8")) as Event; } catch { return null; }
};
const tag = (e: Event, n: string) => e.tags.find((t) => t[0] === n)?.[1];
// the test signer runs in the browser, so these fakes answer CORS (the app's own native side needs none)
const cors = (req: IncomingMessage, res: import("node:http").ServerResponse) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, x-sha-256, accept");
  res.setHeader("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return true; }
  return false;
};
/** On a free port below the ephemeral range (see hub.ts freePort). */
const listen = async (s: Server): Promise<number> => {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    if (await new Promise<boolean>((res) => { const fail = () => res(false); s.once("error", fail); s.listen(p, "127.0.0.1", () => { s.off("error", fail); res(true); }); })) return p;
  }
  throw new Error("no free port");
};

function matches(e: Event, f: Record<string, unknown>): boolean {
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  if (typeof f.since === "number" && e.created_at < f.since) return false;
  if (typeof f.until === "number" && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) if (k.startsWith("#") && Array.isArray(v) && !e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false;
  return true;
}

export async function startRelay() {
  const events: Event[] = [];
  const blobs = new Map<string, { type: string; body: Buffer }>();
  const signIns: Event[] = [];
  const media: { op: string; ok: boolean; why?: string }[] = [];
  let origin = "";
  const authOk = (h: string | undefined, op: string, x: string): string | null => {
    const e = decode(h);
    if (!e || e.kind !== 24242 || !verifyEvent(e)) return "no media auth";
    if (tag(e, "t") !== op || !e.tags.some((t) => t[0] === "x" && t[1] === x)) return "auth for another file";
    if (tag(e, "server") !== new URL(origin).host) return "auth for another server";
    if (Number(tag(e, "expiration")) < Date.now() / 1000) return "expired";
    return null;
  };
  const server = createServer(async (req, res) => {
    if (cors(req, res)) return;
    const body = await read(req);
    const url = new URL(req.url ?? "/", origin);
    if (req.method === "PUT" && url.pathname === "/upload") {
      const x = sha(body), why = authOk(req.headers.authorization, "upload", x) ?? (req.headers["x-sha-256"] !== x ? "hash" : null);
      media.push({ op: "upload", ok: !why, why: why ?? undefined });
      if (why) { res.writeHead(401).end(why); return; }
      const type = String(req.headers["content-type"] ?? "application/octet-stream");
      blobs.set(x, { type, body });
      const ext = type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ url: `${origin}/media/${x}.${ext}`, sha256: x, size: body.length, type }));
      return;
    }
    const m = url.pathname.match(/^\/media\/([0-9a-f]{64})\.[a-z0-9]+$/);
    if (req.method === "GET" && m) {
      const why = authOk(req.headers.authorization, "get", m[1]);
      media.push({ op: "get", ok: !why, why: why ?? undefined });
      const b = blobs.get(m[1]);
      if (why) { res.writeHead(401).end(why); return; }
      if (!b) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": b.type }).end(b.body);
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server });
  const live = new Set<{ ws: WebSocket; subs: Map<string, Record<string, unknown>[]>; who: string | null }>();
  wss.on("connection", (ws) => {
    const challenge = randomBytes(16).toString("hex");
    const c = { ws, subs: new Map<string, Record<string, unknown>[]>(), who: null as string | null };
    live.add(c);
    ws.send(JSON.stringify(["AUTH", challenge]));
    ws.on("close", () => live.delete(c));
    ws.on("message", (raw) => {
      let m: unknown[];
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m[0] === "AUTH") {
        const e = m[1] as Event;
        const ok = verifyEvent(e) && e.kind === 22242 && tag(e, "challenge") === challenge && tag(e, "relay") === origin.replace(/^http/, "ws");
        if (ok) { c.who = e.pubkey; signIns.push(e); }
        ws.send(JSON.stringify(["OK", e?.id, ok, ok ? "" : "auth-required: bad sign-in"]));
        return;
      }
      if (m[0] === "REQ") {
        const id = String(m[1]);
        if (!c.who) { ws.send(JSON.stringify(["CLOSED", id, "auth-required: not authenticated"])); return; }
        const filters = m.slice(2) as Record<string, unknown>[];
        c.subs.set(id, filters);
        for (const f of filters) {
          const hits = events.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at).slice(0, typeof f.limit === "number" ? f.limit : 500);
          for (const e of hits) ws.send(JSON.stringify(["EVENT", id, e]));
        }
        ws.send(JSON.stringify(["EOSE", id]));
        return;
      }
      if (m[0] === "CLOSE") { c.subs.delete(String(m[1])); return; }
      if (m[0] === "EVENT") {
        const e = m[1] as Event;
        if (!c.who) { ws.send(JSON.stringify(["OK", e?.id, false, "auth-required: not authenticated"])); return; }
        if (!verifyEvent(e)) { ws.send(JSON.stringify(["OK", e?.id, false, "invalid: bad signature"])); return; }
        if (e.pubkey !== c.who) { ws.send(JSON.stringify(["OK", e.id, false, "restricted: not the signed-in key"])); return; }
        if (e.kind === 30078) { const d = tag(e, "d"); const i = events.findIndex((x) => x.kind === 30078 && x.pubkey === e.pubkey && tag(x, "d") === d); if (i >= 0) events.splice(i, 1); }
        if (e.kind !== 20002) events.push(e);
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
        for (const o of live) for (const [sid, fs] of o.subs) if (o.who && fs.some((f) => matches(e, f))) o.ws.send(JSON.stringify(["EVENT", sid, e]));
      }
    });
  });
  const port = await listen(server);
  origin = `http://127.0.0.1:${port}`;
  return { url: `ws://127.0.0.1:${port}`, origin, events, signIns, media, blobs, close: () => new Promise<void>((r) => { for (const c of live) c.ws.terminate(); wss.close(); server.close(() => r()); }) };
}

export async function startHttp() {
  const seen: Seen[] = [];
  let origin = "";
  const server = createServer(async (req, res) => {
    if (cors(req, res)) return;
    const body = await read(req);
    const url = `${origin}${req.url}`;
    const e = decode(req.headers.authorization);
    let error: string | null = null;
    if (!e) error = "no NIP-98";
    else if (!verifyEvent(e) || e.kind !== 27235) error = "bad signature";
    else if (tag(e, "u") !== url) error = `signed for ${tag(e, "u")}`;
    else if (tag(e, "method") !== req.method) error = "signed for another method";
    else if (body.length && tag(e, "payload") !== sha(body)) error = "signed another body";
    else if (Math.abs(e.created_at - Date.now() / 1000) > 60) error = "too old";
    seen.push({ method: req.method ?? "", url, auth: req.headers.authorization ?? null, pubkey: error ? null : e!.pubkey, error, body: body.toString("utf8") });
    if (req.url?.startsWith("/mail/redirect")) { res.writeHead(302, { location: "https://elsewhere.example/" }).end(); return; }
    res.writeHead(error ? 401 : 200, { "content-type": "application/json", "set-cookie": "s=1", "x-secret": "no" }).end(JSON.stringify(error ? { error } : { ok: true, pubkey: e!.pubkey, method: req.method, body: body.toString("utf8") }));
  });
  const port = await listen(server);
  origin = `http://127.0.0.1:${port}`;
  return { origin, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}
