// The approval rule played with real keys and signatures (from the design's attacks.mjs, reworked for one personal key):
// what a vault writer, a stranger's key or an old approval put back can and can't make run.
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { APPROVAL_KIND, KEYS_KIND, approvalContent, asksHash, checkKeyList, decide, dOf, trustedKeys, type Subject } from "./approvals";

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
