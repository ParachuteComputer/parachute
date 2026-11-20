import { describe, expect, it } from "vitest";
import { parseSignals, signalLines } from "./signals";
import { parseServices, type Service } from "./services";
import { parseManifest, type Manifest } from "./manifest";
import { grantKey, grantOf } from "./grant";
import { asksHash } from "./approvals";

const manifest = (allow: unknown[] = [{ vault: "here", allow: [{ path: "Ideas/", verbs: ["read", "create"] }] }]): Manifest => {
  const m = parseManifest({ contract: 2, id: "ideas", name: "Ideas", glyph: "✦", access: allow });
  if (!m.ok) throw new Error(m.error);
  return m.manifest;
};
const services = (xs: unknown[]): Service[] => { const r = parseServices(xs); if (!r.ok) throw new Error(r.error); return r.services; };
const GW = "https://push.example/";
const rooms = services([{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", notify: { mentions: true, gateway: GW } }]);
const mail = services([{ id: "mail", kind: "http", url: "https://mail.example/mail/", auth: "nip98" }]);
const ideas = { id: "new", name: "new ideas from others", from: { vault: "here", path: "Ideas/", others: true }, via: GW };

describe("an applet's signals", () => {
  it("reads the three kinds: a relay's (through its notify's gateway), an http service's feed, notes in its vault", () => {
    expect(parseSignals([{ id: "for-you", name: "mentions and messages from Uni", from: { service: "rooms" } }], manifest([]), rooms))
      .toEqual({ ok: true, value: [{ id: "for-you", name: "mentions and messages from Uni", from: { kind: "relay", service: "rooms" }, via: GW }] });
    expect(parseSignals([{ id: "unread", name: "unread mail", from: { service: "mail", feed: "unread" }, via: GW }], manifest([]), mail))
      .toEqual({ ok: true, value: [{ id: "unread", name: "unread mail", from: { kind: "feed", service: "mail", feed: "unread" }, via: GW }] });
    expect(parseSignals([ideas], manifest(), [])).toEqual({ ok: true, value: [{ id: "new", name: "new ideas from others", from: { kind: "vault", path: "Ideas/", others: true }, via: GW }] });
    expect(parseSignals(undefined, manifest(), [])).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["a relay with no gateway: nothing counts it", [{ id: "x", name: "x", from: { service: "rooms" } }], services([{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", notify: { mentions: true } }])],
    ["a relay's signal sent elsewhere", [{ id: "x", name: "x", from: { service: "rooms" }, via: "https://other.example/" }], rooms],
    ["a service it doesn't declare", [{ id: "x", name: "x", from: { service: "mail", feed: "unread" } }], rooms],
    ["a folder it may not read", [{ ...ideas, from: { vault: "here", path: "Journal/" } }], []],
    ["a folder climbing out", [{ ...ideas, from: { vault: "here", path: "Ideas/../Journal/" } }], []],
    ["another vault", [{ ...ideas, from: { vault: "work", path: "Ideas/" } }], []],
    ["a note, not a folder", [{ ...ideas, from: { vault: "here", path: "Ideas" } }], []],
    ["a hub as the gateway", [{ ...ideas, via: "https://hub.example/" }], []],
    ["a gateway over plain http", [{ ...ideas, via: "http://push.example/" }], []],
    ["two with one id", [ideas, ideas], []],
    ["a name over two lines", [{ ...ideas, name: "new\nideas" }], []],
    ["a key it doesn't know", [{ ...ideas, sound: true }], []],
    ["five", [1, 2, 3, 4, 5].map((i) => ({ ...ideas, id: `s${i}` })), []],
  ])("refuses %s", (_, raw, svc) => {
    expect(parseSignals(raw, manifest(), svc as Service[], false, (o) => o === "https://hub.example").ok).toBe(false);
  });

  it("in someone else's vault: only its notes, and the count goes nowhere", () => {
    expect(parseSignals([{ ...ideas, via: undefined }], manifest(), [], true).ok).toBe(true);
    expect(parseSignals([ideas], manifest(), [], true).ok).toBe(false);
  });

  it("says on the card what it counts, and stresses where the count goes", () => {
    expect(signalLines([{ id: "new", name: "new ideas from others", from: { kind: "vault", path: "Ideas/", others: true }, via: GW }])).toEqual([
      { text: "Show a count on the bar: new ideas from others (notes in Ideas/ that someone else added)", stress: false },
      { text: "Send the count to push.example, which tells your phone while Parachute is closed. It gets your public key and the number, never what was counted", stress: true },
    ]);
  });

  it("is in the grant's key and the approval's hash only when declared: a key made before holds; another gateway asks again", async () => {
    const m = manifest();
    const sig = (via: string) => { const r = parseSignals([{ ...ideas, via }], m, []); if (!r.ok) throw new Error(r.error); return r.value; };
    const plainKey = await grantKey(grantOf(m, "home", []), "Applets/Ideas");
    expect(await grantKey(grantOf(m, "home", [], [], [], []), "Applets/Ideas")).toBe(plainKey);
    const a = await grantKey(grantOf(m, "home", [], [], [], sig(GW)), "Applets/Ideas");
    expect(a).not.toBe(plainKey);
    expect(await grantKey(grantOf(m, "home", [], [], [], sig("https://elsewhere.example/")), "Applets/Ideas")).not.toBe(a);
    const subject = { hub: "https://hub.example", vault: "home", record: "01I", applet: "ideas" };
    const fields = { applet: { contract: 2, id: "ideas" } };
    const before = await asksHash(subject, "Applets/Ideas", fields);
    expect(await asksHash(subject, "Applets/Ideas", { ...fields, signals: undefined })).toBe(before);
    expect(await asksHash(subject, "Applets/Ideas", { ...fields, signals: [ideas] })).not.toBe(before);
  });
});
