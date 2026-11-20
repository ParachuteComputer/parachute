// The saved store: what an applet saves comes back after a restart (a new store over the same disk), one applet's never
// reaches another's, a write past the limit changes nothing, and what `storage` kept before is the same store.
import { describe, expect, it } from "vitest";
import { browserBackend, createSavedStore, nativeBackend, SAVED_MAX, SAVED_PREFIX } from "./saved";

const disk = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe("saved state", () => {
  it("comes back in a new session (a restart), per applet; null removes a key; empty leaves nothing on disk", async () => {
    const d = disk();
    const a = createSavedStore(browserBackend(d));
    expect(await a.load("home\0J")).toEqual({});
    expect(await a.put("home\0J", { draft: "half a thought", tab: "days" })).toBe("ok");
    await a.put("home\0M", { draft: "to Ana" });
    const b = createSavedStore(browserBackend(d));
    expect(await b.load("home\0J")).toEqual({ draft: "half a thought", tab: "days" });
    expect(await b.load("home\0M")).toEqual({ draft: "to Ana" });
    await b.put("home\0J", { tab: null });
    expect(b.now("home\0J")).toEqual({ draft: "half a thought" });
    await b.put("home\0J", { draft: null });
    expect(d.m.has(SAVED_PREFIX + encodeURIComponent("home\0J"))).toBe(false);
  });
  it("a write past the limit is refused and changes nothing", async () => {
    const s = createSavedStore(browserBackend(disk()));
    await s.put("x", { a: 1 });
    expect(await s.put("x", { big: "y".repeat(SAVED_MAX) })).toBe("full");
    expect(s.now("x")).toEqual({ a: 1 });
  });
  it("writes land in order: the newest copy is the one on disk", async () => {
    const d = disk();
    let slow = true;
    const back = browserBackend(d);
    const s = createSavedStore({ read: back.read, write: async (sub, all) => { if (slow) { slow = false; await new Promise((r) => setTimeout(r, 30)); } return back.write(sub, all); } });
    void s.put("x", { draft: "a" });
    await s.put("x", { draft: "ab" });
    await s.settled();
    expect(await createSavedStore(browserBackend(d)).load("x")).toEqual({ draft: "ab" });
  });

  // Found in review (T-476)
  it("a store that couldn't be read is never written over: the save is refused until it can be read", async () => {
    const d = disk();
    await createSavedStore(browserBackend(d)).put("x", { draft: "a long entry" });
    const back = browserBackend(d);
    let broken = true;
    const s = createSavedStore({ read: (sub) => (broken ? Promise.reject(new Error("the data folder can't be read")) : back.read(sub)), write: back.write });
    // the applet starts with nothing, as before
    expect(await s.load("x")).toEqual({});
    // the kit's first save (where it was scrolled) fails; it puts it back in line (frameKit.ts)
    await expect(s.put("x", { scroll: 40 })).rejects.toThrow();
    expect(await createSavedStore(browserBackend(d)).load("x")).toEqual({ draft: "a long entry" });
    broken = false;
    expect(await s.put("x", { scroll: 40 })).toBe("ok");
    expect(await createSavedStore(browserBackend(d)).load("x")).toEqual({ draft: "a long entry", scroll: 40 });
  });
  it("two tabs of one browser: what one saved isn't written over by the other's older copy", async () => {
    const d = disk();
    const a = createSavedStore(browserBackend(d)), b = createSavedStore(browserBackend(d));
    await a.load("x"); await b.load("x");
    await a.put("x", { draft: "typed in the first tab" });
    await b.put("x", { scroll: 12 });
    expect(await createSavedStore(browserBackend(d)).load("x")).toEqual({ draft: "typed in the first tab", scroll: 12 });
  });
  it("a key named __proto__ is a key like any other", async () => {
    const d = disk();
    const s = createSavedStore(browserBackend(d));
    expect(await s.put("x", JSON.parse('{"__proto__": {"a": 1}, "b": 2}') as Record<string, unknown>)).toBe("ok");
    expect(Object.keys(s.now("x")).sort()).toEqual(["__proto__", "b"]);
    expect(Object.keys(await createSavedStore(browserBackend(d)).load("x")).sort()).toEqual(["__proto__", "b"]);
  });
  it("two saves asked together both land, with one copy of the app or several over one place", async () => {
    const d = disk();
    const one = createSavedStore({ read: browserBackend(d).read, write: browserBackend(d).write });
    await Promise.all([one.put("x", { a: 1 }), one.put("x", { b: 2 })]);
    expect(await createSavedStore(browserBackend(d)).load("x")).toEqual({ a: 1, b: 2 });
    const shared = createSavedStore(browserBackend(d));
    await Promise.all([shared.put("y", { a: 1 }), shared.put("y", { b: 2 })]);
    expect(await createSavedStore(browserBackend(d)).load("y")).toEqual({ a: 1, b: 2 });
  });
  it("on a device: what an older build kept in the browser's store never comes back after it is cleared, read or not", async () => {
    // the native side: one file per applet (src-tauri/src/saved.rs)
    const files = new Map<string, string>();
    const native = (async (cmd: string, a: Record<string, unknown>) => {
      if (cmd === "saved_get") return files.get(String(a.subject)) ?? "{}";
      if (String(a.json) === "{}") files.delete(String(a.subject)); else files.set(String(a.subject), String(a.json));
    }) as Parameters<typeof nativeBackend>[0];
    const old = disk();
    await browserBackend(old).write("x", { draft: "private, from before the update" });
    // revoked in Settings without having been opened since the update: cleared, never read
    await createSavedStore(nativeBackend(native, browserBackend(old))).clear("x");
    expect(await createSavedStore(nativeBackend(native, browserBackend(old))).load("x")).toEqual({});
    expect([...old.m.values()].join("")).not.toContain("private");
    // and one that was opened is carried into the file once, as before
    await browserBackend(old).write("y", { draft: "carried" });
    expect(await createSavedStore(nativeBackend(native, browserBackend(old))).load("y")).toEqual({ draft: "carried" });
    expect(JSON.parse(files.get("y")!)).toEqual({ draft: "carried" });
    expect(old.m.size).toBe(0);
  });
});
