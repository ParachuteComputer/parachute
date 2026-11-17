// One relay connection the shell holds for an applet's session (docs/design/SERVICES.md): a WebSocket in the shell's own
// window, never the frame's. It answers the relay's NIP-42 challenge with an event the native side signs for the
// declared relay, holds REQs and EVENTs until signed in (a Buzz relay refuses both before), sends REQs again after a
// sign-in or a reconnect, and resolves a publish on the relay's OK.
import type { SignedEvent } from "./native";

export type Status = { status: "connecting" | "ready" | "closed"; why?: string };
type Sub = { filters: Record<string, unknown>[]; onEvent: (e: SignedEvent) => void; onEose: () => void; onClosed: (why: string) => void };
type Waiter = { resolve: (r: { ok: boolean; message: string }) => void; timer: ReturnType<typeof setTimeout> };

const AUTH_WAIT_MS = 2500;
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

  constructor(private url: string, private auth: (challenge: string) => Promise<SignedEvent>, private onStatus: (s: Status) => void, private socket: (url: string) => WebSocket = (u) => new WebSocket(u)) {
    this.connect();
  }

  private connect() {
    if (this.closedForGood) return;
    this.onStatus({ status: "connecting" });
    this.authed = false; this.open = false; this.authEvent = null;
    let ws: WebSocket;
    try { ws = this.socket(this.url); } catch (e) { this.onStatus({ status: "closed", why: e instanceof Error ? e.message : "couldn't connect" }); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true; this.tries = 0;
      // a relay that asks no sign-in: go on after a moment
      this.authTimer = setTimeout(() => { if (!this.authed) this.ready(); }, AUTH_WAIT_MS);
    };
    ws.onmessage = (m) => this.message(m.data);
    ws.onclose = () => {
      this.ws = null; this.open = false;
      if (this.authTimer) clearTimeout(this.authTimer);
      if (this.closedForGood) return;
      this.onStatus({ status: "closed", why: "the relay closed the connection" });
      // a publish in flight gets its answer now, never a hang
      for (const [id, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: "connection closed" }); this.waiting.delete(id); }
      const wait = Math.min(30_000, 1000 * 2 ** this.tries++);
      setTimeout(() => this.connect(), wait);
    };
  }

  private ready() {
    if (this.authTimer) { clearTimeout(this.authTimer); this.authTimer = null; }
    this.authed = true;
    this.onStatus({ status: "ready" });
    for (const [id, s] of this.subs) this.raw(["REQ", id, ...s.filters]);
    const q = this.queue; this.queue = [];
    for (const m of q) this.raw(m);
  }

  private raw(m: unknown) { if (this.ws && this.open) this.ws.send(JSON.stringify(m)); }
  private send(m: unknown) { if (this.authed) this.raw(m); else this.queue.push(m); }

  private message(data: unknown) {
    let m: unknown;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!Array.isArray(m) || typeof m[0] !== "string") return;
    switch (m[0]) {
      case "AUTH": {
        if (typeof m[1] !== "string") return;
        void this.auth(m[1]).then((ev) => { this.authEvent = ev.id; this.raw(["AUTH", ev]); }, (e) => this.onStatus({ status: "closed", why: `sign-in refused: ${e instanceof Error ? e.message : String(e)}` }));
        return;
      }
      case "OK": {
        const [, id, ok, message] = m as [string, string, boolean, string];
        if (id === this.authEvent) { if (ok) this.ready(); else this.onStatus({ status: "closed", why: `the relay refused the sign-in: ${message ?? ""}` }); return; }
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

  subscribe(id: string, filters: Record<string, unknown>[], onEvent: Sub["onEvent"], onEose: Sub["onEose"], onClosed: Sub["onClosed"]) {
    this.subs.set(id, { filters, onEvent, onEose, onClosed });
    this.send(["REQ", id, ...filters]);
  }
  unsubscribe(id: string) {
    if (this.subs.delete(id)) this.send(["CLOSE", id]);
  }
  get subscriptions() { return this.subs.size; }

  publish(ev: SignedEvent): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(ev.id); resolve({ ok: false, message: "no answer from the relay" }); }, OK_WAIT_MS);
      this.waiting.set(ev.id, { resolve, timer });
      this.send(["EVENT", ev]);
    });
  }

  close() {
    this.closedForGood = true;
    if (this.authTimer) clearTimeout(this.authTimer);
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ ok: false, message: "closed" }); }
    this.waiting.clear(); this.subs.clear(); this.queue = [];
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }
}
