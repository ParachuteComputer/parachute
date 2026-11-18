// The gateway: POST /register and POST /unregister (each signed NIP-98 by the person's everyday key), GET /health; the
// relay watchers; the pusher. README.md says what it learns and what it sends.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { checkNip98, Burned } from "./nip98.ts";
import { LIMITS, parseRegister, parseUnregister, Registry, type Opts } from "./registry.ts";
import { AliveFile, RelayWatch } from "./watch.ts";
import { Budget, Pusher, type Log } from "./push.ts";
import { relayKey } from "./urls.ts";

export type Config = {
  /** The gateway's public address, ending in `/`: what a signed request's `u` must name (`<url>register`). */
  url: string;
  relays: string[];
  /** The gateway's own key (32 bytes). Never a person's. */
  secret: Uint8Array;
  /** The registrations file, or null to keep them in memory (tests). */
  file: string | null;
  /** http endpoints on this machine (tests only). */
  allowLoopback: boolean;
  /** Push servers on a private network the operator trusts (a tailnet's ntfy): their hosts, https only. */
  privateHosts?: string[];
  /** Behind a proxy the operator runs: the client's address is the last hop of X-Forwarded-For (what that proxy
   *  added), not the socket's. Off unless set: anyone can write the header. */
  trustProxy?: boolean;
  log?: Log;
};

const MAX_BODY = 8 * 1024;

function readBody(req: IncomingMessage): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { resolve(null); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(parts))));
    req.on("error", () => resolve(null));
  });
}

/** Who is asking, for the per-address limit: the socket's address, or with a trusted proxy the last address in
 *  X-Forwarded-For (earlier ones are whatever the client wrote). IPv6 counts by its /64, as one subscriber gets one. */
export function clientAddress(socket: string | undefined, forwarded: string | string[] | undefined, trustProxy: boolean): string {
  const hops = trustProxy ? [forwarded ?? []].flat().join(",").split(",").map((h) => h.trim()).filter(Boolean) : [];
  let a = (hops.length && isIP(hops[hops.length - 1]) ? hops[hops.length - 1] : socket ?? "").toLowerCase();
  if (a.startsWith("::ffff:") && isIP(a.slice(7)) === 4) a = a.slice(7);
  if (isIP(a) !== 6) return a;
  // expand "::", then keep the first four groups
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = a.includes("::") && tail ? tail.split(":") : [];
  const groups = a.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

const answer = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function createGateway(cfg: Config) {
  const log = cfg.log ?? ((l: string) => console.log(`${new Date().toISOString()} ${l}`));
  // as a signer's URL library writes it (lower-case host, no default port): what a signature's `u` names
  const url = new URL(cfg.url).href;
  if (!url.endsWith("/")) throw new Error("the gateway's url ends in /");
  const base = new URL(url);
  const relays = cfg.relays.map((r) => { const k = relayKey(r); if (!k) throw new Error(`${r} isn't a relay`); return k; });
  const opts: Opts = { relays, allowLoopback: cfg.allowLoopback, privateHosts: cfg.privateHosts };
  const registry = new Registry(cfg.file);
  const burned = new Burned();
  // limits count signed requests (behind a proxy every phone has one address): per key, and one for everyone; a body
  // is at most 8 KB and its signature one check, so unsigned junk is refused before it can spend anyone's budget
  const anyone = new Budget(600, 100);
  const perKey = new Budget(20, 3_000);
  // new keys' registrations per address (renewals and confirmed people's don't count): the pending pool turns over
  // only as fast as many addresses can fill it
  const perAddress = new Budget(30, 10_000);
  // every signed request from one address, before the gateway-wide budget: one address (fresh keys cost nothing) can't
  // drain what everyone shares
  const perAddressAll = new Budget(60, 2_000);
  const pusher = new Pusher({ allowLoopback: cfg.allowLoopback, privateHosts: cfg.privateHosts, log, gone: (e) => registry.dropEndpoint(e) });
  const now = () => Math.floor(Date.now() / 1000);
  const alive = new AliveFile(cfg.file ? `${cfg.file}.alive` : null);
  const watchers = relays.map((r) => new RelayWatch(r, cfg.secret, () => registry.all(now()), (reg, push) => { void pusher.send(reg, push); }, log, alive,
    (asked, members) => {
      const j = registry.judge(r, asked, members);
      if (j.confirmed || j.dropped) log(`relay ${r}: ${j.confirmed} new registration(s) confirmed, ${j.dropped} dropped (in no room's member list)`);
    }, LIMITS.pending));
  registry.onChange(() => watchers.forEach((w) => w.changed()));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? "/").split("?")[0];
    const route = path.startsWith(base.pathname) ? path.slice(base.pathname.length) : null;
    if (req.method === "GET" && route === "health") return answer(res, 200, { ok: true, relays: watchers.map((w) => ({ relay: w.relay, rooms: w.rooms().length })), registrations: registry.all(now()).length });
    const known = route === "register" || route === "unregister";
    if (!known) return answer(res, 404, { error: "not here" });
    if (req.method !== "POST" && !(route === "unregister" && req.method === "DELETE")) return answer(res, 405, { error: "POST" });
    const body = await readBody(req);
    if (!body) return answer(res, 413, { error: "too big" });
    // the URL the signature must name is the gateway's own, never one read from the request
    const signed = checkNip98(req.headers.authorization, { url: `${url}${route}`, method: req.method!, body, now: now() });
    if (!signed.ok) return answer(res, 401, { error: signed.error });
    const from = clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], !!cfg.trustProxy);
    if (!perKey.take(signed.pubkey, Date.now()) || !perAddressAll.take(from, Date.now()) || !anyone.take("*", Date.now())) return answer(res, 429, { error: "slow down" });
    if (!burned.use(signed.id, now())) return answer(res, 401, { error: "that signature was used already" });
    let x: unknown;
    try { x = JSON.parse(new TextDecoder().decode(body)); } catch { return answer(res, 400, { error: "the body is JSON" }); }
    if (route === "register") {
      const r = parseRegister(x, signed.pubkey, opts, now());
      if (!r.ok) return answer(res, 400, { error: r.error });
      if (registry.newcomer(r.value, now()) && !perAddress.take(from, Date.now())) {
        return answer(res, 429, { error: "slow down" });
      }
      const put = registry.put(r.value, now());
      if (!put.ok) return answer(res, 409, { error: put.error });
      log(`registered ${signed.pubkey.slice(0, 8)} on ${r.value.relay}${put.pending ? " (until a member list shows the key)" : ""}`);
      // pending: the app asks again sooner, in case a room adds the gateway or the person after this read
      return answer(res, 200, { ok: true, expires: r.value.expires, pending: put.pending });
    }
    const u = parseUnregister(x);
    if (!u.ok) return answer(res, 400, { error: u.error });
    const removed = registry.remove({ pubkey: signed.pubkey, ...u.value });
    log(`unregistered ${signed.pubkey.slice(0, 8)} on ${u.value.relay}${removed ? "" : " (none)"}`);
    return answer(res, 200, { ok: true, removed });
  }

  const server: Server = createServer((req, res) => { handle(req, res).catch(() => answer(res, 500, { error: "failed" })); });
  return {
    server,
    registry,
    watchers,
    pusher,
    start() { watchers.forEach((w) => w.start()); },
    close() { watchers.forEach((w) => w.stop()); server.closeAllConnections(); server.close(); },
  };
}
