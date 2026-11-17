// TEST ONLY. The native side for the end-to-end tests of the web build, which has no key: the same calls, answered in
// JavaScript with a key the test puts on the page (window.__parachuteE2EKey). It signs what it is handed; the policy it
// sits under is the shipping web-side one (broker.ts, applet/services.ts), and the native side's own checks have their
// own tests (src-tauri/tests). It is compiled in only when the build sets VITE_E2E_SIGNER=1 (native.ts `nativeNow`),
// refuses to run in the app on a device, and CI checks the app's bundle has no trace of it (scripts/no-test-signer.sh).
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import type { Native, LogLine, SignedEvent } from "./native";
import type { Service } from "../applet/services";
import { fromB64, toB64 } from "./broker";

export const E2E_SIGNER_MARK = "parachute-e2e-test-signer";

type Sess = { applet: { name: string; subject: string }; services: Map<string, Service> };

export function e2eNative(secretHex: string): Native {
  const sk = Uint8Array.from(secretHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const pubkey = getPublicKey(sk);
  const sessions = new Map<string, Sess>();
  const tokens = new Map<string, string>();
  const logs = new Map<string, LogLine[]>();
  const now = () => Math.floor(Date.now() / 1000);
  const sign = (kind: number, content: string, tags: string[][]): SignedEvent => finalizeEvent({ kind, content, tags, created_at: now() }, sk) as SignedEvent;
  const sess = (id: string) => { const s = sessions.get(id); if (!s) throw new Error("no session"); return s; };
  const svc = (id: string, service: string) => { const s = sess(id).services.get(service); if (!s) throw new Error("no service"); return s; };
  const log = (session: string, service: string, what: string, id?: string) => {
    const s = sess(session); const l = logs.get(s.applet.subject) ?? [];
    l.push({ at: Math.floor(Date.now() / 1000), applet: s.applet.name, service, what, id }); logs.set(s.applet.subject, l.slice(-500));
  };
  const relayOrigin = (s: Service) => { const u = new URL(s.url); u.protocol = u.protocol === "wss:" ? "https:" : "http:"; return u.origin; };
  const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const authHeader = (ev: SignedEvent) => `Nostr ${btoa(JSON.stringify(ev))}`;
  const selfKey = () => nip44.getConversationKey(sk, pubkey);
  const tokenKey = (subject: string, s: Service) => `${subject}\u0000${s.id}\u0000${s.url}`;
  return {
    async open(session, applet, services) { sessions.set(session, { applet, services: new Map(services.map((s) => [s.id, s])) }); return { pubkey }; },
    async close(session) { sessions.delete(session); },
    async relayAuth(session, service, challenge) { const s = svc(session, service); const ev = sign(22242, "", [["relay", s.url], ["challenge", challenge]]); log(session, service, "sign-in", ev.id); return ev; },
    async signEvent(session, service, t) { svc(session, service); const ev = sign(t.kind, t.content, t.tags); log(session, service, `kind ${t.kind}`, ev.id); return ev; },
    async http(session, service, req) {
      const s = svc(session, service);
      const url = s.url + req.path.replace(/^\//, "");
      const body = req.body ? fromB64(req.body) : undefined;
      const headers: Record<string, string> = { ...req.headers };
      if (s.kind === "http" && s.auth === "nip98") {
        const tags = [["u", url], ["method", req.method], ["nonce", crypto.randomUUID()]];
        if (body?.length) tags.push(["payload", await sha256(body)]);
        const ev = sign(27235, "", tags); headers.authorization = authHeader(ev); log(session, service, `${req.method} ${new URL(url).pathname}`, ev.id);
      } else if (s.kind === "http" && s.auth === "token") {
        const sealed = tokens.get(tokenKey(sess(session).applet.subject, s));
        if (sealed) headers.authorization = `Bearer ${nip44.decrypt(sealed, selfKey())}`;
      }
      const res = await fetch(url, { method: req.method, headers, body: body as BodyInit | undefined, redirect: "manual", credentials: "omit" });
      const keep: Record<string, string> = {};
      for (const k of ["content-type", "content-length", "etag", "last-modified", "location"]) { const v = res.headers.get(k); if (v) keep[k] = v; }
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
    async tokenSet(subject, s, token) { if (token === null) tokens.delete(tokenKey(subject, s)); else tokens.set(tokenKey(subject, s), nip44.encrypt(token, selfKey())); },
    async tokenHas(subject, s) { return tokens.has(tokenKey(subject, s)); },
    async log(subject) { return [...(logs.get(subject) ?? [])]; },
  };
}
