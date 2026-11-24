// @vitest-environment node
// Techne in applets (docs/design/TECHNE.md): what an applet can and can't do as the person on Techne. The module, the
// capability check and the grant store are the real ones; the only stand-in is the AppView at the end of `send` (a
// server outside this app), which records what reached it. The signed side uses real keys and approvals.ts `decide`.
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { createTechneModule, type TechneDeps } from "./modules/techne";
import { createTechneGrants, type Signed } from "./techneGrants";
import { capRecord, capScope, checkCall, isTechneOrigin, parseTechne, techneLines, type Techne, type TechneCap } from "./techne";
import { APPROVAL_KIND, approvalContent, decide, dOf, revokeFloor, type SignedEvent, type Subject } from "./approvals";
import { readApplet } from "./discovery";
import { grantKey, grantLines, grantOf } from "./grant";
import { faceOf, faceTexts } from "./face";
import { parseManifest } from "./manifest";

const T: Techne = { at: "https://techne.example/", can: ["read", "post", "follow"] };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

/** An applet's techne module over the real grant store, a person who answers `answer` on the sheet, and an AppView
 *  that records each request it is sent. */
function applet(o: { techne?: Techne; answer?: "yes" | "no" | "untapped"; signed?: Signed | null; grants?: ReturnType<typeof createTechneGrants>; key?: string } = {}) {
  const grants = o.grants ?? createTechneGrants(mem());
  const sent: string[] = [], asked: string[] = [];
  const t = o.techne ?? T, key = o.key ?? "grant-1", subject = "vault\u0000NOTE";
  const deps: TechneDeps = {
    held: () => grants.held(subject, key, t.can.filter((c) => c !== "read"), o.signed ?? null),
    ask: async (cap) => { asked.push(cap); return o.answer ?? "yes"; },
    grant: (cap) => grants.grant(subject, key, cap, o.signed ?? null),
    send: async (http, nsid) => { sent.push(`${http} ${nsid}`); return { status: 200, body: { ok: nsid } }; },
    me: async () => ({ did: "did:plc:test" }),
  };
  const m = createTechneModule(t, deps);
  const call = (method: string, extra: Record<string, unknown> = {}) => {
    const v = m.methods.call.validate({ method, ...extra });
    if (!v.ok) throw new Error("bad params");
    return m.methods.call.run(v.value, {}, {} as never);
  };
  return { call, sent, asked, grants, subject };
}
const POST = "social.scenius.createCirclePost", FOLLOW = "social.scenius.offerConnection", PROFILE = "social.scenius.getProfile";

describe("no write without the grant", () => {
  it("reads at once: read is the card's", async () => {
    const a = applet({ answer: "no" });
    await expect(a.call(PROFILE, { params: { did: "did:plc:x" } })).resolves.toEqual({ ok: PROFILE });
    expect(a.asked).toEqual([]);
    expect(a.sent).toEqual([`GET ${PROFILE}`]);
  });
  it("a write asks first; Not now sends nothing", async () => {
    const a = applet({ answer: "no" });
    await expect(a.call(POST, { input: { collective: "did:plc:c", post: { text: "hi", createdAt: "2026-11-23T00:00:00Z" } } })).rejects.toMatchObject({ code: "not_granted" });
    expect(a.asked).toEqual(["post"]);
    expect(a.sent).toEqual([]);
  });
  it("without a tap in the applet there is no sheet and nothing is sent", async () => {
    const a = applet({ answer: "untapped" });
    await expect(a.call(POST, { input: {} })).rejects.toThrow(/while you tap/);
    expect(a.sent).toEqual([]);
  });
  it("a write its card doesn't name is refused without asking", async () => {
    const a = applet({ techne: { at: T.at, can: ["read"] } });
    await expect(a.call(POST, { input: {} })).rejects.toMatchObject({ code: "out_of_scope" });
    expect([a.asked, a.sent]).toEqual([[], []]);
  });
  it("a method no capability lists is never sent, whatever the card says: the account, sign-in methods, a collective", async () => {
    const a = applet();
    for (const m of ["social.scenius.deleteAccount", "pub.techne.draft.identity.manageMethods", "pub.techne.draft.identity.writeAsCollective", "pub.techne.draft.registry.publishType", "com.atproto.server.getSession", "../xrpc/x", "toString", "__proto__"])
      await expect(a.call(m, { input: {} })).rejects.toMatchObject({ code: "out_of_scope" });
    expect([a.asked, a.sent]).toEqual([[], []]);
  });
  it("Allow holds it: the post goes, and the next one doesn't ask", async () => {
    const a = applet();
    await a.call(POST, { input: {} });
    await a.call(POST, { input: {} });
    expect(a.asked).toEqual(["post"]);
    expect(a.sent).toEqual([`POST ${POST}`, `POST ${POST}`]);
  });
});

describe("a grant is scoped to one capability", () => {
  it("post held, follow still asks (and Not now leaves it unsent)", async () => {
    const grants = createTechneGrants(mem());
    await applet({ grants }).call(POST, { input: {} });
    const b = applet({ grants, answer: "no" });
    await b.call(POST, { input: {} });
    await expect(b.call(FOLLOW, { input: { subject: "did:plc:y" } })).rejects.toMatchObject({ code: "not_granted" });
    expect(b.asked).toEqual(["follow"]);
    expect(b.sent).toEqual([`POST ${POST}`]);
  });
  it("is bound to the card it was given under: a changed card asks again", async () => {
    const grants = createTechneGrants(mem());
    await applet({ grants }).call(POST, { input: {} });
    const changed = applet({ grants, key: "grant-2", answer: "no" });
    await expect(changed.call(POST, { input: {} })).rejects.toMatchObject({ code: "not_granted" });
    expect(changed.sent).toEqual([]);
  });
  it("checkCall: each method needs its own capability", () => {
    expect(checkCall(T, new Set<TechneCap>(["post"]), FOLLOW)).toEqual({ ok: false, ask: "follow" });
    expect(checkCall(T, new Set<TechneCap>(["follow"]), POST)).toEqual({ ok: false, ask: "post" });
    expect(checkCall(T, new Set<TechneCap>(["post"]), POST)).toMatchObject({ ok: true, cap: "post", http: "POST" });
  });
});

describe("review findings", () => {
  it("a yes signed here that the home vault couldn't take is held here, and Take back ends it", async () => {
    const grants = createTechneGrants(mem());
    const notWritten: Signed = { holds: async () => false, sign: async () => false };
    const a = applet({ grants, signed: notWritten });
    await a.call(POST, { input: {} });
    await a.call(POST, { input: {} });
    expect(a.asked).toEqual(["post"]);
    expect(a.sent).toEqual([`POST ${POST}`, `POST ${POST}`]);
    await grants.takeBack(a.subject, "post", notWritten);
    const after = applet({ grants, signed: notWritten, answer: "no" });
    await expect(after.call(POST, { input: {} })).rejects.toMatchObject({ code: "not_granted" });
  });
  it("a Revoke anywhere forgets what the applet held (Settings lists only allowed applets' lines)", async () => {
    const grants = createTechneGrants(mem());
    await applet({ grants }).call(POST, { input: {} });
    expect(grants.listed("vault\u0000NOTE").map(([c]) => c)).toEqual(["post"]);
    grants.keepOnly(new Set(["vault\u0000OTHER"]));
    expect(grants.listed("vault\u0000NOTE")).toEqual([]);
  });
  it("a read doesn't read what it holds; only a write does", async () => {
    let reads = 0;
    const grants = createTechneGrants(mem());
    const counting: Signed = { holds: async () => { reads++; return false; }, sign: async () => true };
    await applet({ grants, signed: counting, answer: "no" }).call(PROFILE, { params: { did: "did:plc:x" } });
    expect(reads).toBe(0);
  });
  it("Techne's subdomains are Techne too: never a plain service", () => {
    for (const o of ["https://api.techne.computer", "https://alice.pds.techne.town", "https://techne.town."]) expect(isTechneOrigin(o, null), o).toBe(true);
    expect(isTechneOrigin("https://nottechne.computer", null)).toBe(false);
  });
});

describe("revocation", () => {
  it("Take back: the next write asks again, in the same running applet", async () => {
    const a = applet();
    await a.call(POST, { input: {} });
    await a.grants.takeBack(a.subject, "post", null);
    expect(a.grants.listed(a.subject)).toEqual([]);
    const after = applet({ grants: a.grants, answer: "no" });
    await expect(after.call(POST, { input: {} })).rejects.toMatchObject({ code: "not_granted" });
    expect(after.sent).toEqual([]);
  });
});

// ── signed: a capability is its own approval, beside the applet's ──
const me = generateSecretKey(), ME = getPublicKey(me);
const applet0: Subject = { hub: "https://uni.example", vault: "home", record: "01TECHNE", applet: "techne-check" };
const CODE = "tsx:v1", ASKS = "asks1";
const capSubject = (cap: TechneCap): Subject => ({ ...applet0, record: capRecord(applet0.record, cap) });
const T0 = Date.UTC(2026, 10, 23, 9, 0);

/** The signed side as a device with the key has it: approvals in the home vault (here a list), the floor it keeps, and
 *  `decide` for each capability with this code and these asks. */
function signedDevice(events: SignedEvent[] = [], clock = { now: T0 }, under = 1) {
  const floors = new Map<string, number>();
  const signed: Signed = {
    holds: async (cap) => {
      const s = capSubject(cap);
      const d = decide(events, s, CODE, capScope(ASKS, cap, under), new Set([ME]), clock.now, floors.get(dOf(s)) ?? null);
      const newest = d.run ? d.content : d.newest;
      if (newest && (d.run || d.why !== "older")) floors.set(dOf(s), Math.max(floors.get(dOf(s)) ?? 0, newest.n + (newest.approved ? 0 : 0.5)));
      return d.run;
    },
    sign: async (cap, approved) => {
      clock.now += 1000;
      const s = capSubject(cap);
      const c = approvalContent({ subject: s, approved, code: CODE, scope: capScope(ASKS, cap, under), now: clock.now, seen: floors.get(dOf(s)) ?? null });
      events.push(finalizeEvent({ kind: APPROVAL_KIND, created_at: Math.floor(clock.now / 1000), tags: [["d", dOf(s)]], content: JSON.stringify(c) }, me) as SignedEvent);
      floors.set(dOf(s), c.n + (approved ? 0 : 0.5));
      return true;
    },
  };
  return { signed, events, floors, clock };
}

describe("signed: one capability, one approval", () => {
  it("Allow signs an approval of exactly that capability; a second device reads it and doesn't ask", async () => {
    const dev = signedDevice();
    await applet({ signed: dev.signed }).call(POST, { input: {} });
    expect(dev.events).toHaveLength(1);
    expect(JSON.parse(dev.events[0].content)).toMatchObject({ subject: { record: "01TECHNE.techne.post" }, scope: "techne:post:1:asks1", approved: true });
    const other = applet({ signed: signedDevice(dev.events).signed, answer: "no" });
    await other.call(POST, { input: {} });
    expect(other.asked).toEqual([]);
  });
  it("a post approval doesn't count for follow, and an edited one counts for nothing", async () => {
    const dev = signedDevice();
    await dev.signed.sign("post", true);
    expect(await dev.signed.holds("follow")).toBe(false);
    // a vault writer relabels the post approval as follow: the d tag, subject and scope no longer match, or the signature breaks
    const ev = dev.events[0];
    const relabelled = { ...ev, content: ev.content.replaceAll("techne.post", "techne.follow").replace("techne:post:", "techne:follow:"), tags: [["d", dOf(capSubject("follow"))]] };
    expect(await signedDevice([relabelled]).signed.holds("follow")).toBe(false);
    // the applet's own approval (same code and record) is never a capability's
    const own = finalizeEvent({ kind: APPROVAL_KIND, created_at: Math.floor(T0 / 1000), tags: [["d", dOf(applet0)]], content: JSON.stringify(approvalContent({ subject: applet0, approved: true, code: CODE, scope: ASKS, now: T0, seen: null })) }, me) as SignedEvent;
    expect(await signedDevice([own]).signed.holds("post")).toBe(false);
  });
  it("changed code ends it: the next post asks again", async () => {
    const dev = signedDevice();
    await dev.signed.sign("post", true);
    const s = capSubject("post");
    expect(decide(dev.events, s, "tsx:v2", capScope(ASKS, "post", 1), new Set([ME]), dev.clock.now, null)).toMatchObject({ run: false, why: "other" });
  });
  it("Revoke the applet, then Allow the same version again: a write given before doesn't come back", async () => {
    const before = signedDevice([], { now: T0 }, 1);
    await before.signed.sign("post", true);
    // the applet's own approval is signed again on Allow: a new number
    const after = signedDevice([...before.events], { now: T0 + 60_000 }, 2);
    expect(await after.signed.holds("post")).toBe(false);
    expect(await signedDevice([...before.events], { now: T0 + 60_000 }, 1).signed.holds("post")).toBe(true);
  });
  it("Take back signs a taking back: every device stops, and the older approval can't be put back", async () => {
    const dev = signedDevice();
    await dev.signed.sign("post", true);
    const allowed = dev.events[0];
    await createTechneGrants(mem()).takeBack("s", "post", dev.signed);
    expect(await dev.signed.holds("post")).toBe(false);
    // another device that saw the taking back, then finds only the older approval (a vault writer deleted the newer)
    const second = signedDevice([...dev.events]);
    expect(await second.signed.holds("post")).toBe(false);
    second.events.splice(0, second.events.length, allowed);
    expect(await second.signed.holds("post")).toBe(false);
    expect(revokeFloor(T0, null, null)).toBeGreaterThan(Math.floor(T0 / 1000));
  });
});

describe("the declaration and the card", () => {
  const isHub = (o: string) => o === "https://hub.example";
  it("reads {at, can}; refuses a hub, a path, unknown words and repeats", () => {
    expect(parseTechne({ at: "https://Techne.Example", can: ["post", "read"] })).toEqual({ ok: true, techne: { at: "https://techne.example/", can: ["read", "post"] } });
    expect(parseTechne({ at: "http://127.0.0.1:5000/", can: ["read"] })).toMatchObject({ ok: true });
    for (const bad of [{ at: "https://hub.example/", can: ["read"] }, { at: "https://t.example/xrpc/", can: ["read"] }, { at: "http://t.example/", can: ["read"] },
      { at: "https://t.example/", can: ["read", "dm"] }, { at: "https://t.example/", can: ["read", "read"] }, { at: "https://t.example/", can: [] }, { at: "https://t.example/", can: ["read"], extra: 1 }])
      expect(parseTechne(bad, isHub).ok, JSON.stringify(bad)).toBe(false);
  });
  it("Techne is not a service: an applet can't declare the AppView (or Techne's own hosts) as a plain signed server", () => {
    const row = (services: unknown) => ({ id: "01T", path: "Applets/T", tags: ["applet"], metadata: { applet: { contract: 2, id: "t", name: "T" }, techne: { at: "https://techne.example/", can: ["read"] }, services } });
    for (const url of ["https://techne.example/xrpc/", "https://techne.computer/", "https://pds.techne.town/x/"]) {
      const r = readApplet(row([{ id: "s", kind: "http", url, auth: "nip98" }]), "v");
      expect(r.ok && r.entry.services, url).toEqual([]);
      expect(r.ok && r.entry.servicesError, url).toMatch(/Techne/);
    }
    expect(isTechneOrigin("https://other.example", T)).toBe(false);
    const ok = readApplet(row([{ id: "s", kind: "http", url: "https://other.example/", auth: "nip98" }]), "v");
    expect(ok.ok && ok.entry.services.length).toBe(1);
    expect(ok.ok && ok.entry.techne).toEqual({ at: "https://techne.example/", can: ["read"] });
  });
  it("someone else's applet gets no Techne", () => {
    const r = readApplet({ id: "01T", path: "Applets/T", tags: ["applet"], metadata: { applet: { contract: 2, id: "t", name: "T" }, techne: { at: "https://techne.example/", can: ["read"] } } }, "v", true);
    expect(r.ok && r.entry.techne).toBeUndefined();
  });
  it("the card: read stressed, the writes it may ask for on one line; part of the grant's key only when declared", async () => {
    expect(techneLines(T).map((l) => l.text)).toEqual([
      "Read what you see on Techne at techne.example, your private circles included, as you (with your key)",
      "Will ask you once before it can post as you in your circles, or follow people as you (anyone can see who you follow) at techne.example",
    ]);
    const m = parseManifest({ contract: 2, id: "t", name: "T" });
    if (!m.ok) throw new Error(m.error);
    const plainKey = await grantKey(grantOf(m.manifest, "v", []), "Applets/T");
    expect(await grantKey({ ...grantOf(m.manifest, "v", []), techne: undefined }, "Applets/T")).toBe(plainKey);
    const withT = { ...grantOf(m.manifest, "v", []), techne: T };
    expect(await grantKey(withT, "Applets/T")).not.toBe(plainKey);
    expect(await grantKey({ ...withT, techne: { ...T, can: ["read"] } }, "Applets/T")).not.toBe(await grantKey(withT, "Applets/T"));
    expect(grantLines(withT, null).map((l) => l.text)).toEqual(expect.arrayContaining(techneLines(T).map((l) => l.text)));
    // what it reads there could leave through a server it also declares: the card says so
    expect(grantLines(withT, null).some((l) => l.text.startsWith("What it reads on Techne"))).toBe(false);
    const out = grantLines({ ...withT, services: [{ id: "x", kind: "http", url: "https://elsewhere.example/", auth: "none" }] }, null);
    expect(out).toContainEqual({ text: "What it reads on Techne, your private circles too, could reach elsewhere.example", stress: true });
  });
  it("the face says each Techne line once, in its own words (a screenshot showed each twice)", () => {
    const m = parseManifest({ contract: 2, id: "t", name: "T" });
    if (!m.ok) throw new Error(m.error);
    const texts = faceTexts(faceOf({ ...grantOf(m.manifest, "v", []), techne: T }, null));
    expect(texts).toEqual([
      "As you on Techne at techne.example (your key): reads what you see there, your private circles included.",
      "Asks you first, once, before it can post as you in your circles, or follow people as you (anyone can see who you follow) at techne.example.",
    ]);
  });
  it("post creates only: deleting any of your posts isn't in it", async () => {
    const a = applet();
    await expect(a.call("social.scenius.deleteCirclePost", { input: { collective: "did:plc:c", rkey: "x" } })).rejects.toMatchObject({ code: "out_of_scope" });
    expect(a.sent).toEqual([]);
  });
});
