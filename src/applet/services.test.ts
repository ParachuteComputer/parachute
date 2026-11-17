import { describe, expect, it } from "vitest";
import { checkFilters, checkPublish, parseServices, requestUrl, serviceLines, type HttpService, type RelayService } from "./services";
import { grantKey, grantLines, grantOf } from "./grant";
import { parseManifest } from "./manifest";
import { readApplet } from "./discovery";
import { parseEnvelope } from "./contract";

const relay = (x: Record<string, unknown> = {}) => ({ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9, 7], media: true, ...x });
const http = (x: Record<string, unknown> = {}) => ({ id: "mail", kind: "http", url: "https://mail.example/mail/", auth: "nip98", ...x });
const parse = (xs: unknown, isHub?: (o: string) => boolean) => parseServices(xs, isHub);
const one = <T>(xs: unknown) => { const r = parse([xs]); if (!r.ok) throw new Error(r.error); return r.services[0] as T; };

describe("the declaration", () => {
  it("reads a relay and an http service, made plain", () => {
    const r = parse([relay({ url: "wss://Relay.Example.:443/" }), http({ url: "https://MAIL.example:443/mail/" })]);
    expect(r).toEqual({ ok: true, services: [
      { id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [7, 9], media: true, private: [] },
      { id: "mail", kind: "http", url: "https://mail.example/mail/", auth: "nip98" },
    ] });
  });
  it("is none when absent, and refuses the whole list for one bad service", () => {
    expect(parse(undefined)).toEqual({ ok: true, services: [] });
    expect(parse([relay(), http({ auth: "basic" })]).ok).toBe(false);
  });
  it.each([
    ["an unknown key", relay({ extra: 1 })],
    ["plain ws to another machine", relay({ url: "ws://relay.example" })],
    ["http to another machine", http({ url: "http://mail.example/mail/" })],
    ["a user in the url", http({ url: "https://me@mail.example/mail/" })],
    ["a query", http({ url: "https://mail.example/mail/?a=1" })],
    ["a dot segment", http({ url: "https://mail.example/a/../mail/" })],
    ["an encoded dot", http({ url: "https://mail.example/%2e%2e/mail/" })],
    ["a prefix without its slash", http({ url: "https://mail.example/mail" })],
    ["a kind it can't name", relay({ publish: [9, 1] })],
    ["the profile", relay({ publish: [0] })],
    ["a gift wrap", relay({ publish: [1059] })],
    ["a sign-in", relay({ publish: [22242] })],
    ["a kind twice", relay({ publish: [9, 9] })],
    ["auth on a relay", relay({ auth: "nip98" })],
    ["publish on http", http({ publish: [9] })],
    ["a private note of another kind", relay({ private: [{ kind: 10000, d: "x:", t: "x" }] })],
    ["a private prefix without its colon", relay({ private: [{ kind: 30078, d: "read-state", t: "read-state" }] })],
    ["overlapping private prefixes", relay({ private: [{ kind: 30078, d: "a:", t: "a" }, { kind: 30078, d: "a:b:", t: "b" }] })],
    ["a hidden character", relay({ url: "wss://relay.example​" })],
  ])("refuses %s", (_why, x) => { expect(parse([x]).ok).toBe(false); });
  it("takes plain http and ws to this device", () => {
    expect(parse([relay({ url: "ws://localhost:3871" }), http({ url: "http://127.0.0.1:8452/mail/" })]).ok).toBe(true);
  });
  it("refuses a Parachute hub, a relay's media origin included", () => {
    const hubs = ["https://hub.example", "https://relay.example"];
    expect(parse([http({ url: "https://hub.example/vault/" })], (o) => hubs.includes(o)).ok).toBe(false);
    expect(parse([relay()], (o) => hubs.includes(o)).ok).toBe(false);
    expect(parse([http()], (o) => hubs.includes(o)).ok).toBe(true);
  });
  it("names an id once", () => { expect(parse([relay(), relay({ url: "wss://b.example" })]).ok).toBe(false); });
  it("gives an applet in someone else's vault no service", () => {
    const row = { id: "n1", path: "Applets/Rooms", tags: ["applet"], metadata: { applet: { contract: 2, id: "rooms", name: "Rooms" }, services: [relay()] } };
    const mine = readApplet(row, "v", false);
    const theirs = readApplet(row, "v", true);
    expect(mine.ok && mine.entry.services.length).toBe(1);
    expect(theirs.ok && theirs.entry.services).toEqual([]);
    expect(theirs.ok && theirs.entry.servicesError).toMatch(/someone else's/);
  });
});

describe("the card and the key", () => {
  const m = (() => { const r = parseManifest({ contract: 2, id: "rooms", name: "Rooms", access: [{ vault: "here", allow: [{ path: "Rooms/", verbs: ["read"] }] }] }); if (!r.ok) throw new Error(r.error); return r.manifest; })();
  it("says each service, as whom, and where what it reads could go", () => {
    const lines = serviceLines([one<RelayService>(relay({ publish: [9, 7, 5, 20002], private: [{ kind: 30078, d: "read-state:", t: "read-state" }] })), one<HttpService>(http())]).map((l) => l.text);
    expect(lines).toEqual([
      "With your everyday key: sign in to relay.example as you",
      "With your everyday key: post as you in your rooms there: messages, reactions and typing",
      "With your everyday key: delete your messages and reactions there",
      "With your everyday key: send and open files there as you",
      "Keep private notes there (read-state:…), sealed to your key: other apps of yours may share them",
      "What it reads here could reach relay.example",
      "With your everyday key: send requests to mail.example signed as you",
      "What it reads here could reach mail.example",
    ]);
  });
  it("shows a look-alike host as written and as punycode, and a loopback one as on this device", () => {
    expect(serviceLines([one<HttpService>(http({ url: "https://аpple.example/x/", auth: "none" }))])[0].text).toBe("Send requests to аpple.example (xn--pple-43d.example)");
    expect(serviceLines([one<HttpService>(http({ url: "http://localhost:8452/mail/" }))])[0].text).toBe("With your everyday key: send requests to localhost:8452 on this device signed as you");
  });
  it("leaves the keys of applets without services as they were, and asks again for a changed address or kind", async () => {
    const plainKey = await grantKey(grantOf(m, "v", []), "Applets/Rooms");
    expect(await grantKey(grantOf(m, "v", [], [], []), "Applets/Rooms")).toBe(plainKey);
    const a = await grantKey(grantOf(m, "v", [], [], [one(relay())]), "Applets/Rooms");
    expect(a).not.toBe(plainKey);
    expect(await grantKey(grantOf(m, "v", [], [], [one(relay({ publish: [7, 9] }))]), "Applets/Rooms")).toBe(a);
    expect(await grantKey(grantOf(m, "v", [], [], [one(relay({ url: "wss://other.example" }))]), "Applets/Rooms")).not.toBe(a);
    expect(await grantKey(grantOf(m, "v", [], [], [one(relay({ publish: [9, 7, 5] }))]), "Applets/Rooms")).not.toBe(a);
    expect(await grantKey(grantOf(m, "v", [], [], [one(relay({ media: false }))]), "Applets/Rooms")).not.toBe(a);
    expect(grantLines(grantOf(m, "v", [], [], [one(relay())]), "Applets/").some((l) => l.text === "With your everyday key: sign in to relay.example as you")).toBe(true);
  });
});

describe("the checks on each call", () => {
  const r = one<RelayService>(relay({ publish: [9, 5] }));
  const id = "a".repeat(64);
  it("takes NIP-01 filters and refuses the rest", () => {
    expect(checkFilters([{ kinds: [9], "#h": ["room"], limit: 50, since: 1 }]).ok).toBe(true);
    expect(checkFilters([]).ok).toBe(false);
    expect(checkFilters([{ limit: 501 }]).ok).toBe(false);
    expect(checkFilters([{ authors: ["npub1x"] }]).ok).toBe(false);
    expect(checkFilters([{ "#hh": ["x"] }]).ok).toBe(false);
    expect(checkFilters([{ evil: 1 }]).ok).toBe(false);
    expect(checkFilters(Array.from({ length: 11 }, () => ({ kinds: [9] }))).ok).toBe(false);
  });
  it("signs only its kinds, with no tag shaped like a sign-in", () => {
    expect(checkPublish(r, { kind: 9, content: "hi", tags: [["h", "room"], ["p", id]] }).ok).toBe(true);
    expect(checkPublish(r, { kind: 7, content: "+", tags: [] }).ok).toBe(false);
    expect(checkPublish(r, { kind: 22242, content: "", tags: [] }).ok).toBe(false);
    for (const t of ["u", "method", "payload", "challenge", "relay", "server", "expiration"]) expect(checkPublish(r, { kind: 9, content: "", tags: [[t, "x"]] }).ok).toBe(false);
    expect(checkPublish(r, { kind: 9, content: "x".repeat(64 * 1024 + 1), tags: [] }).ok).toBe(false);
    expect(checkPublish(r, { kind: 9, content: "", tags: [], pubkey: id }).ok).toBe(false);
  });
  it("deletes only by event id", () => {
    expect(checkPublish(r, { kind: 5, content: "", tags: [["e", id], ["h", "room"]] }).ok).toBe(true);
    expect(checkPublish(r, { kind: 5, content: "", tags: [["a", "30078:x:read-state:1"]] }).ok).toBe(false);
    expect(checkPublish(r, { kind: 5, content: "", tags: [["k", "30078"], ["e", id]] }).ok).toBe(false);
    expect(checkPublish(r, { kind: 5, content: "", tags: [["h", "room"]] }).ok).toBe(false);
  });
  it("keeps a request under the prefix on its origin", () => {
    const h = one<HttpService>(http());
    expect(requestUrl(h, "session")).toEqual({ ok: true, value: "https://mail.example/mail/session" });
    expect(requestUrl(h, "/jmap?x=1")).toEqual({ ok: true, value: "https://mail.example/mail/jmap?x=1" });
    expect(requestUrl(h, "//evil.example/x")).toEqual({ ok: true, value: "https://mail.example/mail//evil.example/x" });
    for (const bad of ["../account/mcp", "a/../../x", "%2e%2e/x", "a%2fb", "a\\b", "a#b", "a b", "./x", "a/%25"]) expect(requestUrl(h, bad).ok, bad).toBe(false);
  });
});

describe("the frame's envelope for services", () => {
  it("takes a request that subscribes to a few dozen rooms at once (its filters nest seven deep)", () => {
    const subs = Array.from({ length: 25 }, (_, i) => ({ sub: `s${i}`, filters: [{ kinds: [9, 5, 7, 40003, 9005], "#h": [crypto.randomUUID()], since: 1794937000 }, { kinds: [20002], "#h": [crypto.randomUUID()], since: 1794937000 }] }));
    expect(parseEnvelope({ uni: 1, id: "k1", ns: "services", method: "subscribe", params: { service: "rooms", subs } }).kind).toBe("uni");
  });
  it("lets bytes past the request's budget, within their own", () => {
    expect(parseEnvelope({ uni: 1, id: "k2", ns: "services", method: "upload", params: { service: "rooms", bytes: new ArrayBuffer(1024 * 1024), type: "image/png" } }).kind).toBe("uni");
    expect(parseEnvelope({ uni: 1, id: "k3", ns: "services", method: "upload", params: { service: "rooms", bytes: new ArrayBuffer(26 * 1024 * 1024), type: "image/png" } })).toMatchObject({ kind: "bad", error: "too_large" });
    // bytes ride only where a call takes them: services, app (save) and vault (attach)
    expect(parseEnvelope({ uni: 1, id: "k4", ns: "theme", method: "x", params: { bytes: new ArrayBuffer(10) } })).toMatchObject({ kind: "bad" });
  });
});

describe("the keyring's additions (docs/design/KEYRING.md)", () => {
  const uni = "b".repeat(64), other = "c".repeat(64);
  const garden = { id: "3f2a1b2c-0000-4000-8000-000000000001", name: "Garden" };
  const scoped = () => one<RelayService>(relay({ publish: [9, 7, 40003, 5], rooms: [garden], approvals: { from: [uni] }, notify: { mentions: true, from: [uni] } }));
  it("reads rooms, approvals, notify and approve, and refuses them malformed", () => {
    const s = scoped();
    expect(s.rooms).toEqual([garden]);
    expect(s.approvals).toEqual({ from: [uni] });
    expect(s.notify).toEqual({ mentions: true, from: [uni] });
    expect(one<HttpService>(http({ approve: { field: "op", ops: ["send.approve"] } })).approve).toEqual({ field: "op", ops: ["send.approve"] });
    for (const bad of [
      relay({ rooms: [] }), relay({ rooms: [{ id: "a b", name: "x" }] }), relay({ rooms: [garden, garden] }), relay({ rooms: [{ id: "x", name: "a«b" }] }),
      relay({ approvals: { from: [] } }), relay({ approvals: { from: ["npub1x"] } }), relay({ approvals: { from: [uni], extra: 1 } }), relay({ approvals: { from: [uni, uni] } }),
      relay({ notify: {} }), relay({ notify: { mentions: "yes" } }), relay({ notify: { from: Array(5).fill(0).map((_, i) => String(i).repeat(64)) } }),
      http({ approve: { path: "op", ops: ["send.approve"] } }), http({ auth: "none", approve: { field: "op", ops: ["x"] } }), http({ approve: { field: "op", ops: [] } }),
    ]) expect(parse([bad]).ok, JSON.stringify(bad)).toBe(false);
  });
  it("names each key on the card, the approvals line apart and in words, approvers by the device's list", () => {
    const lines = serviceLines([scoped()], { approvalSame: true, approverName: (h) => (h === uni ? "Uni" : null) }).map((l) => l.text);
    expect(lines).toContain("With your everyday key: post as you only in «Garden» (3f2a1b2c…), named by the applet there: messages, reactions and edits of your messages");
    expect(lines).toContain("High risk. With your approval key: answer approval cards and secret requests there from Uni (your approval key is your everyday key for now). Powerful ones ask for your device unlock");
    expect(lines).toContain("Tell you about messages only in «Garden» (3f2a1b2c…), named by the applet there that name you, and every message from Uni, even when Parachute is closed");
    const unknown = serviceLines([one<RelayService>(relay({ approvals: { from: [other] } }))]).map((l) => l.text).join("\n");
    expect(unknown).toMatch(/from a key you haven't trusted on this device \(npub1/);
    expect(serviceLines([one<HttpService>(http({ approve: { field: "op", ops: ["send.approve"] } }))]).map((l) => l.text)).toContain("High risk. With your approval key: send send.approve requests to mail.example");
  });
  it("keeps the keys of grants made before, and asks again for any change to rooms, approvers, notify or approve", async () => {
    const m = (() => { const r = parseManifest({ contract: 2, id: "rooms", name: "Rooms", access: [{ vault: "here", allow: [{ path: "Rooms/", verbs: ["read"] }] }] }); if (!r.ok) throw new Error(r.error); return r.manifest; })();
    const k = (x: Record<string, unknown>) => grantKey(grantOf(m, "v", [], [], [one(relay(x))]), "Applets/Rooms");
    const base = await k({});
    const variants = [{ rooms: [garden] }, { rooms: [{ ...garden, name: "Finance" }] }, { approvals: { from: [uni] } }, { approvals: { from: [other] } }, { notify: { mentions: true } }, { notify: { mentions: true, from: [uni] } }];
    const keys = await Promise.all(variants.map(k));
    expect(new Set([base, ...keys]).size).toBe(variants.length + 1);
    const hk = (x: Record<string, unknown>) => grantKey(grantOf(m, "v", [], [], [one(http(x))]), "Applets/Rooms");
    expect(await hk({})).not.toBe(await hk({ approve: { field: "op", ops: ["send.approve"] } }));
  });
  it("keeps a scoped applet's filters and posts inside its rooms", () => {
    const s = scoped();
    const id = "a".repeat(64);
    expect(checkFilters([{ kinds: [9], "#h": [garden.id] }], s.rooms).ok).toBe(true);
    expect(checkFilters([{ kinds: [39000], "#d": [garden.id] }], s.rooms).ok).toBe(true);
    expect(checkFilters([{ kinds: [0], authors: [id] }], s.rooms).ok).toBe(true);
    for (const f of [{ kinds: [9] }, { kinds: [9], "#h": ["other"] }, { kinds: [9], "#h": [garden.id, "other"] }, { kinds: [9], "#h": [garden.id], search: "x" }, { ids: [id] }, { authors: [id] },
      { kinds: [9, 0], authors: [id] }, { kinds: [39002], "#p": [id] }, { kinds: [9], "#d": [garden.id] }, { kinds: [39000], "#d": ["other"] }])
      expect(checkFilters([f], s.rooms).ok, JSON.stringify(f)).toBe(false);
    expect(checkPublish(s, { kind: 9, content: "hi", tags: [["h", garden.id]] }).ok).toBe(true);
    expect(checkPublish(s, { kind: 9, content: "hi", tags: [["h", "other"]] }).ok).toBe(false);
    expect(checkPublish(s, { kind: 9, content: "hi", tags: [] }).ok).toBe(false);
    expect(checkPublish(s, { kind: 9, content: "hi", tags: [["h", garden.id], ["h", "other"]] }).ok).toBe(false);
    expect(checkPublish(s, { kind: 7, content: "+", tags: [["e", id], ["h", garden.id]] }).ok).toBe(true);
  });
});
