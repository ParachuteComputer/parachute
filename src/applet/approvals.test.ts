// @vitest-environment node
// The approval rule played with real keys and signatures (from the design's attacks.mjs, reworked for one personal key):
// what a vault writer, a stranger's key or an old approval put back can and can't make run.
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { APPROVAL_KIND, KEYS_KIND, approvalContent, asksHash, asksOf, checkKeyList, decide, dOf, pickIn, pickOfDecision, pickRead, revokeFloor, trustedKeys, type Subject } from "./approvals";
import { sortPick } from "./vaultPick";
import { appletRecord } from "../../applets/record";
import { readApplet } from "./discovery";

const me = generateSecretKey(), stranger = generateSecretKey(), root = generateSecretKey(), next = generateSecretKey();
const ME = getPublicKey(me), STRANGER = getPublicKey(stranger), ROOT = getPublicKey(root), NEXT = getPublicKey(next);
const subject: Subject = { hub: "https://uni.example", vault: "home", record: "01ROOMS", applet: "rooms" };
const T0 = Date.UTC(2026, 10, 18, 9, 30);
const sign = (sk: Uint8Array, c: object, kind = APPROVAL_KIND, d = dOf(subject), at = Math.floor(T0 / 1000)) => finalizeEvent({ kind, created_at: at, tags: [["d", d]], content: JSON.stringify(c) }, sk);
const approve = (sk: Uint8Array, o: { code?: string; scope?: string; approved?: boolean; now?: number; seen?: number | null; subject?: Subject } = {}) =>
  sign(sk, approvalContent({ subject: o.subject ?? subject, approved: o.approved ?? true, code: o.code ?? "tsx:v1", scope: o.scope ?? "asks1", now: o.now ?? T0, seen: o.seen ?? null }), APPROVAL_KIND, dOf(o.subject ?? subject));
const mine = new Set([ME]);
const LATER = T0 + 3600_000;

describe("a signed approval", () => {
  it("runs exactly the code and asks it names, signed by your key", () => {
    expect(decide([approve(me)], subject, "tsx:v1", "asks1", mine, LATER, null).run).toBe(true);
  });
  it("unapproved code doesn't run: new code, wider asks, or nothing signed at all", () => {
    expect(decide([approve(me)], subject, "tsx:v2", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "other" });
    expect(decide([approve(me)], subject, "tsx:v1", "asks2", mine, LATER, null)).toMatchObject({ run: false, why: "other" });
    expect(decide([], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "none" });
  });
  it("a vault writer can't edit the hash into an approval: the signature breaks", () => {
    const ev = approve(me);
    const forged = { ...ev, content: ev.content.replace("tsx:v1", "tsx:v2") };
    expect(decide([forged], subject, "tsx:v2", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "none", refused: ["its signature doesn't hold"] });
  });
  it("an approval from a key that isn't yours, or isn't on your key list, is refused", () => {
    expect(decide([approve(stranger, { code: "tsx:v2" })], subject, "tsx:v2", "asks1", mine, LATER, null)).toMatchObject({ run: false, refused: ["it isn't signed by a key of yours"] });
    // with a root anchor: only the keys its newest list names count
    const list = checkKeyList(sign(root, { v: 1, seq: 2, at: "2026-11-18T00:00:00Z", keys: [{ key: NEXT, name: "phone" }] }, KEYS_KIND, "keys"), ROOT, null);
    const t = trustedKeys({ own: ME, anchor: ROOT, list });
    expect(decide([approve(me)], subject, "tsx:v1", "asks1", t, LATER, null).run).toBe(false);
    expect(decide([approve(next)], subject, "tsx:v1", "asks1", t, LATER, null).run).toBe(true);
    // a list the root didn't sign, or an older one put back, doesn't count
    expect(checkKeyList(sign(stranger, { v: 1, seq: 3, at: "x", keys: [{ key: STRANGER }] }, KEYS_KIND, "keys"), ROOT, null)).toBeNull();
    expect(checkKeyList(sign(root, { v: 1, seq: 1, at: "x", keys: [{ key: ME }] }, KEYS_KIND, "keys"), ROOT, 2)).toBeNull();
    // without an anchor, the key this device holds
    expect([...trustedKeys({ own: ME, anchor: null, list: null })]).toEqual([ME]);
  });
  it("one applet's approval can't be moved onto another", () => {
    const other: Subject = { ...subject, record: "01MAIL", applet: "mail" };
    expect(decide([approve(me, { subject: other })], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, refused: ["it is for another applet"] });
  });
  it("changed code waits for a new approval; the newer approval is the one that counts, and October's put back doesn't", () => {
    const oct = approve(me, { code: "tsx:v1" }), nov = approve(me, { code: "tsx:v2", now: T0 + 1000, seen: null });
    expect(decide([oct, nov], subject, "tsx:v2", "asks1", mine, LATER, null).run).toBe(true);
    expect(decide([oct, nov], subject, "tsx:v1", "asks1", mine, LATER, null).run).toBe(false);
    // the vault hides November's: a device that saw it refuses October's
    const novN = JSON.parse(nov.content).n;
    expect(decide([oct], subject, "tsx:v1", "asks1", mine, LATER, novN)).toMatchObject({ run: false, why: "older" });
  });
  it("taken back is taken back on every device; put back, refused where the take-back was seen", () => {
    const yes = approve(me), no = approve(me, { approved: false, now: T0 + 1000 });
    expect(decide([yes, no], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "withdrawn" });
    expect(decide([yes], subject, "tsx:v1", "asks1", mine, LATER, JSON.parse(no.content).n)).toMatchObject({ run: false, why: "older" });
  });
  it("one dated in the future (to block every later one) or past its year is refused", () => {
    expect(decide([approve(me, { now: LATER + 86_400_000 })], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, refused: ["it is dated in the future"] });
    expect(decide([approve(me)], subject, "tsx:v1", "asks1", mine, T0 + 366 * 86_400_000, null)).toMatchObject({ run: false, refused: ["its year has run out"] });
  });
  it("two in one second: the taking back wins; and one put back with a taking back's number is refused where it was seen", () => {
    const yes = approve(me, { now: T0 }), no = approve(me, { approved: false, now: T0 });
    expect(decide([yes, no], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "withdrawn" });
    expect(decide([no, yes], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, why: "withdrawn" });
    // the device that saw the taking back keeps it half a step higher (approvalStore.ts)
    expect(decide([yes], subject, "tsx:v1", "asks1", mine, LATER, JSON.parse(no.content).n + 0.5)).toMatchObject({ run: false, why: "older" });
  });
  it("the asks' hash covers what the fields resolve to elsewhere: embeds from another Parachute, opens once role tags are out", async () => {
    const f = { applet: { id: "rooms" } };
    const plain = await asksHash(subject, "Applets/Rooms", f, { opens: [], from: [] });
    expect(await asksHash(subject, "Applets/Rooms", f, { opens: [], from: ["techne at techne.example"] })).not.toBe(plain);
    expect(await asksHash(subject, "Applets/Rooms", f, { opens: [{ type: "task", path: "Tasks/", screen: null }], from: [] })).not.toBe(plain);
  });
  it("a device signing next signs higher than any it has seen, even with a clock behind", () => {
    expect(approvalContent({ subject, approved: true, code: "c", scope: "s", now: T0, seen: Math.floor(T0 / 1000) + 50 }).n).toBe(Math.floor(T0 / 1000) + 51);
  });
  it("the asks' hash is the same on every device: the fields as written, never a device's name for the vault", async () => {
    const a = await asksHash(subject, "Applets/Rooms.tsx", { applet: { id: "rooms", allow: [{ path: "Rooms/", verbs: ["read"] }] }, app: ["open"], other: 1 });
    const b = await asksHash(subject, "Applets/Rooms", { app: ["open"], applet: { allow: [{ verbs: ["read"], path: "Rooms/" }], id: "rooms" } });
    expect(a).toBe(b);
    expect(await asksHash(subject, "Applets/Rooms", { applet: { id: "rooms", allow: [{ path: "Rooms/", verbs: ["read", "update"] }] }, app: ["open"] })).not.toBe(a);
  });
});

// Found in review (T-476): a Revoke whose taking back isn't signed (the unlock cancelled, a device without the key)
// must still keep this device from allowing the applet again from the approval left standing.
describe("the floor a Revoke leaves", () => {
  const nowS = Math.floor(LATER / 1000);
  it("refuses the approval the screen read, and one it hadn't read yet", () => {
    const ev = approve(me);
    const n = JSON.parse(ev.content).n as number;
    expect(decide([ev], subject, "tsx:v1", "asks1", mine, LATER, revokeFloor(LATER, n, n)).run).toBe(false);
    expect(decide([ev], subject, "tsx:v1", "asks1", mine, LATER, revokeFloor(LATER, null, null)).run).toBe(false);
  });
  it("refuses an approval numbered ahead of this device's clock that it had already seen (Settings has no screen's reading)", () => {
    // signed on a device whose clock runs two minutes ahead: within what checkApproval takes
    const ahead = approve(me, { now: LATER + 120_000 });
    const n = JSON.parse(ahead.content).n as number;
    expect(n).toBeGreaterThan(nowS);
    expect(decide([ahead], subject, "tsx:v1", "asks1", mine, LATER, n).run).toBe(true);
    expect(decide([ahead], subject, "tsx:v1", "asks1", mine, LATER, revokeFloor(LATER, null, n)).run).toBe(false);
  });
  it("lets the next Allow through: it is signed past the floor", () => {
    const floor = revokeFloor(LATER, null, null);
    const again = approve(me, { now: LATER + 1000, seen: floor });
    expect(decide([again], subject, "tsx:v1", "asks1", mine, LATER + 2000, floor).run).toBe(true);
  });
});

// Found in review (T-476): the hash was of the note's fields alone, but a device leaves some of them out: an applet in
// a vault that is someone else's there gets no server, no microphone and nothing of the app; a server at one of the
// device's own hubs is refused. A phone that left the servers out signed an approval that a laptop, where the vault is
// the person's own, took as covering them, with no card. Each device now hashes what it left out too.
describe("an approval covers what the approving device's card showed, not what another device reads into the note", () => {
  const vars = { relay: "wss://buzz.example.org", mail: "https://mail.example.org/mail/", uni: "a".repeat(64), push: "https://push.example.org/" };
  const r = appletRecord("rooms", vars);
  const note = { id: "01ROOMS", path: r.path, tags: r.tags, metadata: r.fields as Record<string, unknown> };
  const read = (theirs: boolean, isHub: (o: string) => boolean = () => false) => { const a = readApplet(note, "team", theirs, isHub); if (!a.ok) throw new Error(a.error); return a.entry; };
  const asks = (e: ReturnType<typeof read>) => asksOf({ ...subject, vault: "team" }, e, note.metadata, []);

  it("someone else's vault on the phone, the person's own on the laptop: the phone's approval isn't the laptop's", async () => {
    const phone = read(true), laptop = read(false);
    expect(phone.services).toEqual([]);
    expect(laptop.services.length).toBeGreaterThan(0);
    expect(await asks(laptop)).not.toBe(await asks(phone));
  });
  it("a server at a hub the phone knows (refused there) and the laptop doesn't", async () => {
    const phone = read(false, (o) => o === "https://buzz.example.org"), laptop = read(false);
    expect(phone.services).toEqual([]);
    expect(laptop.services.length).toBeGreaterThan(0);
    expect(await asks(laptop)).not.toBe(await asks(phone));
  });
  it("an approval made before this (nothing left out) still holds: the hash is the one the code of 11-19 gave", async () => {
    const fields = { applet: { id: "rooms", allow: [{ path: "Rooms/", verbs: ["read"] }] }, app: ["open"] };
    const was = "79b0accc3886562399dff8992f23c17ccee915d1f334f194fd308aeada92ab37";
    expect(await asksHash(subject, "Applets/Rooms", fields, { opens: [], from: [] })).toBe(was);
    expect(await asksHash(subject, "Applets/Rooms", fields, { opens: [], from: [], left: [] })).toBe(was);
    expect(await asksHash(subject, "Applets/Rooms", fields, { opens: [], from: [], left: ["services"] })).not.toBe(was);
  });
  it("two devices that read it the same get the same hash, and nothing left out leaves an approval made before as it was", async () => {
    expect(await asks(read(false))).toBe(await asks(read(false)));
    expect(await asks(read(true))).toBe(await asks(read(true)));
    const e = read(false);
    expect(e.left).toBeUndefined();
    expect(await asks(e)).toBe(await asksHash({ ...subject, vault: "team" }, e.path, note.metadata, { opens: e.opens.map((o) => ({ type: o.type, path: o.path, screen: o.screen ?? null })), from: [] }));
  });
});

// docs/ACCESS.md proposal 5: an applet that reaches across vaults holds only the vaults the person picked, and the pick
// lives in the signed approval. These are the rules a device checks before it gives an applet any vault.
describe("the vaults an approval holds (proposal 5)", () => {
  const A = { hub: "https://uni.example", vault: "home" }, B = { hub: "https://uni.example", vault: "letters" }, C = { hub: "https://uni.example", vault: "pantry" };
  const picked = (sk: Uint8Array, vaults: { hub: string; vault: string }[] | null, o: { now?: number; approved?: boolean; scope?: string } = {}) =>
    sign(sk, approvalContent({ subject, approved: o.approved ?? true, code: "tsx:v1", scope: o.scope ?? "asks1", now: o.now ?? T0, seen: null, vaults }), APPROVAL_KIND, dOf(subject), Math.floor((o.now ?? T0) / 1000));
  it("the asks' hash with no pick is today's; with one it differs, whatever order it was ticked in", async () => {
    const fields = { applet: { contract: 2, id: "rooms" }, app: ["vaults"] };
    const today = await asksHash(subject, "Applets/Rooms", fields);
    expect(await asksHash(subject, "Applets/Rooms", fields, {}, null)).toBe(today);
    const ab = await asksHash(subject, "Applets/Rooms", fields, {}, [A, B]);
    expect(ab).not.toBe(today);
    expect(await asksHash(subject, "Applets/Rooms", fields, {}, [B, A])).toBe(ab);
    expect(await asksHash(subject, "Applets/Rooms", fields, {}, [A, B, C])).not.toBe(ab);
  });
  it("the pick is read from the newest approval that counts, and from nothing else", () => {
    expect(pickIn([picked(me, [A, B])], subject, mine, LATER, null)).toEqual([A, B]);
    // an approval made with no pick (before picks, or by an older build): none, which is the home
    expect(pickIn([picked(me, [A, B]), picked(me, null, { now: T0 + 60_000 })], subject, mine, LATER, null)).toBeNull();
    // a taking back holds no pick
    expect(pickIn([picked(me, [A, B]), picked(me, null, { now: T0 + 60_000, approved: false })], subject, mine, LATER, null)).toBeNull();
    // an older one put back, under what this device has seen: refused, so none
    expect(pickIn([picked(me, [A, B, C])], subject, mine, LATER, Math.floor(T0 / 1000) + 60)).toBeNull();
  });
  it("widening needs a new approval signed with your key: an edited pick breaks the signature", () => {
    const ev = picked(me, [A]);
    const wider = { ...ev, content: ev.content.replace(JSON.stringify([A]), JSON.stringify([A, B])) };
    expect(wider.content).not.toBe(ev.content);
    expect(pickIn([wider], subject, mine, LATER, null)).toBeNull();
    expect(decide([wider], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, refused: ["its signature doesn't hold"] });
  });
  it("an AI with a write key can't widen it: an approval it signs with its own key, newer or not, counts for nothing", () => {
    const ai = generateSecretKey();
    const mineNarrow = picked(me, [A]);
    const its = picked(ai, [A, B, C], { now: T0 + 60_000 });
    expect(pickIn([mineNarrow, its], subject, mine, LATER, null)).toEqual([A]);
    // nor can it write a pick no one can read as "some of it": the whole approval is refused
    const garbled = picked(me, [A]);
    const bad = finalizeEvent({ kind: APPROVAL_KIND, created_at: garbled.created_at, tags: garbled.tags, content: JSON.stringify({ ...JSON.parse(garbled.content), vaults: [A, { hub: "not a hub", vault: "x" }] }) }, ai);
    expect(pickIn([bad], subject, new Set([getPublicKey(ai)]), LATER, null)).toBeNull();
  });
  it("an approval holding a pick that can't be read is refused whole, even signed by you", () => {
    for (const vaults of [[{ hub: "https://uni.example/", vault: "home" }], [A, A], [{ ...A, extra: 1 }], "home", [{ hub: "javascript:alert(1)", vault: "x" }]]) {
      const ev = sign(me, { ...approvalContent({ subject, approved: true, code: "tsx:v1", scope: "asks1", now: T0, seen: null }), vaults });
      expect(decide([ev], subject, "tsx:v1", "asks1", mine, LATER, null)).toMatchObject({ run: false, refused: ["it can't be read"] });
    }
  });
  it("an older build hashes without the pick, so a picked approval is other asks there (it asks again, never runs wider)", async () => {
    const fields = { applet: { contract: 2, id: "rooms" }, app: ["vaults"] };
    const withPick = await asksHash(subject, "Applets/Rooms", fields, {}, [A, B]);
    const without = await asksHash(subject, "Applets/Rooms", fields);
    const ev = picked(me, [A, B], { scope: withPick });
    expect(decide([ev], subject, "tsx:v1", without, mine, LATER, null)).toMatchObject({ run: false, why: "other" });
    expect(decide([ev], subject, "tsx:v1", withPick, mine, LATER, null)).toMatchObject({ run: true, content: { vaults: [A, B] } });
  });
});

describe("what a device that checks approvals lets an applet reach (proposal 5, review finding 1)", () => {
  const A = { hub: "https://uni.example", vault: "letters" };
  const content = (o: { n?: number; approved?: boolean; vaults?: { hub: string; vault: string }[] | null } = {}) =>
    ({ ...approvalContent({ subject, approved: o.approved ?? true, code: "tsx:v1", scope: "asks1", now: (o.n ?? 1000) * 1000, seen: null, vaults: o.vaults ?? null }), n: o.n ?? 1000 });
  it("the newest approval's pick, or the default when it was made with none", () => {
    expect(pickRead(content({ vaults: [A] }), 1000)).toEqual({ pick: [A] });
    expect(pickRead(content(), 1000)).toEqual({ pick: null });
  });
  it("the default only where this device never saw an approval for it", () => {
    expect(pickRead(null, null)).toEqual({ pick: null });
  });
  it("an approval deleted, put back or taken back after one was seen here reaches nothing, never the default (which holds the home)", () => {
    // deleted: none counts now, though this device saw one (its floor)
    expect(pickRead(null, 1000)).toEqual({ unconfirmed: true });
    // an older one put back under what this device saw
    expect(pickRead(content({ n: 900, vaults: [A] }), 1000)).toEqual({ unconfirmed: true });
    // a taking back
    expect(pickRead(content({ approved: false }), 1000)).toEqual({ unconfirmed: true });
  });
  it("the same for an applet with a card, from what decide said", () => {
    const ev = finalizeEvent({ kind: APPROVAL_KIND, created_at: Math.floor(T0 / 1000), tags: [["d", dOf(subject)]], content: JSON.stringify(approvalContent({ subject, approved: true, code: "tsx:v1", scope: "asks1", now: T0, seen: null, vaults: [A] })) }, me);
    expect(pickOfDecision(decide([ev], subject, "tsx:v1", "asks1", mine, LATER, null), null)).toEqual({ pick: [A] });
    expect(pickOfDecision(decide([], subject, "tsx:v1", "asks1", mine, LATER, null), null)).toEqual({ pick: null });
    expect(pickOfDecision(decide([], subject, "tsx:v1", "asks1", mine, LATER, Math.floor(T0 / 1000)), Math.floor(T0 / 1000))).toEqual({ unconfirmed: true });
    expect(pickOfDecision(decide([ev], subject, "tsx:v1", "asks1", mine, LATER, Math.floor(T0 / 1000) + 60), Math.floor(T0 / 1000) + 60)).toEqual({ unconfirmed: true });
  });
  it("the asks' hash is the same whatever the device's language: the pick is sorted by code unit (review finding 2)", async () => {
    const z = { hub: "https://uni.example", vault: "zebra" }, o = { hub: "https://uni.example", vault: "öl" };
    const fields = { applet: { contract: 2, id: "rooms" }, app: ["vaults"] };
    expect(sortPick([o, z])).toEqual([z, o]);
    expect(await asksHash(subject, "Applets/Rooms", fields, {}, [o, z])).toBe(await asksHash(subject, "Applets/Rooms", fields, {}, [z, o]));
  });
});
