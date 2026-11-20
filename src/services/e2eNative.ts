// TEST ONLY. The native side for the end-to-end tests of the web build, which has no key: the same calls, answered in
// JavaScript with a key the test puts on the page (window.__parachuteE2EKey). It signs what it is handed; the policy it
// sits under is the shipping web-side one (broker.ts, applet/services.ts), and the native side's own checks have their
// own tests (src-tauri/tests). It is compiled in only when the build sets VITE_E2E_SIGNER=1 (native.ts `nativeNow`),
// refuses to run in the app on a device, and CI checks the app's bundle has no trace of it (scripts/no-test-signer.sh).
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import type { Native, LogLine, SignedEvent, CardView } from "./native";
import { checkCard, deliveryWrap, forgetWrap, replyWrap, secretRequest, sealPub } from "./e2eCards";
import { originOf, RESPONSE_HEADERS, type Service } from "../applet/services";
import { fromB64, toB64 } from "./broker";
import { DEFAULTS, codeOf, floored, raise, type Level, type Levels, type LevelsStatus } from "../shell/levelRules";

export const E2E_SIGNER_MARK = "parachute-e2e-test-signer";

type Sess = { applet: { name: string; subject: string }; services: Map<string, Service> };

export function e2eNative(secretHex: string): Native {
  const sk = Uint8Array.from(secretHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const pubkey = getPublicKey(sk);
  const sessions = new Map<string, Sess>();
  // kept for the tab (a test goes to Settings and back, which reloads the page)
  const KEPT = "parachute.e2e.tokens";
  const tokens = new Map<string, string>(Object.entries((() => { try { return JSON.parse(sessionStorage.getItem(KEPT) ?? "{}") as Record<string, string>; } catch { return {}; } })()));
  const keepTokens = () => { try { sessionStorage.setItem(KEPT, JSON.stringify(Object.fromEntries(tokens))); } catch { /* this page only */ } };
  const logs = new Map<string, LogLine[]>();
  const now = () => Math.floor(Date.now() / 1000);
  // the security levels and the idle lock (src-tauri/src/levels.rs), kept for the tab like the passcode
  const LEVELS_KEPT = "parachute.e2e.levels";
  type KeptLevels = { levels: Levels; since: number; passcode: string | null; last: number | null; locked: boolean };
  const kept = (): KeptLevels => { try { const k = JSON.parse(sessionStorage.getItem(LEVELS_KEPT) ?? "null") as KeptLevels | null; if (k) return k; } catch { /* fresh */ } return { levels: DEFAULTS, since: 0, passcode: null, last: Date.now(), locked: false }; };
  const keep = (k: KeptLevels) => { try { sessionStorage.setItem(LEVELS_KEPT, JSON.stringify(k)); } catch { /* this page */ } };
  let passcode: string | null = kept().passcode;
  const unlockHook = () => (window as unknown as { __parachuteE2EUnlock?: string }).__parachuteE2EUnlock;
  /** The gate (levels.rs `gate`): locked refuses; the passcode when the level asks it; then the unlock (the test's
   *  hook, `window.__parachuteE2EUnlock = "pass"`, else cancelled). */
  const gate = (level: Level, typed: string | null | undefined, unlocks: string[] | null, what: string) => {
    if (idle(false).locked) throw { code: "locked", message: "Parachute is locked. Unlock it first." };
    if (level === "none") return;
    if (level === "passcode") {
      if (passcode === null) throw { code: "passcode_unset", message: "This asks your passcode, and this device has none yet: set one in Settings → Security." };
      if (typed !== passcode) throw { code: "passcode", message: typed == null ? "Your passcode is needed for this." : "That passcode isn't it." };
    }
    unlocks?.push(what);
    if (unlockHook() !== "pass") throw { code: "unlock", message: "The device unlock was cancelled or failed." };
  };
  const idle = (touched: boolean): LevelsStatus => {
    const k = kept(), t = Date.now(), min = k.levels.idle;
    const lapsed = (last: number | null) => min > 0 && (last === null || t < last || t - last >= min * 60_000);
    if (!k.locked && lapsed(k.last)) k.locked = true;
    else if (!k.locked && touched) k.last = t;
    keep(k);
    return { levels: k.levels, passcode: passcode !== null, locked: k.locked, left_ms: min > 0 && !k.locked && k.last !== null ? Math.max(0, k.last + min * 60_000 - t) : null };
  };
  const setLevels = (levels: Levels, since: number) => { const k = kept(); const turnedOn = k.levels.idle === 0 && levels.idle > 0; keep({ ...k, levels: floored(levels), since: Math.max(since, k.since), last: turnedOn ? Date.now() : k.last }); return floored(levels); };
  const sign = (kind: number, content: string, tags: string[][]): SignedEvent => finalizeEvent({ kind, content, tags, created_at: now() }, sk) as SignedEvent;
  const sess = (id: string) => { const s = sessions.get(id); if (!s) throw new Error("no session"); return s; };
  const svc = (id: string, service: string) => { const s = sess(id).services.get(service); if (!s) throw new Error("no service"); return s; };
  const log = (session: string, service: string, what: string, id?: string) => {
    const s = sess(session); const l = logs.get(s.applet.subject) ?? [];
    l.push({ at: Math.floor(Date.now() / 1000), applet: s.applet.name, service, what, id }); logs.set(s.applet.subject, l.slice(-500));
  };
  const relayOrigin = (s: Service) => originOf(s);
  const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const authHeader = (ev: SignedEvent) => `Nostr ${btoa(JSON.stringify(ev))}`;
  const selfKey = () => nip44.getConversationKey(sk, pubkey);
  const tokenKey = (subject: string, s: Service) => `${subject}\u0000${s.id}\u0000${s.url}`;
  const answered = new Map<string, { rid: string; decision: "approve" | "deny"; at: number; until: number | null; sent: boolean }[]>();
  const approvers = () => ((window as unknown as { __parachuteE2EApprovers?: { name: string; pubkey: string }[] }).__parachuteE2EApprovers ?? []);
  /** The keys whose cards it answers: the grant's `from` that the device also trusts. */
  const trusted = (session: string, service: string) => { const s = svc(session, service); return s.kind === "nostr-relay" ? (s.approvals?.from ?? []).filter((k) => approvers().some((a) => a.pubkey === k)) : []; };
  return {
    async open(session, applet, services) { sessions.set(session, { applet, services: new Map(services.map((s) => [s.id, s])) }); return { pubkey }; },
    async close(session) { sessions.delete(session); },
    async relayAuth(session, service, challenge) { const s = svc(session, service); const ev = sign(22242, "", [["relay", s.url], ["challenge", challenge]]); log(session, service, "sign-in", ev.id); return ev; },
    async signEvent(session, service, t) { svc(session, service); const ev = sign(t.kind, t.content, t.tags); log(session, service, `kind ${t.kind}`, ev.id); return ev; },
    async http(session, service, req, typed) {
      const s = svc(session, service);
      const url = s.url + req.path.replace(/^\//, "");
      const body = req.body ? fromB64(req.body) : undefined;
      // an approve or join op passes this device's level first (services.rs `svc_http`)
      if (s.kind === "http" && body?.length && (s.approve || s.join)) {
        let j: Record<string, unknown> | null = null;
        try { j = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>; } catch { /* not JSON */ }
        const op = (f?: { field: string; ops: string[] }) => (f && j && typeof j[f.field] === "string" && f.ops.includes(j[f.field] as string) ? j[f.field] as string : null);
        const hook = window as unknown as { __parachuteE2EUnlocks?: string[] };
        if (op(s.approve)) gate(kept().levels.approvals, typed, (hook.__parachuteE2EUnlocks ??= []), `approve ${op(s.approve)}`);
        else if (op(s.join)) gate(kept().levels.join, typed, (hook.__parachuteE2EUnlocks ??= []), `join ${op(s.join)}`);
      }
      const headers: Record<string, string> = { ...req.headers };
      if (s.kind === "http" && s.auth === "nip98") {
        const tags = [["u", url], ["method", req.method], ["nonce", crypto.randomUUID()]];
        if (body?.length) tags.push(["payload", await sha256(body)]);
        // a join op's carries the join mark (services.rs JOIN_MARK)
        if (s.join && body?.length) { try { const j = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>; const op = j[s.join.field]; if (typeof op === "string" && s.join.ops.includes(op)) tags.push(["parachute", "join", op]); } catch { /* not JSON */ } }
        const ev = sign(27235, "", tags); headers.authorization = authHeader(ev); log(session, service, `${req.method} ${new URL(url).pathname}`, ev.id);
      } else if (s.kind === "http" && s.auth === "token") {
        const sealed = tokens.get(tokenKey(sess(session).applet.subject, s));
        if (sealed) headers.authorization = `Bearer ${nip44.decrypt(sealed, selfKey())}`;
      }
      const res = await fetch(url, { method: req.method, headers, body: body as BodyInit | undefined, redirect: "manual", credentials: "omit" });
      const keep: Record<string, string> = {};
      for (const k of RESPONSE_HEADERS) { const v = res.headers.get(k); if (v) keep[k] = v; }
      return { status: res.status, headers: keep, body: toB64(new Uint8Array(await res.arrayBuffer())) };
    },
    async upload(session, service, b64, type) {
      const s = svc(session, service); const bytes = fromB64(b64); const x = await sha256(bytes);
      const ev = sign(24242, "Upload", [["t", "upload"], ["x", x], ["server", new URL(relayOrigin(s)).host], ["expiration", String(now() + 300)]]);
      log(session, service, "upload", ev.id);
      for (const path of ["/upload", "/media/upload"]) {
        const res = await fetch(relayOrigin(s) + path, { method: "PUT", headers: { authorization: authHeader(ev), "x-sha-256": x, "content-type": type }, body: bytes as BodyInit });
        if (res.status === 404 || res.status === 405) continue;
        if (!res.ok) throw new Error(`upload refused: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
        return res.json();
      }
      throw new Error("no upload door");
    },
    async media(session, service, sha, ext) {
      const s = svc(session, service);
      const ev = sign(24242, "Get", [["t", "get"], ["x", sha], ["server", new URL(relayOrigin(s)).host], ["expiration", String(now() + 300)]]);
      log(session, service, "open a file", ev.id);
      const res = await fetch(`${relayOrigin(s)}/media/${sha}.${ext}`, { headers: { authorization: authHeader(ev) } });
      if (!res.ok) throw new Error(`file refused: ${res.status}`);
      return { type: res.headers.get("content-type") ?? "application/octet-stream", body: toB64(new Uint8Array(await res.arrayBuffer())) };
    },
    async privateOpen(session, service, ev) {
      svc(session, service);
      if (!verifyEvent(ev as Parameters<typeof verifyEvent>[0]) || ev.pubkey !== pubkey) throw new Error("not yours");
      return nip44.decrypt(ev.content, selfKey());
    },
    async privateSave(session, service, d, text) {
      const s = svc(session, service);
      const entry = s.kind === "nostr-relay" ? s.private.find((e) => d.startsWith(e.d)) : undefined;
      if (!entry) throw new Error("not declared");
      const ev = sign(30078, nip44.encrypt(text, selfKey()), [["d", d], ["t", entry.t]]); log(session, service, "private note", ev.id); return ev;
    },
    async tokenSet(subject, s, token) { if (token === null) tokens.delete(tokenKey(subject, s)); else tokens.set(tokenKey(subject, s), nip44.encrypt(token, selfKey())); keepTokens(); },
    async tokenHas(subject, s) { return tokens.has(tokenKey(subject, s)); },
    async log(subject) { return [...(logs.get(subject) ?? [])]; },
    // approvals (docs/design/KEYRING.md): the device's trusted list and the unlock are the test's (window hooks)
    async cardView(session, service, ev) {
      const answers = answered.get(ev.id);
      try {
        const c = checkCard(ev, trusted(session, service), sk);
        return { kind: "single", event_id: ev.id, refused: null, rows: c.rows.map((r) => ({ rid: r.f.rid as string, action: r.f.action as string, credential: r.f.credential as string, class: r.f.class as "routine" | "powerful",
          scope: r.f.scope as string, ttl_s: r.f.ttl_s as number, uses: r.f.uses as number, payload: r.f.payload, request_digest: r.digest, expires: r.f.expires as number,
          answer: answers?.find((a) => a.rid === r.f.rid) ?? null, always_unlock: r.f.class === "powerful", asked: ev.created_at, reach: null, read_key: null })) } satisfies CardView;
      } catch (e) {
        const s = svc(session, service);
        const from = s.kind === "nostr-relay" ? s.approvals?.from ?? [] : [];
        if ((e as Error).message === "Not signed by Uni." && verifyEvent(ev as Parameters<typeof verifyEvent>[0]) && from.includes(ev.pubkey) && !approvers().some((a) => a.pubkey === ev.pubkey))
          return { kind: null, event_id: ev.id, refused: "This device doesn't trust the key that signed this card yet.", trust: ev.pubkey, rows: [] };
        return { kind: null, event_id: ev.id, refused: (e as Error).message, rows: [] };
      }
    },
    async cardTrust(session, service, ev, name) {
      const s = svc(session, service);
      const from = s.kind === "nostr-relay" ? s.approvals?.from ?? [] : [];
      if (!from.includes(ev.pubkey) || approvers().some((a) => a.pubkey === ev.pubkey)) throw { code: "not_granted", message: "That key isn't one this applet names for approvals, or it is trusted already." };
      if (approvers().some((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase())) throw { code: "bad_params", message: "Another key already has that name." };
      const hook = window as unknown as { __parachuteE2EUnlock?: string; __parachuteE2EUnlocks?: string[]; __parachuteE2EApprovers?: { name: string; pubkey: string }[] };
      (hook.__parachuteE2EUnlocks ??= []).push(`trust ${name}`);
      if (hook.__parachuteE2EUnlock !== "pass") throw { code: "unlock", message: "The device unlock was cancelled or failed." };
      hook.__parachuteE2EApprovers = [...approvers(), { name, pubkey: ev.pubkey }];
      log(session, service, `trust ${name}'s key for approvals`, ev.id);
    },
    async cardAnswer(session, service, ev, decision, rids, typed) {
      const c = checkCard(ev, trusted(session, service), sk);
      if (answered.has(ev.id)) throw new Error("this card was already answered");
      const rows = c.rows.filter((r) => rids.includes(r.f.rid as string));
      if (decision === "approve") {
        const hook = window as unknown as { __parachuteE2EUnlocks?: string[] };
        // this device's level for approvals; a powerful row at least the unlock (cards.rs)
        const powerful = rows.some((r) => r.f.class === "powerful");
        const level = kept().levels.approvals;
        gate(powerful && level === "none" ? "unlock" : level, typed, (hook.__parachuteE2EUnlocks ??= []), rows.map((r) => `${r.f.class} ${r.f.credential}`).join(", "));
      }
      answered.set(ev.id, rows.map((r) => ({ rid: r.f.rid as string, decision, at: now(), until: decision === "approve" ? now() + (r.f.ttl_s as number) : null, sent: false })));
      const wraps = rows.map((r) => ({ rid: r.f.rid as string, wrap: replyWrap(sk, ev, r, decision) }));
      for (const w of wraps) log(session, service, `answer ${decision} (approval key)`, w.wrap.id);
      return { wraps, graced: false, summary: "" };
    },
    async cardSent(_s, _v, card, rid) { const a = answered.get(card)?.find((x) => x.rid === rid); if (a) a.sent = true; },
    async secretView(session, service, ev) {
      if (!trusted(session, service).includes(ev.pubkey) || !verifyEvent(ev as Parameters<typeof verifyEvent>[0])) throw { code: "not_granted", message: "this requester is not trusted for secrets" };
      const r = secretRequest(ev);
      return { requester: approvers().find((a) => a.pubkey === ev.pubkey)?.name ?? "?", rid: r.rid, name: r.name, label: r.label, purpose: r.purpose, store: r.store, keep_days: r.keep_days, expires: r.expires };
    },
    async secretSend(session, service, ev, value) { if (!trusted(session, service).includes(ev.pubkey)) throw new Error("untrusted"); const w = deliveryWrap(sk, ev, secretRequest(ev), value); log(session, service, "secret (approval key)", w.id); return w; },
    async secretForget(session, service, ev) { if (!trusted(session, service).includes(ev.pubkey)) throw new Error("untrusted"); return forgetWrap(sk, ev, secretRequest(ev)); },
    async keyring() { return { everyday: pubkey, approval: pubkey, same: true, seal_pub: sealPub(sk), approvers: approvers() }; },
    // approvals of code (src-tauri/src/approve.rs): the device unlock passes unless the test cancels it
    // (window.__parachuteE2EApprove = "cancel"); each prompt is kept in window.__parachuteE2EApprovals
    async approvalSign(content, d, name, code) {
      if (idle(false).locked) throw { code: "locked", message: "Parachute is locked. Unlock it first." };
      if (kept().levels.code === "passcode" && (JSON.parse(content) as { approved?: boolean }).approved) {
        if (passcode === null) throw { code: "passcode_unset", message: "This asks your passcode, and this device has none yet: set one in Settings → Security." };
        if (code !== passcode) throw { code: "passcode", message: code === null ? "Your passcode is needed for this." : "That passcode isn't it." };
      }
      const hook = window as unknown as { __parachuteE2EApprove?: string; __parachuteE2EApprovals?: string[] };
      (hook.__parachuteE2EApprovals ??= []).push(name);
      if (hook.__parachuteE2EApprove === "cancel") throw { code: "unlock", message: "The device unlock was cancelled or failed." };
      const c = JSON.parse(content) as { subject?: { hub?: string; vault?: string; record?: string } };
      if (d !== `${c.subject?.hub}|${c.subject?.vault}|${c.subject?.record}`) throw { code: "bad_request", message: "The approval names another applet than it says." };
      return finalizeEvent({ kind: 30479, created_at: now(), tags: [["d", d]], content }, sk) as SignedEvent;
    },
    async passcodeSet(old, next) { if (passcode !== null && old !== passcode) throw { code: "passcode", message: "That passcode isn't it." }; passcode = next; keep({ ...kept(), passcode }); },
    async levelsStatus() { return idle(false); },
    async levelsRaise(asked) { const k = kept(); const next = raise(k.levels, asked); return codeOf(next) === codeOf(k.levels) ? k.levels : setLevels(next, now()); },
    async levelsLower(content, d, code) {
      const c = JSON.parse(content) as { subject?: { applet?: string }; code?: string };
      const m = /^levels:v1:approvals=(none|unlock|passcode),code=(unlock|passcode),join=(none|unlock|passcode),idle=(\d{1,4})$/.exec(c.code ?? "");
      if (c.subject?.applet !== "security" || !m) throw { code: "bad_request", message: "That isn't a change of security levels." };
      const hook = window as unknown as { __parachuteE2EUnlocks?: string[] };
      gate(passcode !== null ? "passcode" : "unlock", code, (hook.__parachuteE2EUnlocks ??= []), "change your security");
      const ev = finalizeEvent({ kind: 30479, created_at: now(), tags: [["d", d]], content }, sk) as SignedEvent;
      setLevels({ approvals: m[1] as Level, code: m[2] as Level, join: m[3] as Level, idle: Number(m[4]) }, ev.created_at);
      return ev;
    },
    async levelsAdopt(ev) {
      const c = JSON.parse(ev.content) as { subject?: { applet?: string }; code?: string; approved?: boolean };
      const m = /^levels:v1:approvals=(none|unlock|passcode),code=(unlock|passcode),join=(none|unlock|passcode),idle=(\d{1,4})$/.exec(c.code ?? "");
      if (ev.kind !== 30479 || ev.pubkey !== pubkey || !verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]) || c.subject?.applet !== "security" || c.approved !== true || !m || ev.created_at <= kept().since)
        throw { code: "refused", message: "That change of security levels doesn't count here." };
      return setLevels({ approvals: m[1] as Level, code: m[2] as Level, join: m[3] as Level, idle: Number(m[4]) }, ev.created_at);
    },
    async idleTouch() { return idle(true); },
    async idleUnlock() {
      const hook = window as unknown as { __parachuteE2EUnlocks?: string[] };
      (hook.__parachuteE2EUnlocks ??= []).push("open Parachute");
      if (unlockHook() !== "pass") throw { code: "unlock", message: "The device unlock was cancelled or failed." };
      keep({ ...kept(), locked: false, last: Date.now() });
      return idle(false);
    },
  };
}
