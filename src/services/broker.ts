// The broker for one applet's session (docs/design/SERVICES.md): what the frame's `services` calls do. It holds the
// policy (which service, which call; the checks in applet/services.ts), the relay connections and the queue of events
// back to the frame; every signature and every signed request is the native side's (native.ts), which checks again.
import { checkFilters, checkPublish, isCommandApproval, METHODS, REQUEST_HEADERS, requestUrl, LIMITS, originOf, type HttpService, type RelayService, type Service } from "../applet/services";
import type { Native, SecretView, SignedEvent } from "./native";
import { RelayConn, type Status } from "./relay";
import { verifyEvent } from "nostr-tools/pure";

export class BrokerError extends Error {
  constructor(public code: "not_granted" | "out_of_scope" | "bad_params" | "failed", message?: string) { super(message ?? code); }
}

export const toB64 = (b: Uint8Array): string => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** What goes back to the frame on its own: relay events (batched) and connection status. */
export type Emit = (event: "services.events" | "services.status", data: unknown) => void;
type Pending = { events: SignedEvent[]; eose: boolean };

const BATCH_MS = 50, BATCH_MAX = 200, IN_FLIGHT_MAX = 50 * 1024 * 1024;

/** What the shell around the frame gives the broker for approvals (docs/design/KEYRING.md): a tap in this applet's
 *  frame, used up by the call that takes it; its own sheet for a secret (null: the person cancelled); its own line
 *  over the applet. */
export type Shell = { tap: () => boolean; secret: (v: SecretView) => Promise<string | null>; say: (text: string) => void };
const NO_SHELL: Shell = { tap: () => false, secret: async () => null, say: () => {} };

export function createBroker(opts: { native: Native; session: string; applet: { name: string; subject: string }; services: Service[]; hubs: string[]; emit: Emit; socket?: (url: string) => WebSocket; shell?: Shell }) {
  const shell = opts.shell ?? NO_SHELL;
  const { native, session, emit } = opts;
  const byId = new Map(opts.services.map((s) => [s.id, s]));
  const conns = new Map<string, RelayConn>();
  const pending = new Map<string, Pending>(); // `${service}\u0000${sub}`
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let inFlight = 0;
  const opened = native.open(session, opts.applet, opts.services, opts.hubs);
  // a failed open is said once per call that needed it, never an unhandled rejection
  opened.catch(() => {});

  const service = (id: unknown): Service => {
    const s = typeof id === "string" ? byId.get(id) : undefined;
    if (!s) throw new BrokerError("not_granted", "it didn't declare that service");
    return s;
  };
  const relayOf = (id: unknown): RelayService => { const s = service(id); if (s.kind !== "nostr-relay") throw new BrokerError("bad_params", "that service isn't a relay"); return s; };
  const httpOf = (id: unknown): HttpService => { const s = service(id); if (s.kind !== "http") throw new BrokerError("bad_params", "that service isn't http"); return s; };
  const approverOf = (id: unknown): RelayService => { const s = relayOf(id); if (!s.approvals) throw new BrokerError("not_granted", "it may not answer approvals there"); return s; };
  /** A card is a signed kind 9 in one of its rooms (when it has rooms): Rust checks the rest. */
  const cardEvent = (s: RelayService, raw: unknown): SignedEvent => {
    const e = raw as SignedEvent;
    if (!e || typeof e !== "object" || e.kind !== 9 || !verifyEvent(e as Parameters<typeof verifyEvent>[0])) throw new BrokerError("bad_params", "a card is a signed message");
    const room = e.tags.find((t) => t[0] === "h")?.[1];
    if (s.rooms?.length && !(room && s.rooms.some((r) => r.id === room))) throw new BrokerError("out_of_scope", "that card isn't in its rooms");
    return { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig };
  };

  function flush() {
    flushTimer = null;
    for (const [k, p] of pending) {
      const [svc, sub] = k.split("\u0000");
      while (p.events.length || p.eose) {
        const events = p.events.splice(0, BATCH_MAX);
        const eose = p.eose && !p.events.length;
        if (eose) p.eose = false;
        emit("services.events", { service: svc, sub, events, eose });
        if (!events.length) break;
      }
    }
    pending.clear();
  }
  const later = () => { if (!flushTimer && !closed) flushTimer = setTimeout(flush, BATCH_MS); };

  function conn(s: RelayService): RelayConn {
    // a call that was on its way when the frame closed makes no new connection (it would sign in and reconnect for ever)
    if (closed) throw new BrokerError("failed", "the applet closed");
    let c = conns.get(s.id);
    if (!c) {
      const status = (st: Status) => { if (!closed) emit("services.status", { service: s.id, ...st }); };
      c = new RelayConn(s.url, async (challenge) => { await opened; return native.relayAuth(session, s.id, challenge); }, status, opts.socket);
      conns.set(s.id, c);
    }
    return c;
  }

  /** One read until EOSE. A person (or a post) waits on it, so it goes ahead of live subscriptions still waiting to
   *  go out: a room opened while a rooms applet is subscribing to all of them shows at once. */
  async function queryOnce(s: RelayService, filters: Record<string, unknown>[], max = LIMITS.history * LIMITS.filters): Promise<SignedEvent[]> {
    const c = conn(s);
    const id = `q${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      const got: SignedEvent[] = [];
      const done = () => { clearTimeout(t); c.unsubscribe(id); resolve(got); };
      const t = setTimeout(done, 15_000);
      c.subscribe(id, filters, (e) => { if (got.length < max) got.push(e); }, done, () => { clearTimeout(t); resolve(got); }, true);
    });
  }

  const bytesIn = (n: number) => {
    if (n > LIMITS.bytes) throw new BrokerError("bad_params", "at most 25 MB");
    if (inFlight + n > IN_FLIGHT_MAX) throw new BrokerError("failed", "too much is on its way");
    inFlight += n;
    return () => { inFlight -= n; };
  };

  return {
    async me() { if (!opts.services.some((s) => s.kind === "nostr-relay" || s.auth === "nip98")) throw new BrokerError("not_granted"); return { pubkey: (await opened).pubkey }; },

    async fetch(p: { service: string; path: string; method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer; as?: "text" | "json" | "bytes" }) {
      const s = httpOf(p.service);
      const method = (p.method ?? "GET").toUpperCase();
      if (!METHODS.includes(method)) throw new BrokerError("bad_params", "that method isn't one a service takes");
      const url = requestUrl(s, p.path);
      if (!url.ok) throw new BrokerError("out_of_scope", url.error);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.headers ?? {})) if (REQUEST_HEADERS.includes(k.toLowerCase()) && typeof v === "string" && v.length <= 1000) headers[k.toLowerCase()] = v;
      const bytes = p.body === undefined ? null : typeof p.body === "string" ? new TextEncoder().encode(p.body) : new Uint8Array(p.body);
      // an approve op (KEYRING.md) is an approval: a tap pays for it; which key signs it is Rust's to work out again
      if (s.approve && bytes) {
        let op: unknown;
        try { const j = JSON.parse(new TextDecoder().decode(bytes)); op = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>)[s.approve.field] : undefined; } catch { op = undefined; }
        if (typeof op === "string" && s.approve.ops.includes(op) && !shell.tap()) throw new BrokerError("not_granted", "an approval needs your tap in the applet");
      }
      const release = bytesIn(bytes?.length ?? 0);
      try {
        await opened;
        const res = await native.http(session, s.id, { method, path: p.path, headers, ...(bytes ? { body: toB64(bytes) } : {}) });
        if (res.graced) shell.say("Approved with your approval key: your unlock a moment ago covered it.");
        const body = fromB64(res.body);
        const as = p.as ?? "text";
        const out = as === "bytes" ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new TextDecoder().decode(body);
        if (as === "json") { try { return { status: res.status, headers: res.headers, body: JSON.parse(out as string) }; } catch { return { status: res.status, headers: res.headers, body: null }; } }
        return { status: res.status, headers: res.headers, body: out };
      } finally { release(); }
    },

    /** One subscription, or several in one request (`subs`): a rooms applet holds one a room. */
    subscribe(p: { service: string; sub?: string; filters?: unknown; subs?: { sub: string; filters: unknown }[] }) {
      const s = relayOf(p.service);
      const list = p.subs ?? [{ sub: p.sub!, filters: p.filters }];
      const checked = list.map((x) => { const f = checkFilters(x.filters, s.rooms); if (!f.ok) throw new BrokerError("bad_params", f.error); return { sub: x.sub, filters: f.value }; });
      const c = conn(s);
      // one sent again (the kit retries a request that timed out) replaces itself: only new ones count
      if (c.subscriptions + checked.filter((x) => !c.has(`a:${x.sub}`)).length > LIMITS.subs) throw new BrokerError("failed", `at most ${LIMITS.subs} subscriptions`);
      for (const { sub, filters } of checked) {
        const key = `${s.id}\u0000${sub}`;
        c.subscribe(`a:${sub}`, filters, (e) => {
          if (closed) return;
          const q = pending.get(key) ?? { events: [], eose: false };
          q.events.push(e); pending.set(key, q);
          // to the frame in batches: a full one at once, else within BATCH_MS
          if (q.events.length >= BATCH_MAX) flush(); else later();
        }, () => { const q = pending.get(key) ?? { events: [], eose: false }; q.eose = true; pending.set(key, q); later(); },
        // a relay that wants a sign-in first, had an error, or asks to slow down, is worth asking again (`retry`, after
        // the wait it names); another refusal stands
        (why) => {
          if (closed) return;
          const after = /retry in (\d+)/i.exec(why);
          emit("services.status", { service: s.id, status: "closed", sub, why: `the relay closed it: ${why}`, retry: /^(auth-required|error|rate-limited)/.test(why), ...(after ? { after: Math.min(300, Number(after[1])) } : {}) });
        });
      }
      return true;
    },

    /** One subscription, or several in one request (`subs`): stopping a rooms applet's 90 takes a few. */
    unsubscribe(p: { service: string; sub?: string; subs?: string[] }) {
      const s = relayOf(p.service);
      for (const sub of p.subs ?? [p.sub!]) conns.get(s.id)?.unsubscribe(`a:${sub}`);
      return true;
    },

    async query(p: { service: string; filters: unknown }) {
      const s = relayOf(p.service);
      const f = checkFilters(p.filters, s.rooms);
      if (!f.ok) throw new BrokerError(s.rooms?.length ? "out_of_scope" : "bad_params", f.error);
      return queryOnce(s, f.value);
    },

    async publish(p: { service: string; event: unknown }) {
      const s = relayOf(p.service);
      const t = checkPublish(s, p.event);
      if (!t.ok) throw new BrokerError("out_of_scope", t.error);
      if (t.value.kind === 9 && isCommandApproval(t.value.content)) {
        // a bot's approval (Hermes's /approve) is an approval: the grant, and a tap
        if (!s.approvals) throw new BrokerError("not_granted", "answering a bot's approval needs the approvals grant");
        if (!shell.tap()) throw new BrokerError("not_granted", "an approval needs your tap in the applet");
      }
      const me = (await opened).pubkey;
      if (s.rooms?.length && [7, 40003, 5].includes(t.value.kind)) {
        // a reaction, edit or deletion acts on an event: it must be in one of its rooms (read from the relay, as signed)
        const ids = t.value.tags.filter((x) => x[0] === "e").map((x) => x[1]);
        const found = ids.length ? await queryOnce(s, [{ ids }], ids.length) : [];
        for (const id of ids) {
          const e = found.find((x) => x.id === id);
          const room = e?.tags.find((x) => x[0] === "h")?.[1];
          if (!e || !verifyEvent(e as Parameters<typeof verifyEvent>[0]) || !room || !s.rooms.some((r) => r.id === room)) throw new BrokerError("out_of_scope", "it may act only on events in its rooms");
        }
      }
      if (t.value.kind === 5) {
        // a deletion only of the person's own events, of a kind this applet may publish, read from the relay first
        const ids = t.value.tags.filter((x) => x[0] === "e").map((x) => x[1]);
        const found = await queryOnce(s, [{ ids }], ids.length);
        for (const id of ids) {
          const e = found.find((x) => x.id === id);
          // checked as signed (a relay could hand back anything), the person's, of a kind this applet may publish
          if (!e || !verifyEvent(e as Parameters<typeof verifyEvent>[0]) || e.pubkey !== me || !s.publish.includes(e.kind) || e.kind === 5) throw new BrokerError("out_of_scope", "it may delete only your own posts of its kinds");
        }
      }
      const ev = await native.signEvent(session, s.id, t.value);
      const r = await conn(s).publish(ev); // conn() refuses once closed
      return { ...r, id: ev.id, event: ev };
    },

    async loadPrivate(p: { service: string; d: string }) {
      const s = relayOf(p.service);
      const entry = s.private.find((e) => e.d === p.d);
      if (!entry) throw new BrokerError("not_granted", "it didn't declare those private notes");
      const me = (await opened).pubkey;
      const events = await queryOnce(s, [{ kinds: [entry.kind], authors: [me], "#t": [entry.t], limit: LIMITS.history }], LIMITS.history);
      const out: { d: string; text: string; created_at: number }[] = [];
      for (const e of events) {
        const d = e.tags.find((x) => x[0] === "d")?.[1] ?? "";
        if (e.pubkey !== me || !d.startsWith(entry.d)) continue;
        try { out.push({ d, text: await native.privateOpen(session, s.id, e), created_at: e.created_at }); } catch { /* not one it can open */ }
      }
      return out;
    },

    async savePrivate(p: { service: string; d: string; text: string }) {
      const s = relayOf(p.service);
      if (typeof p.d !== "string" || p.d.length > 128 || !s.private.some((e) => p.d.startsWith(e.d))) throw new BrokerError("out_of_scope", "not one of its private notes");
      if (typeof p.text !== "string" || p.text.length > 32 * 1024) throw new BrokerError("bad_params", "at most 32 KiB");
      await opened;
      const ev = await native.privateSave(session, s.id, p.d, p.text);
      return conn(s).publish(ev);
    },

    async upload(p: { service: string; bytes: ArrayBuffer; type: string }) {
      const s = relayOf(p.service);
      if (!s.media) throw new BrokerError("not_granted", "it didn't declare media there");
      if (typeof p.type !== "string" || !/^[a-z]+\/[a-z0-9.+-]{1,80}$/i.test(p.type)) throw new BrokerError("bad_params", "a type is like image/png");
      const release = bytesIn(p.bytes.byteLength);
      try { await opened; return await native.upload(session, s.id, toB64(new Uint8Array(p.bytes)), p.type); } finally { release(); }
    },

    async media(p: { service: string; sha256: string; ext: string }) {
      const s = relayOf(p.service);
      if (!s.media) throw new BrokerError("not_granted", "it didn't declare media there");
      if (!/^[0-9a-f]{64}$/.test(p.sha256) || !/^[a-z0-9]{1,8}$/.test(p.ext)) throw new BrokerError("bad_params", "a file is its sha256 and extension");
      await opened;
      const r = await native.media(session, s.id, p.sha256, p.ext);
      const b = fromB64(r.body);
      return { type: r.type, bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },

    // ── approvals (docs/design/KEYRING.md) ──

    /** Uni's card in a room message, as Rust checked it. */
    async card(p: { service: string; event: unknown }) {
      const s = approverOf(p.service);
      const ev = cardEvent(s, p.event);
      await opened;
      return native.cardView(session, s.id, ev);
    },

    /** Answer rows of a card. Needs a tap in this applet; the unlock is Rust's. The wraps go to the relay from here and
     *  never reach the frame. */
    async answer(p: { service: string; event: unknown; decision: unknown; rids: unknown }) {
      const s = approverOf(p.service);
      const ev = cardEvent(s, p.event);
      if (p.decision !== "approve" && p.decision !== "deny") throw new BrokerError("bad_params", "a decision is approve or deny");
      if (!Array.isArray(p.rids) || !p.rids.length || p.rids.length > 20 || !p.rids.every((r) => typeof r === "string" && /^[0-9a-f]{32}$/.test(r))) throw new BrokerError("bad_params", "rids are the card's request ids");
      if (!shell.tap()) throw new BrokerError("not_granted", "an answer needs your tap in the applet");
      await opened;
      const r = await native.cardAnswer(session, s.id, ev, p.decision, p.rids as string[]);
      const sent: string[] = [];
      let failed: string | null = null;
      for (const w of r.wraps) {
        const res = await conn(s).publish(w.wrap);
        if (res.ok) { sent.push(w.rid); await native.cardSent(session, s.id, ev.id, w.rid).catch(() => {}); } else { failed = res.message || "the relay refused it"; break; }
      }
      if (r.graced) shell.say(r.summary);
      const view = await native.cardView(session, s.id, ev);
      return { view, sent, ...(failed ? { failed } : {}) };
    },

    /** A secret request: the shell's own sheet takes the value; the applet hears only whether it went. */
    async secret(p: { service: string; event: unknown }) {
      const s = approverOf(p.service);
      const ev = cardEvent(s, p.event);
      if (!shell.tap()) throw new BrokerError("not_granted", "a secret needs your tap in the applet");
      await opened;
      const v = await native.secretView(session, s.id, ev);
      const value = await shell.secret(v);
      if (value === null) return { sent: false };
      const wrap = await native.secretSend(session, s.id, ev, value);
      const res = await conn(s).publish(wrap);
      return { sent: res.ok, ...(res.ok ? {} : { failed: res.message || "the relay refused it" }) };
    },

    /** Ask the requester to forget what it kept for this request. */
    async forgetSecret(p: { service: string; event: unknown }) {
      const s = approverOf(p.service);
      const ev = cardEvent(s, p.event);
      if (!shell.tap()) throw new BrokerError("not_granted", "this needs your tap in the applet");
      await opened;
      const wrap = await native.secretForget(session, s.id, ev);
      const res = await conn(s).publish(wrap);
      return { sent: res.ok };
    },

    /** The origins it may reach, for the applet's settings page. */
    origins: () => opts.services.map(originOf),

    close() {
      if (closed) return;
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      for (const c of conns.values()) c.close();
      conns.clear();
      void native.close(session).catch(() => {});
    },
  };
}
export type Broker = ReturnType<typeof createBroker>;
