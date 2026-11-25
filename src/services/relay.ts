// One relay connection the shell holds for an applet's session (docs/design/SERVICES.md): a WebSocket in the shell's own
// window, never the frame's. It answers the relay's NIP-42 challenge with an event the native side signs for the
// declared relay, holds REQs and EVENTs until signed in (a Buzz relay refuses both before), sends REQs again after a
// sign-in or a reconnect, and resolves a publish on the relay's OK. A publish outlives a dropped connection: it is sent
// again, the same signed event, after the next sign-in (a relay that already has it answers OK "duplicate:"), and fails
// only when its own wait runs out (T-476: a phone just waking, or off the tailnet a moment, dropped the connection and
// the message was told "connection closed"). Woken (the app back in front, the network back), a connection waiting to
// try again tries at once, and one that may have died while the device slept is checked.
import type { SignedEvent } from "./native";

export type Status = { status: "connecting" | "ready" | "closed"; why?: string };
type Sub = { filters: Record<string, unknown>[]; onEvent: (e: SignedEvent) => void; onEose: () => void; onClosed: (why: string) => void };
type Waiter = { ev: SignedEvent; resolve: (r: { ok: boolean; message: string }) => void; timer: ReturnType<typeof setTimeout> };

const AUTH_WAIT_MS = 2500;
/** A relay counts the posts and subscriptions a person sends (Buzz: 50 in a fixed 5 s window by default, across all of
 *  their connections; past it, they are refused). The shell keeps well under that, leaving room for the person's other
 *  apps: a burst of 10, then 7 a second (at most 45 in any 5 s); posts go before subscriptions, and sign-ins and
 *  CLOSEs (not counted) go at once. */
const PACE_BURST = 10, PACE_PER_SEC = 7;
const OK_WAIT_MS = 15_000;
/** Woken after this long away, an open connection is asked for a sign of life (a socket can die unseen while a phone
 *  sleeps), and dropped for a new one if none comes within PROBE_WAIT_MS. */
const AWAY_MS = 20_000, PROBE_WAIT_MS = 4000;

export class RelayConn {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Sub>();
  private waiting = new Map<string, Waiter>();
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
  private againTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenAt = 0;
  private probe: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private unwake: () => void = () => {};

  constructor(private url: string, private auth: (challenge: string) => Promise<SignedEvent>, private onStatus: (s: Status) => void, private socket: (url: string) => WebSocket = (u) => new WebSocket(u)) {
    this.connect();
    // the app back in front, or the network back: don't wait out the growing pause
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const online = () => this.wake(true);
      const seen = () => { if (document.visibilityState === "hidden") this.hiddenAt = Date.now(); else this.wake(); };
      window.addEventListener("online", online);
      document.addEventListener("visibilitychange", seen);
      this.unwake = () => { window.removeEventListener("online", online); document.removeEventListener("visibilitychange", seen); };
    }
  }

  /** The device is back (in front, or online): a connection waiting to try again tries now; an open one that was away
   *  a while is asked for a sign of life, and dropped for a new one when none comes. `network`: the network itself came
   *  back, so a socket still trying to connect over the old one is given up for a new one. */
  wake(network = false) {
    if (this.closedForGood) return;
    const away = this.hiddenAt && Date.now() - this.hiddenAt > AWAY_MS;
    this.hiddenAt = 0;
    if (!this.ws && this.againTimer) { this.tries = 0; this.connectNow(); return; }
    if (network && this.ws && !this.open) { this.drop("the network changed"); return; }
    if (this.ws && this.open && this.authed && away && !this.probe) {
      // a read of nothing: any relay answers it with EOSE at once
      const id = `p${Math.random().toString(36).slice(2, 10)}`;
      this.probe = { id, timer: setTimeout(() => { this.probe = null; this.drop("no sign of life from the relay"); }, PROBE_WAIT_MS) };
      this.ws.send(JSON.stringify(["REQ", id, { ids: ["0".repeat(64)], limit: 1 }]));
    }
  }

  /** Waiting out a pause before trying again: try now (the pause still grows if this try fails too). */
  private connectNow() {
    if (this.ws || !this.againTimer || this.closedForGood) return false;
    clearTimeout(this.againTimer); this.againTimer = null;
    this.connect();
    return true;
  }

  /** Give up on this socket now (it may never say it closed) and connect again. */
  private drop(why: string) {
    const ws = this.ws;
    if (!ws) return;
    ws.onclose = null; ws.onmessage = null; ws.onopen = null;
    try { ws.close(); } catch { /* gone */ }
    this.closed(why);
    // it was this side that gave up on it, not the relay: a new one at once
    this.tries = 0; this.connectNow();
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
    ws.onclose = () => this.closed("the relay closed the connection");
  }

  private closed(why: string) {
    // not signed in any more: what is sent from now waits for the next sign-in
    this.ws = null; this.open = false; this.authed = false;
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.probe) { clearTimeout(this.probe.timer); this.probe = null; }
    if (this.closedForGood) return;
    this.onStatus({ status: "closed", why });
    // a publish in flight keeps waiting (its own timer): it goes again, the same event, after the next sign-in
    this.dropOutbox();
    this.again();
  }

  /** Every publish waiting is answered "failed", and none of them is sent afterwards. */
  private failWaiting(why: string) {
    for (const [id, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: why }); this.waiting.delete(id); }
    this.posts = this.posts.filter((m) => !(Array.isArray(m) && m[0] === "EVENT"));
  }

  /** Connect again after a growing wait (a dropped socket, or one that couldn't be made). */
  private again() {
    if (this.closedForGood) return;
    if (this.againTimer) clearTimeout(this.againTimer);
    const wait = Math.min(30_000, 1000 * 2 ** this.tries++);
    this.againTimer = setTimeout(() => { this.againTimer = null; this.connect(); }, wait);
  }

  private ready() {
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.authed = true;
    this.onStatus({ status: "ready" });
    for (const [id, s] of this.subs) this.raw(["REQ", id, ...s.filters]);
    // every publish still waiting for its OK: made before the sign-in, or sent on a connection that dropped
    for (const [, w] of this.waiting) this.raw(["EVENT", w.ev]);
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
      case "EOSE": {
        if (this.probe && m[1] === this.probe.id) { clearTimeout(this.probe.timer); this.ws?.send(JSON.stringify(["CLOSE", this.probe.id])); this.probe = null; return; }
        this.subs.get(m[1])?.onEose(); return;
      }
      case "CLOSED": {
        const s = this.subs.get(m[1]);
        const why = typeof m[2] === "string" ? m[2] : "";
        // refused before the sign-in finished: it goes again once signed in
        if (s && why.startsWith("auth-required") && !this.authed) return;
        if (s) { this.subs.delete(m[1]); this.urgent.delete(m[1]); this.sent.delete(m[1]); s.onClosed(why); }
        return;
      }
    }
  }

  /** `urgent`: a one-time read someone waits on: it goes in the posts' lane, ahead of live subscriptions. */
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
    this.reqs = this.reqs.filter(notThis); this.posts = this.posts.filter(notThis);
    if (this.sent.delete(id) && this.authed) this.raw(["CLOSE", id]);
  }
  get subscriptions() { return this.subs.size; }
  has(id: string) { return this.subs.has(id); }

  publish(ev: SignedEvent): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      // the same event asked again while it waits (a second tap): one wait, and both are told its answer
      const was = this.waiting.get(ev.id);
      if (was) { const first = was.resolve; was.resolve = (r) => { first(r); resolve(r); }; if (!this.authed) this.connectNow(); return; }
      const timer = setTimeout(() => {
        const w = this.waiting.get(ev.id);
        this.waiting.delete(ev.id);
        // told it failed: if it was still waiting for a sign-in, it doesn't go out later
        this.posts = this.posts.filter((m) => !(Array.isArray(m) && m[0] === "EVENT" && (m[1] as SignedEvent)?.id === ev.id));
        w?.resolve({ ok: false, message: this.authed ? "no answer from the relay" : "can't reach the relay" });
      }, OK_WAIT_MS);
      this.waiting.set(ev.id, { ev, resolve, timer });
      // signed in: it goes now; else after the sign-in (`ready` sends every publish waiting), and a connection waiting
      // out its pause tries at once (a person is waiting on this)
      if (this.authed) this.raw(["EVENT", ev]); else this.connectNow();
    });
  }

  close() {
    this.closedForGood = true;
    this.unwake();
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.againTimer) clearTimeout(this.againTimer);
    if (this.probe) clearTimeout(this.probe.timer);
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: "closed" }); }
    this.waiting.clear(); this.subs.clear(); this.dropOutbox();
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }
}
