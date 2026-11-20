// Sending a push: the minimal JSON (relay, room, event id, kind, why, and the key it was registered for; never the
// message's words, never who wrote it), sealed to the registration's keys (webpush.ts), POSTed to its endpoint. No
// redirects followed; the address is checked again after DNS (a public name that resolves to a private address gets
// nothing). Each endpoint has a budget; one the push server says is gone (404, 410) is unregistered.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { encrypt } from "./webpush.ts";
import { besideTrustedHost, onTrustedHost, privateAddress, redact, trustedHosts } from "./urls.ts";
import type { Push } from "./match.ts";
import type { SignalPush } from "./signals.ts";
import type { Reg } from "./registry.ts";

export type Log = (line: string) => void;

/** A token bucket per endpoint: a burst of `burst`, then one every `everyMs`. */
export class Budget {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private burst: number;
  private everyMs: number;
  constructor(burst: number, everyMs: number) { this.burst = burst; this.everyMs = everyMs; }
  take(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) / this.everyMs);
    b.at = now;
    if (this.buckets.size > 50_000) this.buckets.clear();
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

// Node asks for one address or for all of them (to try both families); either way, only public ones are handed back.
// `trusted`: the endpoint is a trusted host's push server (urls.ts `onTrustedHost`: host, port and path), which may be private.
const safeLookup = (allowLoopback: boolean, trusted: boolean): LookupFunction => (host, options, cb) => {
  const allowed = (a: string) => !privateAddress(a) || (allowLoopback && (a === "127.0.0.1" || a === "::1")) || trusted;
  lookup(host, { ...options, all: true }, (err, addresses) => {
    const ok = err ? [] : addresses.filter((a) => allowed(a.address));
    if (!ok.length) return (cb as (e: Error) => void)(err ?? new Error("endpoint resolves to a private address"));
    if (options.all) return (cb as unknown as (e: null, a: typeof ok) => void)(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
};

/** Whether a push may go to this URL at all, decided before any connection (`trusted`: it is a trusted host's push server,
 *  which may resolve to a private address). Checked here, not only in the lookup: a kept-alive connection to a trusted
 *  host's port skips the lookup, and a registration kept from before its host was trusted this narrowly may name
 *  another path there. */
export function sendable(u: URL, allowLoopback: boolean, privateHosts: readonly string[]): { ok: false } | { ok: true; trusted: boolean } {
  // an address written as the host skips the lookup: checked here (a registration was checked too)
  const literal = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && privateAddress(literal) && !(allowLoopback && (literal === "127.0.0.1" || literal === "::1"))) return { ok: false };
  const trusted = trustedHosts(privateHosts);
  if (besideTrustedHost(u, trusted)) return { ok: false };
  return { ok: true, trusted: onTrustedHost(u, trusted) };
}

/** POST bytes, no redirects, a short timeout; the status, or 0 when it didn't get one. */
function post(url: string, body: Uint8Array, headers: Record<string, string>, allowLoopback: boolean, privateHosts: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const may = sendable(u, allowLoopback, privateHosts);
    if (!may.ok) return resolve(0);
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method: "POST", headers: { ...headers, "content-length": String(body.length) }, lookup: safeLookup(allowLoopback, may.trusted), timeout: 10_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(0));
    req.end(body);
  });
}

/** How a sealed push reaches a phone: the HTTP status the push service answered (0: none). One sender per transport;
 *  UnifiedPush (Web Push to the distributor's endpoint) is the only one built. FCM and APNs would each be one more
 *  here, optional server config, carrying the same sealed bytes (docs/design/SERVICES.md, "Order"). */
export type Sender = (reg: Reg, sealed: Uint8Array) => Promise<number>;

export class Pusher {
  private budget = new Budget(10, 6_000);
  // counts have their own budget, so a run of them (someone reading mail on another device) never holds back a message;
  // one held back waits, and only the newest number for each endpoint and signal is sent when there is room
  private signalBudget = new Budget(4, 3_000);
  private heldCounts = new Map<string, { reg: Reg; push: SignalPush }>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private quietUntil = new Map<string, number>();
  private opts: { allowLoopback: boolean; privateHosts?: string[]; log: Log; gone: (endpoint: string) => void };
  constructor(opts: { allowLoopback: boolean; privateHosts?: string[]; log: Log; gone: (endpoint: string) => void }) { this.opts = opts; }

  /** A count held back: kept (the newest replaces an older one for the same endpoint and signal) and sent when the
   *  budget allows. */
  private hold(reg: Reg, push: SignalPush) {
    this.heldCounts.set(`${reg.endpoint} ${push.subject} ${push.signal}`, { reg, push });
    if (this.heldCounts.size > 10_000) this.heldCounts.delete(this.heldCounts.keys().next().value!);
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      const held = [...this.heldCounts.values()];
      this.heldCounts.clear();
      for (const h of held) void this.send(h.reg, h.push);
    }, 3_000);
    this.retry.unref?.();
  }

  /** Stop the timer for held counts (the gateway closing). */
  close() { if (this.retry) clearTimeout(this.retry); this.retry = null; this.heldCounts.clear(); }

  /** UnifiedPush: RFC 8030 to the endpoint. TTL: a phone off for a day still hears; Urgency high: worth waking for. */
  private unifiedpush: Sender = (reg, body) => post(reg.endpoint, body, { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high" }, this.opts.allowLoopback, this.opts.privateHosts ?? []);

  /** Seal and send one push. Answers what happened, for the log and the tests. */
  async send(reg: Reg, push: Push | SignalPush, now = Date.now()): Promise<"sent" | "gone" | "limited" | "failed"> {
    const where = redact(reg.endpoint);
    const count = "kind" in push && push.kind === "signal";
    if ((this.quietUntil.get(reg.endpoint) ?? 0) > now || !(count ? this.signalBudget : this.budget).take(reg.endpoint, now)) {
      this.opts.log(`push to ${where} held back (rate)`);
      if (count) this.hold(reg, push as SignalPush);
      return "limited";
    }
    const body = encrypt(new TextEncoder().encode(JSON.stringify(push)), reg.keys);
    const status = await this.unifiedpush(reg, body);
    if (status === 404 || status === 410) {
      this.opts.gone(reg.endpoint);
      this.opts.log(`push to ${where}: ${status}, unregistered`);
      return "gone";
    }
    if (status === 429) this.quietUntil.set(reg.endpoint, now + 60_000);
    if (status >= 200 && status < 300) {
      this.opts.log("why" in push ? `pushed ${push.why} in ${push.room.slice(0, 8)} to ${where}` : `pushed a signal (${push.count}) to ${where}`);
      return "sent";
    }
    this.opts.log(`push to ${where} failed (${status || "no answer"})`);
    return "failed";
  }
}
