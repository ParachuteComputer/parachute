// The trust path of Parachute's own applets (docs/design/PARACHUTE-SOURCE.md): only the address makes an applet
// Parachute's, and only an index signed by a listed key, newer than the last one taken, with code that matches its hash,
// replaces the app's own copy.
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { BUNDLED, INDEX_D, INDEX_KIND, officialNow, officialOf, inParachuteSpace, readIndex, syncParachuteSource, type Storage } from "./parachuteSource";
import { sha256Hex } from "./needs";
import { discoverApplets, readApplet } from "./discovery";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const release = generateSecretKey();
const KEYS = [getPublicKey(release)];
const stranger = generateSecretKey();
const PUB = "https://example.test/applets/";

const memory = (): Storage & { v: string | null } => { const m = { v: null as string | null, get: () => m.v, set: (x: string) => { m.v = x; } }; return m; };
const newCapture = "export default function Capture() { return null; } // v2";
async function index(n: number, opts: { key?: Uint8Array; body?: string; version?: number; needs?: number; sha?: string; kind?: number } = {}) {
  const body = opts.body ?? newCapture;
  const content = JSON.stringify({ v: 1, n, applets: { capture: { version: opts.version ?? BUNDLED.capture.version + 1, ...(opts.needs ? { needs: opts.needs } : {}), sha256: opts.sha ?? await sha256Hex(body), record: BUNDLED.capture.record } } });
  return finalizeEvent({ kind: opts.kind ?? INDEX_KIND, created_at: 1_800_000_000, tags: [["d", INDEX_D]], content }, opts.key ?? release);
}
/** A publisher serving one index and whatever code it is given, by sha. */
function publisher(ev: unknown, code: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    if (url === `${PUB}index.json`) return new Response(JSON.stringify(ev), { status: 200 });
    const sha = url.slice(PUB.length).replace(/\.\w+$/, "");
    return code[sha] !== undefined ? new Response(code[sha], { status: 200 }) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}
const sync = (ev: unknown, code: Record<string, string>, store: Storage) => syncParachuteSource({ fetch: publisher(ev, code), publisher: PUB, store, keys: KEYS });

describe("which applets are Parachute's", () => {
  it("only an address in Parachute's space, by its name", () => {
    expect(officialOf("parachute:capture")).toBe("capture");
    expect(officialOf("parachute:vault")).toBe("vault");
    expect(officialOf("01HZXCAPTURE000000000000000")).toBeNull();
    expect(officialOf("Applets/Capture")).toBeNull();
    expect(officialOf("capture")).toBeNull();
    expect(officialOf("parachute:nonesuch")).toBeNull();
    expect(inParachuteSpace("parachute:nonesuch")).toBe(true);
  });
  it("a vault's note with Capture's manifest, path and name is an ordinary applet, and one claiming a Parachute id isn't listed", () => {
    const copy = { id: "01HZXCAPTURE000000000000000", path: BUNDLED.capture.record.path, tags: ["applet"], metadata: BUNDLED.capture.record.fields };
    const r = readApplet(copy, "kitchen");
    expect(r.ok && officialOf(r.entry.noteId)).toBe(null);
    expect(discoverApplets([{ ...copy, id: "parachute:capture" }, copy], "kitchen").entries.map((e) => e.noteId)).toEqual([copy.id]);
  });
});

describe("the signed index", () => {
  it("is read only when signed by a listed key, of its kind and name, and unedited", async () => {
    const good = await index(1);
    expect(readIndex(good, KEYS)?.n).toBe(1);
    expect(readIndex(await index(1, { key: stranger }), KEYS)).toBeNull();
    expect(readIndex(await index(1, { kind: 30479 }), KEYS)).toBeNull();
    expect(readIndex({ ...good, content: good.content.replace('"n":1', '"n":9') }, KEYS)).toBeNull();
    expect(readIndex(good, [])).toBeNull();
  });
});

describe("taking an update", () => {
  it("takes a newer signed one whose code matches, and runs it", async () => {
    const store = memory();
    expect(await sync(await index(1), { [await sha256Hex(newCapture)]: newCapture }, store)).toBe("taken");
    const now = await officialNow("capture", { store, keys: KEYS });
    expect(now.from).toBe("update");
    expect(now.body).toBe(newCapture);
    // the others stay the app's own
    expect((await officialNow("vault", { store, keys: KEYS })).from).toBe("app");
  });
  it("refuses a forged index: the app's own copy runs", async () => {
    const store = memory();
    expect(await sync(await index(1, { key: stranger }), { [await sha256Hex(newCapture)]: newCapture }, store)).toBe("refused");
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
  });
  it("refuses an older index put back after a newer one", async () => {
    const store = memory();
    const code = { [await sha256Hex(newCapture)]: newCapture };
    expect(await sync(await index(5), code, store)).toBe("taken");
    expect(await sync(await index(4), code, store)).toBe("refused");
    expect(await sync(await index(5), code, store)).toBe("same");
  });
  it("leaves code that doesn't match its hash, and an update for a newer app", async () => {
    const store = memory();
    const sha = await sha256Hex(newCapture);
    expect(await sync(await index(1, { sha }), { [sha]: "export default () => fetch('https://evil.test')" }, store)).toBe("refused");
    expect(store.v).toBeNull();
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
    const store2 = memory();
    await sync(await index(1, { needs: 99 }), { [sha]: newCapture }, store2);
    expect((await officialNow("capture", { store: store2, keys: KEYS })).from).toBe("app");
  });
  it("checks what it kept again each time it loads: code written into the store doesn't run", async () => {
    const store = memory();
    await sync(await index(1), { [await sha256Hex(newCapture)]: newCapture }, store);
    const kept = JSON.parse(store.v!);
    for (const k of Object.keys(kept.code)) kept.code[k] = "export default () => fetch('https://evil.test')";
    store.set(JSON.stringify(kept));
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
    // and an index swapped for one not signed by a listed key
    kept.index = await index(1, { key: stranger });
    store.set(JSON.stringify(kept));
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
  });
  it("never takes an older or equal version than the app's own", async () => {
    const store = memory();
    await sync(await index(1, { version: BUNDLED.capture.version }), { [await sha256Hex(newCapture)]: newCapture }, store);
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
  });
});

describe("an update that can't be taken whole", () => {
  it("is not kept when its code didn't arrive: the next start asks again and takes it", async () => {
    const store = memory();
    const sha = await sha256Hex(newCapture);
    expect(await sync(await index(3), {}, store)).toBe("offline");
    expect(store.v).toBeNull();
    expect(await sync(await index(3), { [sha]: newCapture }, store)).toBe("taken");
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("update");
  });
  it("an update the app couldn't take when the index came is taken after an app update, from the same index", async () => {
    const store = memory();
    const code = { [await sha256Hex(newCapture)]: newCapture };
    const ev = await index(6, { needs: 4 });
    expect(await syncParachuteSource({ fetch: publisher(ev, code), publisher: PUB, store, keys: KEYS, level: 3 })).toBe("taken");
    expect((await officialNow("capture", { store, keys: KEYS, level: 4 })).from).toBe("app");
    expect(await syncParachuteSource({ fetch: publisher(ev, code), publisher: PUB, store, keys: KEYS, level: 4 })).toBe("taken");
    expect((await officialNow("capture", { store, keys: KEYS, level: 4 })).from).toBe("update");
    expect(await syncParachuteSource({ fetch: publisher(ev, code), publisher: PUB, store, keys: KEYS, level: 4 })).toBe("same");
  });
  it("one that imports from a vault is left: the app's own copy runs", async () => {
    const store = memory();
    const importing = `import Room from "component:room";\nexport default function C() { return null; }\n`;
    await sync(await index(1, { body: importing }), { [await sha256Hex(importing)]: importing }, store);
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
  });
  it("a kept index whose number doesn't match what was kept runs nothing of it", async () => {
    const store = memory();
    await sync(await index(4), { [await sha256Hex(newCapture)]: newCapture }, store);
    const kept = JSON.parse(store.v!);
    kept.n = 9;
    store.set(JSON.stringify(kept));
    expect((await officialNow("capture", { store, keys: KEYS })).from).toBe("app");
  });
});

describe("with no release key listed (until Aaron makes one)", () => {
  it("asks the publisher for nothing, and the app's own copies run", async () => {
    let asked = 0;
    const r = await syncParachuteSource({ fetch: (async () => { asked++; return new Response("{}"); }) as unknown as typeof fetch, publisher: PUB, store: memory(), keys: [] });
    expect(r).toBe("refused");
    expect(asked).toBe(0);
  });
});

describe("scripts/publish-applets.ts", () => {
  it("writes an index this app takes, with each applet's code beside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-applets-"));
    try {
      writeFileSync(join(dir, "key"), Buffer.from(release).toString("hex"));
      execFileSync("node", ["scripts/publish-applets.ts", "--key-file", join(dir, "key"), "--out", join(dir, "out"), "--n", "7"], { stdio: "pipe" });
      const ev = JSON.parse(readFileSync(join(dir, "out", "index.json"), "utf8"));
      const idx = readIndex(ev, KEYS);
      expect(idx?.n).toBe(7);
      for (const name of ["notes", "journal", "capture", "vault", "connect", "home"] as const) {
        const a = idx!.applets[name]!;
        expect(a.version).toBe(BUNDLED[name].version);
        expect(readFileSync(join(dir, "out", `${a.sha256}.${a.record.extension}`), "utf8")).toBe(BUNDLED[name].body);
        expect(a.record.path).toBe(BUNDLED[name].record.path);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
