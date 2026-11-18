// NIP-98: the person signs each registration with their everyday key, over exactly this URL, this method and this
// body. The gateway checks all four, a short time window, and burns each event id so a request can't be sent twice.
import { createHash } from "node:crypto";
import { verifyEvent, type Event } from "nostr-tools/pure";

export const HTTP_AUTH_KIND = 27235;
/** Seconds either side of now a signed request is taken. */
export const WINDOW_S = 60;
const MAX_HEADER = 8 * 1024;

export type Checked = { ok: true; pubkey: string; id: string } | { ok: false; error: string };

const tag = (ev: Event, name: string) => {
  const found = ev.tags.filter((t) => t[0] === name);
  return found.length === 1 && found[0].length >= 2 ? found[0][1] : null;
};

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Is `header` a NIP-98 `Authorization` for exactly this request? `url` is the gateway's own public address for the
 *  route (never one read from the request), `body` the raw bytes received. */
export function checkNip98(header: string | undefined, req: { url: string; method: string; body: Uint8Array; now: number }): Checked {
  if (!header || header.length > MAX_HEADER) return { ok: false, error: "missing Authorization" };
  const m = header.match(/^Nostr ([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: "Authorization isn't Nostr <base64>" };
  let ev: Event;
  try {
    ev = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
  } catch {
    return { ok: false, error: "Authorization doesn't read" };
  }
  if (!ev || typeof ev !== "object" || !Array.isArray(ev.tags) || !ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))) return { ok: false, error: "not an event" };
  // verifyEvent recomputes the id from the fields and checks the signature over it
  if (!verifyEvent(ev)) return { ok: false, error: "bad signature" };
  if (ev.kind !== HTTP_AUTH_KIND) return { ok: false, error: "not kind 27235" };
  if (typeof ev.created_at !== "number" || Math.abs(ev.created_at - req.now) > WINDOW_S) return { ok: false, error: "expired or from the future" };
  if (tag(ev, "u") !== req.url) return { ok: false, error: "signed for another URL" };
  if (tag(ev, "method") !== req.method) return { ok: false, error: "signed for another method" };
  if (tag(ev, "payload") !== sha256Hex(req.body)) return { ok: false, error: "signed for another body" };
  return { ok: true, pubkey: ev.pubkey, id: ev.id };
}

/** Event ids already used, kept as long as they could still pass the window. */
export class Burned {
  private seen = new Map<string, number>();
  /** True the first time an id is seen (and it is kept), false after. */
  use(id: string, now: number): boolean {
    if (this.seen.size > 10_000) for (const [k, t] of this.seen) if (t < now - 2 * WINDOW_S) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
}
