// Addresses the gateway takes from people: push endpoints (where it will POST) and relays (which it must already
// watch). An endpoint is https to a public host; plain http only to this machine, and only when the gateway was started
// for tests. Endpoints are never logged whole.
import { BlockList, isIP } from "node:net";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Addresses no push should go to: this machine, private networks, link-local, CGNAT, unspecified, multicast, and the
 *  IPv6 forms that carry an IPv4 address (mapped, compatible, NAT64, 6to4, Teredo) or are site-local. */
const PRIVATE = new BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(a, p, "ipv6");
PRIVATE.addAddress("::1", "ipv6");

export function privateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return PRIVATE.check(ip, "ipv4");
  if (v === 6) return PRIVATE.check(ip, "ipv6");
  return true;
}

export const isLoopbackHost = (host: string) => LOOPBACK.has(host);

/** `privateHosts`: push servers the operator named that may be on a private network (a tailnet's ntfy), https only. */
export function endpointOk(raw: unknown, allowLoopback: boolean, privateHosts: readonly string[] = []): Parsed<string> {
  if (typeof raw !== "string" || raw.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: "endpoint is one URL" };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "endpoint is one URL" }; }
  if (u.username || u.password || u.hash) return { ok: false, error: "endpoint can't carry a name, password or fragment" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const loop = isLoopbackHost(u.hostname) || isLoopbackHost(host);
  if (u.protocol === "http:" && !(allowLoopback && loop)) return { ok: false, error: "endpoint must be https" };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "endpoint must be https" };
  if (u.protocol === "https:" && privateHosts.includes(u.hostname)) return { ok: true, value: u.href };
  if (!(allowLoopback && loop) && (loop || (isIP(host) && privateAddress(host)))) return { ok: false, error: "endpoint can't be on a private network" };
  return { ok: true, value: u.href };
}

/** A relay as the gateway compares them: ws(s), lower-case host, no trailing slash. Null when it isn't one. */
export function relayKey(raw: string): string | null {
  if (raw.length > 300) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== "ws:" && u.protocol !== "wss:") || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return u.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** What a log line may say about an endpoint: its host and the first characters of its path. */
export function redact(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.host}${u.pathname.slice(0, 5)}…`;
  } catch {
    return "(endpoint)";
  }
}
