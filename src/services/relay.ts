// One relay connection the shell holds for an applet's session (docs/design/SERVICES.md): a WebSocket in the shell's own
// window, never the frame's. It answers the relay's NIP-42 challenge with an event the native side signs for the
// declared relay, holds REQs and EVENTs until signed in (a Buzz relay refuses both before), sends REQs again after a
// sign-in or a reconnect, and resolves a publish on the relay's OK.
import type { SignedEvent } from "./native";

export type Status = { status: "connecting" | "ready" | "closed"; why?: string };
type Sub = { filters: Record<string, unknown>[]; onEvent: (e: SignedEvent) => void; onEose: () => void; onClosed: (why: string) => void };
type Waiter = { resolve: (r: { ok: boolean; message: string }) => void; timer: ReturnType<typeof setTimeout> };

const AUTH_WAIT_MS = 2500;
/** A relay counts the posts and subscriptions a person sends (Buzz: 50 in a fixed 5 s window by default, across all of
 *  their connections; past it, they are refused). The shell keeps well under that, leaving room for the person's other
 *  apps: a burst of 10, then 7 a second (at most 45 in any 5 s); posts go before subscriptions, and sign-ins and
 *  CLOSEs (not counted) go at once. */
const PACE_BURST = 10, PACE_PER_SEC = 7;
const OK_WAIT_MS = 10_000;

export class RelayConn {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Sub>();
  private waiting = new Map<string, Waiter>();
  private queue: unknown[] = [];
  private authed = false;
  private authEvent: string | null = null;
  private open = false;
  private closedForGood = false;
  private tries = 0;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private tokens = PACE_BURST;
  private refilled = Date.now();
  private posts: unknown[] = [];
  private reqs: unknown[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  /** The subscriptions whose REQ has gone out on this connection (only those get a CLOSE). */
  private sent = new Set<string>();
  private urgent = new Set<string>();

  constructor(private url: string, private auth: (challenge: string) => Promise<SignedEvent>, private onStatus: (s: Status) => void, private socket: (url: string) => WebSocket = (u) => new WebSocket(u)) {
    this.connect();
  }

  private connect() {
    if (this.closedForGood) return;
    this.onStatus({ status: "connecting" });
    this.authed = false; this.open = false; this.authEvent = null;
    let ws: WebSocket;
    try { ws = this.socket(this.url); } catch (e) { this.onStatus({ status: "closed", why: e instanceof Error ? e.message : "couldn't connect" }); this.again(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true; this.tries = 0;
      // a relay that asks no sign-in: go on after a moment
      this.authTimer = setTimeout(() => { if (!this.authed) this.ready(); }, AUTH_WAIT_MS);
    };
    ws.onmessage = (m) => this.message(m.data);
    ws.onclose = () => {
      // not signed in any more: what is sent from now waits for the next sign-in
      this.ws = null; this.open = false; this.authed = false;
      if (this.authTimer) clearTimeout(this.authTimer);
      if (this.closedForGood) return;
      this.onStatus({ status: "closed", why: "the relay closed the connection" });
      // a publish in flight gets its answer now, never a hang; and having been told it failed, it isn't sent later
      this.failWaiting("connection closed");
      this.dropOutbox();
      this.again();
    };
  }

  /** Every publish waiting is answered "failed", and none of them is sent afterwards. */
  private failWaiting(why: string) {
    for (const [id, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: why }); this.waiting.delete(id); }
    this.queue = this.queue.filter((m) => !(Array.isArray(m) && m[0] === "EVENT"));
    this.posts = [];
  }

  /** Connect again after a growing wait (a dropped socket, or one that couldn't be made). */
  private again() {
    if (this.closedForGood) return;
    const wait = Math.min(30_000, 1000 * 2 ** this.tries++);
    setTimeout(() => this.connect(), wait);
  }

  private ready() {
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.authed = true;
    this.onStatus({ status: "ready" });
    for (const [id, s] of this.subs) this.raw(["REQ", id, ...s.filters]);
    const q = this.queue; this.queue = [];
    for (const m of q) this.raw(m);
  }

  private raw(m: unknown) {
    if (!this.ws || !this.open) return;
    const kind = Array.isArray(m) ? m[0] : "";
    if (kind !== "EVENT" && kind !== "REQ") { this.ws.send(JSON.stringify(m)); return; }
    (kind === "EVENT" || this.urgent.has((m as unknown[])[1] as string) ? this.posts : this.reqs).push(m);
    this.drain();
  }
  private drain() {
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    const now = Date.now();
    this.tokens = Math.min(PACE_BURST, this.tokens + ((now - this.refilled) * PACE_PER_SEC) / 1000);
    this.refilled = now;
    while (this.tokens >= 1 && this.ws && this.open && (this.posts.length || this.reqs.length)) {
      const m = this.posts.length ? this.posts.shift() : this.reqs.shift();
      if (Array.isArray(m) && m[0] === "REQ") this.sent.add(m[1] as string);
      this.ws.send(JSON.stringify(m));
      this.tokens -= 1;
    }
    if (this.posts.length || this.reqs.length) this.drainTimer = setTimeout(() => this.drain(), Math.ceil(((1 - this.tokens) * 1000) / PACE_PER_SEC) + 5);
  }
  /** Nothing waits to go out (the connection dropped or closed: subscriptions are sent again after the next sign-in). */
  private dropOutbox() {
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    this.posts = []; this.reqs = []; this.sent.clear();
  }
  private send(m: unknown) { if (this.authed) this.raw(m); else this.queue.push(m); }

  private message(data: unknown) {
    let m: unknown;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!Array.isArray(m) || typeof m[0] !== "string") return;
    switch (m[0]) {
      case "AUTH": {
        if (typeof m[1] !== "string") return;
        // the relay asks a sign-in: nothing goes before it, however long the signing takes
        if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
        void this.auth(m[1]).then((ev) => { this.authEvent = ev.id; this.raw(["AUTH", ev]); }, (e) => this.onStatus({ status: "closed", why: `sign-in refused: ${e instanceof Error ? e.message : String(e)}` }));
        return;
      }
      case "OK": {
        const [, id, ok, message] = m as [string, string, boolean, string];
        if (id === this.authEvent) {
          if (ok) { this.ready(); return; }
          this.onStatus({ status: "closed", why: `the relay refused the sign-in: ${message ?? ""}` });
          // what waited for the sign-in is told it failed, and never goes out later
          this.failWaiting("the relay refused the sign-in");
          return;
        }
        const w = this.waiting.get(id);
        if (w) { clearTimeout(w.timer); this.waiting.delete(id); w.resolve({ ok: ok === true, message: typeof message === "string" ? message : "" }); }
        return;
      }
      case "EVENT": { const s = this.subs.get(m[1]); if (s && m[2] && typeof m[2] === "object") s.onEvent(m[2] as SignedEvent); return; }
      case "EOSE": { this.subs.get(m[1])?.onEose(); return; }
      case "CLOSED": {
        const s = this.subs.get(m[1]);
        const why = typeof m[2] === "string" ? m[2] : "";
        // refused before the sign-in finished: it goes again once signed in
        if (s && why.startsWith("auth-required") && !this.authed) return;
        if (s) { this.subs.delete(m[1]); s.onClosed(why); }
        return;
      }
    }
  }

  /** `urgent`: a read a post waits on (a deletion's targets): it goes in the posts' lane, ahead of subscriptions. */
  subscribe(id: string, filters: Record<string, unknown>[], onEvent: Sub["onEvent"], onEose: Sub["onEose"], onClosed: Sub["onClosed"], urgent = false) {
    this.subs.set(id, { filters, onEvent, onEose, onClosed });
    if (urgent) this.urgent.add(id);
    // before the sign-in, `ready` sends every subscription: never queued as well (it would go twice)
    if (this.authed) this.raw(["REQ", id, ...filters]);
  }
  unsubscribe(id: string) {
    if (!this.subs.delete(id)) return;
    this.urgent.delete(id);
    // a REQ still waiting to go out is simply not sent; only one the relay has gets a CLOSE (else the CLOSE would
    // overtake it, and the relay keep a subscription nobody listens to)
    const notThis = (m: unknown) => !(Array.isArray(m) && m[0] === "REQ" && m[1] === id);
    this.reqs = this.reqs.filter(notThis); this.posts = this.posts.filter(notThis); this.queue = this.queue.filter(notThis);
    if (this.sent.delete(id) && this.authed) this.raw(["CLOSE", id]);
  }
  get subscriptions() { return this.subs.size; }
  has(id: string) { return this.subs.has(id); }

  publish(ev: SignedEvent): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(ev.id);
        // told it failed: if it was still waiting for a sign-in, it doesn't go out later
        const other = (m: unknown) => !(Array.isArray(m) && m[0] === "EVENT" && (m[1] as SignedEvent)?.id === ev.id);
        this.queue = this.queue.filter(other); this.posts = this.posts.filter(other);
        resolve({ ok: false, message: "no answer from the relay" });
      }, OK_WAIT_MS);
      this.waiting.set(ev.id, { resolve, timer });
      this.send(["EVENT", ev]);
    });
  }

  close() {
    this.closedForGood = true;
    if (this.authTimer) clearTimeout(this.authTimer);
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: "closed" }); }
    this.waiting.clear(); this.subs.clear(); this.queue = []; this.dropOutbox();
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }
}
