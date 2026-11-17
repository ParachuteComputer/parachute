import { describe, expect, it } from "vitest";
import { createPageMarks, PAGE_MARK_KEY } from "./pageMark";
import { judge, loadedAgain } from "./violations";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe("the page mark", () => {
  it("is kept while a page's embeds run, early or late, and held over a start that finds it", () => {
    const s = mem();
    const a = createPageMarks(s);
    const done = a.hold("kitchen|home");
    expect(s.m.get(PAGE_MARK_KEY)).toBe("kitchen|home");
    // the app froze: no done(); the next start finds the page suspect, once, until the person runs it again
    const b = createPageMarks(s);
    expect(b.suspect("kitchen|home")).toBe(true);
    expect(s.m.has(PAGE_MARK_KEY)).toBe(false);
    b.clear("kitchen|home");
    expect(b.suspect("kitchen|home")).toBe(false);
    void done;
  });
  it("is cleared when the page is left, and when the app goes out of sight; set again when it comes back", () => {
    const s = mem();
    const a = createPageMarks(s);
    const done = a.hold("p");
    a.hidden(true);
    expect(s.m.has(PAGE_MARK_KEY)).toBe(false);
    a.hidden(false);
    expect(s.m.get(PAGE_MARK_KEY)).toBe("p");
    done();
    expect(s.m.has(PAGE_MARK_KEY)).toBe(false);
    expect(createPageMarks(s).suspect("p")).toBe(false);
  });
});

describe("which frame tried to leave", () => {
  it("is the one that loaded again; when none can be named, every frame stops", async () => {
    const at = performance.now();
    loadedAgain("embed-1");
    expect(await judge("embed-1", at)).toBe(true);
    expect(await judge("host", at)).toBe(false);
    expect(await judge("host", performance.now() + 5000)).toBe(true);
  });
});
