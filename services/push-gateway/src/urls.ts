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

/** A push server on a private network the operator trusts (a tailnet's ntfy): one host, one port, one push path. */
export type Trusted = { host: string; port: string; path: string };

/**
 * `PUSH_GATEWAY_PRIVATE_HOSTS` entries: `host[:port][/path/]`. The port is 443 unless named; the path is UnifiedPush's
 * on ntfy (`/up`, then the topic) unless named. A trusted host is trusted for its push server only, never for the other
 * services beside it on that machine (a hub, a mail bridge): an endpoint there is one path segment after the push path,
 * on that port, with no query but ntfy's `?up=1`. Throws on an entry that isn't one.
 */
export function trustedHosts(entries: readonly string[]): Trusted[] {
  return entries.filter((raw) => raw.trim()).map((raw) => {
    const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?(\/[a-z0-9_/-]*)?$/i.exec(raw.trim());
    const port = m?.[2] ?? "443";
    if (!m || !m[1].includes(".") || +port < 1 || +port > 65535 || m[3] === "/") throw new Error(`PUSH_GATEWAY_PRIVATE_HOSTS: "${raw}" is not host[:port][/path/]`);
    return { host: m[1].toLowerCase(), port: String(+port), path: m[3] ?? "/up" };
  });
}

const PUSH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
/** Is this https URL a push endpoint on a trusted host's push server (its host, its port, its path, one segment)? */
export function onTrustedHost(u: URL, trusted: readonly Trusted[]): boolean {
  if (u.protocol !== "https:" || (u.search !== "" && u.search !== "?up=1")) return false;
  const port = u.port || "443";
  return trusted.some((t) => t.host === u.hostname && t.port === port && u.pathname.startsWith(t.path) && PUSH_SEGMENT.test(u.pathname.slice(t.path.length)));
}

/** `privateHosts`: push servers the operator named that may be on a private network (`trustedHosts`), https only. */
export function endpointOk(raw: unknown, allowLoopback: boolean, privateHosts: readonly string[] = []): Parsed<string> {
  if (typeof raw !== "string" || raw.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: "endpoint is one URL" };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "endpoint is one URL" }; }
  if (u.username || u.password || u.hash) return { ok: false, error: "endpoint can't carry a name, password or fragment" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const loop = isLoopbackHost(u.hostname) || isLoopbackHost(host);
  if (u.protocol === "http:" && !(allowLoopback && loop)) return { ok: false, error: "endpoint must be https" };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "endpoint must be https" };
  const trusted = trustedHosts(privateHosts);
  if (onTrustedHost(u, trusted)) return { ok: true, value: u.href };
  // a trusted host's other ports and paths are another service on that machine: refused, wherever its name resolves
  if (trusted.some((t) => t.host === u.hostname)) return { ok: false, error: "endpoint on that host must be its push server" };
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
