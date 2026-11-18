// Sending a push: the minimal JSON (relay, room, event id, kind, why, and the key it was registered for; never the
// message's words, never who wrote it), sealed to the registration's keys (webpush.ts), POSTed to its endpoint. No
// redirects followed; the address is checked again after DNS (a public name that resolves to a private address gets
// nothing). Each endpoint has a budget; one the push server says is gone (404, 410) is unregistered.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { encrypt } from "./webpush.ts";
import { privateAddress, redact } from "./urls.ts";
import type { Push } from "./match.ts";
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
const safeLookup = (allowLoopback: boolean, privateHosts: readonly string[]): LookupFunction => (host, options, cb) => {
  const allowed = (a: string) => !privateAddress(a) || (allowLoopback && (a === "127.0.0.1" || a === "::1")) || privateHosts.includes(host);
  lookup(host, { ...options, all: true }, (err, addresses) => {
    const ok = err ? [] : addresses.filter((a) => allowed(a.address));
    if (!ok.length) return (cb as (e: Error) => void)(err ?? new Error("endpoint resolves to a private address"));
    if (options.all) return (cb as unknown as (e: null, a: typeof ok) => void)(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
};

/** POST bytes, no redirects, a short timeout; the status, or 0 when it didn't get one. */
function post(url: string, body: Uint8Array, headers: Record<string, string>, allowLoopback: boolean, privateHosts: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const u = new URL(url);
    // an address written as the host skips the lookup below: checked here (a registration was checked too)
    const literal = u.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && privateAddress(literal) && !(allowLoopback && (literal === "127.0.0.1" || literal === "::1"))) return resolve(0);
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method: "POST", headers: { ...headers, "content-length": String(body.length) }, lookup: safeLookup(allowLoopback, privateHosts), timeout: 10_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(0));
    req.end(body);
  });
}

export class Pusher {
  private budget = new Budget(10, 6_000);
  private quietUntil = new Map<string, number>();
  private opts: { allowLoopback: boolean; privateHosts?: string[]; log: Log; gone: (endpoint: string) => void };
  constructor(opts: { allowLoopback: boolean; privateHosts?: string[]; log: Log; gone: (endpoint: string) => void }) { this.opts = opts; }

  /** Seal and send one push. Answers what happened, for the log and the tests. */
  async send(reg: Reg, push: Push, now = Date.now()): Promise<"sent" | "gone" | "limited" | "failed"> {
    const where = redact(reg.endpoint);
    if ((this.quietUntil.get(reg.endpoint) ?? 0) > now || !this.budget.take(reg.endpoint, now)) {
      this.opts.log(`push to ${where} held back (rate)`);
      return "limited";
    }
    const body = encrypt(new TextEncoder().encode(JSON.stringify(push)), reg.keys);
    // TTL: a phone off for a day still hears; Urgency high: a mention is worth waking for
    const status = await post(reg.endpoint, body, { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high" }, this.opts.allowLoopback, this.opts.privateHosts ?? []);
    if (status === 404 || status === 410) {
      this.opts.gone(reg.endpoint);
      this.opts.log(`push to ${where}: ${status}, unregistered`);
      return "gone";
    }
    if (status === 429) this.quietUntil.set(reg.endpoint, now + 60_000);
    if (status >= 200 && status < 300) {
      this.opts.log(`pushed ${push.why} in ${push.room.slice(0, 8)} to ${where}`);
      return "sent";
    }
    this.opts.log(`push to ${where} failed (${status || "no answer"})`);
    return "failed";
  }
}
