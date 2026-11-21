// What an applet may ask of this device (docs/design/KEYRING.md "Voice, files, links, storage"): the manifest's
// `reach: [voice]` and the `app` words links, save, attach and storage. Each is read strictly, is a line on the card
// and part of the grant's key only when named (so every grant made before keeps its key), and each call is refused
// (not_granted) when the applet didn't ask for it.
import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { parseApp } from "./app";
import { readApplet, resolvedOf } from "./discovery";
import { grantKey, grantLines, grantOf } from "./grant";
import { parseServices } from "./services";
import { RECIPES } from "./fixtures";
import { createRouter } from "./router";
import { parseEnvelope } from "./contract";
import type { CallCtx } from "./router";
import { createAppModule, type AppDeps } from "./modules/app";
import { createVoiceModule } from "./modules/voice";
import { createStorageModule } from "./modules/storage";
import { createVaultModule, type VaultNote } from "./modules/vault";
import { bareName, linkOk, mediaType, parseAccept, STORAGE_MAX } from "./files";

const m = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();
const voiced = (() => { const r = parseManifest({ ...RECIPES, reach: ["voice"] }); if (!r.ok) throw new Error(r.error); return r.manifest; })();
const relay = (() => { const s = parseServices([{ id: "rooms", kind: "nostr-relay", url: "wss://relay.example", publish: [9, 7], media: true }]); if (!s.ok) throw new Error(s.error); return s.services; })();
const CTX: CallCtx = { charge() {}, closed: () => false };
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code; } };

describe("grants made before these words keep their keys", () => {
  // computed with the code as it was before reach and the four app words (2026-11-17)
  it("an applet with opens, one with the three old app words, one with a relay", async () => {
    expect(await grantKey(grantOf(m, "recipes", [{ type: "recipe", path: "Recipes/" }]), "Applets/Recipes")).toBe("87a1a797a74847f2d3ccefd279a6df364bcb1b5b391fa5fb8a606ec15f719681");
    expect(await grantKey(grantOf(m, "v", [], ["recent", "pins", "open"]), "Applets/Recipes")).toBe("71f425201159ace94203035d2b837ed59a3b0fbce0c350790056a75fa2f97c50");
    expect(await grantKey(grantOf(m, "v", [], ["open"], relay), "Applets/Rooms")).toBe("f051a9bf5f5ee270ab307e4f27a76b7bbcebcf4ca136aca1cbb7623ea4cb7631");
  });
});

describe("reach: [voice]", () => {
  it("is the microphone; a room is refused, named on the relay service", () => {
    expect(voiced.reach).toEqual(["voice"]);
    expect(m.reach).toBeUndefined();
    const room = parseManifest({ ...RECIPES, reach: [{ room: "garden" }] });
    expect(room.ok === false && room.error).toMatch(/rooms are named on the relay service/);
  });
  it("is a line on the card, and in the key only when named", async () => {
    expect(grantLines(grantOf(voiced, "v", []), "Applets/").map((l) => l.text)).toContain("Record from your microphone when you press record (the app shows its own recorder)");
    expect(grantLines(grantOf(m, "v", []), "Applets/").map((l) => l.text).join()).not.toMatch(/microphone/);
    expect(await grantKey(grantOf(voiced, "v", []), "Applets/Recipes")).not.toBe(await grantKey(grantOf(m, "v", []), "Applets/Recipes"));
  });
  it("an applet in someone else's vault gets no microphone", () => {
    const theirs = readApplet({ id: "n1", path: "Applets/Recipes", tags: ["applet"], metadata: { applet: { ...RECIPES, reach: ["voice"] } } }, "v", true);
    expect(theirs.ok && theirs.entry.manifest.reach).toBeUndefined();
    const mine = readApplet({ id: "n1", path: "Applets/Recipes", tags: ["applet"], metadata: { applet: { ...RECIPES, reach: ["voice"] } } }, "v");
    expect(mine.ok && mine.entry.manifest.reach).toEqual(["voice"]);
  });
});

describe("the app words links, save, attach, storage", () => {
  it("parse with the old ones, in one order", () => {
    expect(parseApp(["storage", "links", "open", "attach", "save"])).toEqual({ ok: true, app: ["open", "links", "save", "attach", "storage"] });
    expect(parseApp(["links", "links"]).ok).toBe(false);
  });
  it("each is its line on the card, as KEYRING.md words it; links is stressed", () => {
    expect(grantLines(grantOf({ ...m, allow: [] }, "v", [], ["links", "save", "attach", "storage"]), "Applets/")).toEqual([
      { text: "Open web addresses in your browser: what it reads could leave in an address it opens", stress: true },
      { text: "Save files to your device's Downloads", stress: false },
      { text: "Ask you to pick a file or picture to give it", stress: false },
      { text: "Keep up to 256 KB on this device for itself (drafts, what it last showed)", stress: false },
    ]);
  });
  it("each word asks again", async () => {
    const base = await grantKey(grantOf(m, "v", [], ["open"]), "Applets/Recipes");
    for (const w of ["links", "save", "attach", "storage"] as const) expect(await grantKey(grantOf(m, "v", [], ["open", w]), "Applets/Recipes")).not.toBe(base);
  });
});

describe("what the calls accept", () => {
  it("links: http, https and mailto, nothing hidden", () => {
    for (const ok of ["https://example.org/a?b=c", "http://localhost:8080/", "mailto:someone@example.org", "MAILTO:a@b.c"]) expect(linkOk(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "intent://x", "tel:123", "https://", "https://exa mple.org", "https://example.org/\u202e", "ftp://x.org", "/v/kitchen", "data:text/html,hi", 7]) expect(linkOk(bad), String(bad)).toBe(false);
  });
  it("save: a bare name, at most 100 characters, the extension kept", () => {
    expect(bareName("../../etc/passwd")).toBe("passwd");
    expect(bareName("C:\\Users\\x\\notes.txt")).toBe("notes.txt");
    expect(bareName(".bashrc")).toBe("bashrc");
    expect(bareName("...")).toBe("file");
    expect(bareName("a<b>:c?.pdf")).toBe("a_b__c_.pdf");
    expect(bareName("re\u202eport.pdf")).toBe("report.pdf");
    const long = bareName(`${"x".repeat(300)}.webm`);
    expect([...long].length).toBe(100);
    expect(long.endsWith(".webm")).toBe(true);
  });
  it("types and accept lists", () => {
    expect(mediaType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(mediaType("not a type")).toBeNull();
    expect(parseAccept("image/*, .pdf")).toEqual(["image/*", ".pdf"]);
    expect(parseAccept(["audio/webm"])).toEqual(["audio/webm"]);
    expect(parseAccept(["*/*"])).toBeNull();
    expect(parseAccept(Array(11).fill(".a"))).toBeNull();
  });
  it("bytes ride with app.save and vault.attach, within 25 MB", () => {
    expect(parseEnvelope({ uni: 1, id: "a", ns: "app", method: "save", params: { name: "x", bytes: new ArrayBuffer(10), type: "text/plain" } }).kind).toBe("uni");
    expect(parseEnvelope({ uni: 1, id: "b", ns: "vault", method: "attach", params: { noteId: "x", bytes: new ArrayBuffer(10 * 1024), type: "audio/webm" } }).kind).toBe("uni");
    expect(parseEnvelope({ uni: 1, id: "c", ns: "app", method: "save", params: { name: "x", bytes: new ArrayBuffer(26 * 1024 * 1024), type: "text/plain" } })).toMatchObject({ kind: "bad", error: "too_large" });
  });
});

const appDeps = (log: string[] = []): AppDeps => ({
  recent: async () => [], pins: () => [], changes: async () => ({ count: 0, names: [], more: false, href: null }), open: () => true, links: async (l) => l.map(() => null), follow: async () => false, address: () => null,
  openLink: async (url) => { log.push(`link ${url}`); return true; }, copy: async (text) => { log.push(`copy ${text}`); return true; },
  save: async (name, bytes, type) => { log.push(`save ${name} ${bytes.byteLength} ${type}`); return name; },
  pick: async (accept, multiple) => { log.push(`pick ${accept.join(",")} ${multiple}`); return []; },
});

describe("the calls, refused without their word", () => {
  it("app: openLink, save and pick are not_granted unless asked for", async () => {
    const r = createRouter([createAppModule(["open"], appDeps())]);
    expect(await code(r.call("app", "openLink", { url: "https://example.org" }, {}))).toBe("not_granted");
    expect(await code(r.call("app", "save", { name: "a", bytes: new ArrayBuffer(1), type: "text/plain" }, {}))).toBe("not_granted");
    expect(await code(r.call("app", "pick", {}, {}))).toBe("not_granted");
  });
  it("app: copy is not_granted unless asked for (Connect's word); with it, only text, and the shell decides on the tap", async () => {
    expect(await code(createRouter([createAppModule(["open"], appDeps())]).call("app", "copy", { text: "x" }, {}))).toBe("not_granted");
    const log: string[] = [];
    const r = createRouter([createAppModule(["copy"], appDeps(log))]);
    expect(await r.call("app", "copy", { text: "https://hub.example/vault/kitchen/mcp" }, {})).toBe(true);
    expect(await code(r.call("app", "copy", { text: 3 }, {}))).toBe("bad_params");
    expect(await code(r.call("app", "copy", { text: "x".repeat(2001) }, {}))).toBe("bad_params");
    expect(log).toEqual(["copy https://hub.example/vault/kitchen/mcp"]);
  });
  it("app: a link at most once a second; a saved name is made bare", async () => {
    let t = 10_000;
    const log: string[] = [];
    const r = createRouter([createAppModule(["links", "save", "attach"], appDeps(log), () => t)]);
    expect(await r.call("app", "openLink", { url: "https://example.org/1" }, {})).toBe(true);
    t += 500;
    expect(await r.call("app", "openLink", { url: "https://example.org/2" }, {})).toBe(false);
    t += 600;
    expect(await r.call("app", "openLink", { url: "https://example.org/3" }, {})).toBe(true);
    expect(await code(r.call("app", "openLink", { url: "javascript:alert(1)" }, {}))).toBe("bad_params");
    expect(await r.call("app", "save", { name: "../secret/.notes.txt", bytes: new ArrayBuffer(3), type: "text/plain;charset=utf-8" }, {})).toEqual({ saved: "notes.txt" });
    await r.call("app", "pick", { accept: "image/*", multiple: true }, {});
    expect(log).toEqual(["link https://example.org/1", "link https://example.org/3", "save notes.txt 3 text/plain", "pick image/* true"]);
  });
  it("app: links sent together count as one burst; one saved file a second", async () => {
    let t = 50_000;
    const log: string[] = [];
    const r = createRouter([createAppModule(["links", "save"], appDeps(log), () => t)]);
    const went = await Promise.all([1, 2, 3, 4].map((i) => r.call("app", "openLink", { url: `https://example.org/${i}` }, {})));
    expect(went.filter(Boolean)).toHaveLength(1);
    const saves = await Promise.all([1, 2, 3].map((i) => code(r.call("app", "save", { name: `f${i}.txt`, bytes: new ArrayBuffer(1), type: "text/plain" }, {}))));
    expect(saves.filter((c) => c === "ok")).toHaveLength(1);
    expect(saves.filter((c) => c === "rate_limited")).toHaveLength(2);
    t += 1100;
    expect(await code(r.call("app", "save", { name: "f4.txt", bytes: new ArrayBuffer(1), type: "text/plain" }, {}))).toBe("ok");
  });
  it("app: note links (links, follow, address) are open's: not_granted without it, and read strictly", async () => {
    const none = createRouter([createAppModule(["links"], appDeps())]);
    expect(await code(none.call("app", "links", { links: ["kitchen:01KA3Z9V6B2W8XQJ4M7N5P0R1S"] }, {}))).toBe("not_granted");
    expect(await code(none.call("app", "follow", { link: "kitchen:01KA3Z9V6B2W8XQJ4M7N5P0R1S" }, {}))).toBe("not_granted");
    expect(await code(none.call("app", "address", { note: "01KA3Z9V6B2W8XQJ4M7N5P0R1S" }, {}))).toBe("not_granted");
    const r = createRouter([createAppModule(["open"], appDeps())]);
    expect(await r.call("app", "links", { links: ["a", "b"], from: "Recipes/Toast" }, {})).toEqual([null, null]);
    for (const bad of [{ links: "a" }, { links: Array(51).fill("a") }, { links: ["x".repeat(2001)] }, { links: [""] }, { links: [], token: "x" }, { links: [], from: 1 }])
      expect(await code(r.call("app", "links", bad, {})), JSON.stringify(bad).slice(0, 40)).toBe("bad_params");
    for (const bad of [{ link: 1 }, { link: "a", choose: "yes" }, { link: "a", href: "/settings" }]) expect(await code(r.call("app", "follow", bad, {}))).toBe("bad_params");
    for (const bad of [{ note: "../x" }, { note: "" }, { note: "a/b" }]) expect(await code(r.call("app", "address", bad, {}))).toBe("bad_params");
  });
  it("voice: not_granted without reach voice; at most 10 minutes", async () => {
    const asked: number[] = [];
    const deps = { record: async (max: number) => { asked.push(max); return null; } };
    expect(await code(createRouter([createVoiceModule(false, deps)]).call("voice", "record", {}, {}))).toBe("not_granted");
    const r = createRouter([createVoiceModule(true, deps)]);
    expect(await r.call("voice", "record", {}, {})).toBeNull();
    await r.call("voice", "record", { max_s: 30 }, {});
    expect(await code(r.call("voice", "record", { max_s: 601 }, {}))).toBe("bad_params");
    expect(asked).toEqual([600, 30]);
  });
});

describe("storage", () => {
  const store = () => { let all: Record<string, unknown> = {}; return { read: () => ({ ...all }), write: (x: Record<string, unknown>) => { all = x; } }; };
  it("not_granted without storage", async () => {
    expect(await code(createRouter([createStorageModule(false, store())]).call("storage", "get", { key: "a" }, {}))).toBe("not_granted");
  });
  it("keeps JSON by key; null removes; 256 KB in all; keys up to 100 characters", async () => {
    const r = createRouter([createStorageModule(true, store())]);
    expect(await r.call("storage", "get", { key: "draft" }, {})).toBeNull();
    await r.call("storage", "set", { key: "draft", value: { text: "hello", at: 3 } }, {});
    await r.call("storage", "set", { key: "__proto__", value: 1 }, {});
    expect(await r.call("storage", "get", { key: "draft" }, {})).toEqual({ text: "hello", at: 3 });
    expect(await r.call("storage", "keys", {}, {})).toEqual(["__proto__", "draft"]);
    expect(await r.call("storage", "get", { key: "constructor" }, {})).toBeNull();
    await r.call("storage", "set", { key: "draft", value: null }, {});
    expect(await r.call("storage", "keys", {}, {})).toEqual(["__proto__"]);
    expect(await code(r.call("storage", "set", { key: "x".repeat(101), value: 1 }, {}))).toBe("bad_params");
    // filled close to the limit in pieces (one call carries at most 8 KB), then one more is refused
    const piece = "x".repeat(7000);
    let n = 0;
    while ((await code(r.call("storage", "set", { key: `k${n}`, value: piece }, {}))) === "ok") n++;
    expect(n).toBe(Math.floor(STORAGE_MAX / 7010));
    expect(await code(r.call("storage", "set", { key: `k${n}`, value: piece }, {}))).toBe("too_large");
  });
  it("a value sent as JSON text in bytes may be any size within the 256 KB: one call keeps a whole list", async () => {
    const r = createRouter([createStorageModule(true, store())]);
    const list = { rooms: Array.from({ length: 200 }, (_, i) => ({ id: `room-${i}`, last: "The beans are up along the north fence. ".repeat(4) })) };
    // an ArrayBuffer of this realm, as the shell gets one from the frame (postMessage clones it into the shell's)
    const bytes = (x: string) => { const e = new TextEncoder().encode(x), b = new ArrayBuffer(e.length); new Uint8Array(b).set(e); return b; };
    const text = JSON.stringify(list);
    expect(text.length).toBeGreaterThan(8 * 1024);
    // what the frame sends, through the envelope: as bytes it passes; as a plain value it is past a call's 8 KB
    expect(parseEnvelope({ uni: 1, id: "1", ns: "storage", method: "set", params: { key: "list", bytes: bytes(text) } }).kind).toBe("uni");
    expect(parseEnvelope({ uni: 1, id: "2", ns: "storage", method: "set", params: { key: "list", value: list } })).toMatchObject({ kind: "bad", error: "too_large" });
    await r.call("storage", "set", { key: "list", bytes: bytes(text) }, {});
    expect(await r.call("storage", "get", { key: "list" }, {})).toEqual(list);
    // bigger than all of its storage: refused before it is read; not JSON, not UTF-8, or both forms at once: refused
    expect(await code(r.call("storage", "set", { key: "big", bytes: new ArrayBuffer(STORAGE_MAX + 1) }, {}))).toBe("too_large");
    expect(await code(r.call("storage", "set", { key: "bad", bytes: bytes("{not json") }, {}))).toBe("bad_params");
    const notUtf8 = new ArrayBuffer(3); new Uint8Array(notUtf8).set([0x7b, 0xff, 0x7d]);
    expect(await code(r.call("storage", "set", { key: "bad", bytes: notUtf8 }, {}))).toBe("bad_params");
    expect(await code(r.call("storage", "set", { key: "bad", bytes: bytes("1"), value: 1 }, {}))).toBe("bad_params");
    expect(await code(r.call("storage", "set", { key: "bad", bytes: "1" }, {}))).toBe("bad_params");
    // nested deeper than a call's parameters may be: refused, so what is kept can always be handed back
    expect(await code(r.call("storage", "set", { key: "deep", bytes: bytes("[".repeat(40) + "]".repeat(40)) }, {}))).toBe("bad_params");
    expect(await code(r.call("storage", "set", { key: "ok", bytes: bytes(JSON.stringify({ msgs: [{ tags: [["h", "x"]] }] })) }, {}))).toBe("ok");
    // the 256 KB in all still holds: a second list this size doesn't fit beside the first
    const half = JSON.stringify({ x: "y".repeat(STORAGE_MAX / 2) });
    await r.call("storage", "set", { key: "half", bytes: bytes(half) }, {});
    expect(await code(r.call("storage", "set", { key: "half2", bytes: bytes(half) }, {}))).toBe("too_large");
  });
});

describe("vault.attach", () => {
  const notes: VaultNote[] = [
    { id: "j1", path: "Journal/2026/11-17/09-41", content: "_Transcript pending._", tags: ["journal"] },
    { id: "r1", path: "Recipes/Toast", content: "toast", tags: [] },
    { id: "c1", path: "Journal/Widget", extension: "tsx", content: "code", tags: ["applet"] },
  ];
  const made: string[] = [];
  const deps = {
    listPaths: async () => [], search: async () => [],
    getNote: async (ref: string) => { const n = notes.find((x) => x.id === ref || x.path === ref); if (!n) throw new Error("missing"); return n; },
    attach: async (id: string, bytes: ArrayBuffer, type: string, transcribe: boolean) => { made.push(`${id} ${bytes.byteLength} ${type} ${transcribe}`); return { id: "att1", path: "2026/11/voice.webm", mimeType: type }; },
  };
  const journal = (verbs: ("read" | "create" | "update")[]) => resolvedOf({ ...m, allow: [{ path: "Journal/", verbs }] });
  const r = createRouter([createVaultModule(deps)]);
  const call = (p: Record<string, unknown>, grant = journal(["read", "create", "update"])) => r.call("vault", "attach", p, grant, CTX);
  it("onto a note it may change, transcribe asked", async () => {
    expect(await call({ noteId: "j1", bytes: new ArrayBuffer(5), type: "audio/webm", transcribe: true })).toEqual({ id: "att1", path: "2026/11/voice.webm", type: "audio/webm", transcribe: true });
    expect(made).toEqual(["j1 5 audio/webm true"]);
  });
  it("refused without update, outside its folders, on code, and with nothing to attach", async () => {
    expect(await code(call({ noteId: "j1", bytes: new ArrayBuffer(5), type: "audio/webm" }, journal(["read", "create"])))).toBe("not_granted");
    expect(await code(call({ noteId: "r1", bytes: new ArrayBuffer(5), type: "audio/webm" }))).toBe("out_of_scope");
    expect(await code(call({ noteId: "Recipes/Toast", bytes: new ArrayBuffer(5), type: "audio/webm" }))).toBe("out_of_scope");
    expect(await code(call({ noteId: "c1", bytes: new ArrayBuffer(5), type: "audio/webm" }))).toBe("out_of_scope");
    expect(await code(call({ noteId: "nope", bytes: new ArrayBuffer(5), type: "audio/webm" }))).toBe("out_of_scope");
    expect(await code(call({ noteId: "j1", bytes: new ArrayBuffer(0), type: "audio/webm" }))).toBe("bad_params");
    expect(await code(call({ noteId: "j1", bytes: "text", type: "audio/webm" }))).toBe("bad_params");
    expect(made).toHaveLength(1);
  });
});
