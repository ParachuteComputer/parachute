// The saved module: what an applet may hand the shell to keep, and what it may not.
import { describe, expect, it } from "vitest";
import { createSavedModule, SAVED_LIMIT } from "./saved";

// an ArrayBuffer of this realm (the test's TextEncoder may hand one of another)
const bytes = (x: unknown) => { const e = new TextEncoder().encode(typeof x === "string" ? x : JSON.stringify(x)); const b = new ArrayBuffer(e.length); new Uint8Array(b).set(e); return b; };
const ctx = {} as never;
const put = createSavedModule({ all: async () => ({}), put: async () => "ok" }).methods.put;

describe("saved.put", () => {
  it("takes a JSON object of plain keys, null removing one", () => {
    expect(put.validate({ bytes: bytes({ draft: "hi", tab: null }) })).toEqual({ ok: true, value: { draft: "hi", tab: null } });
  });
  it("refuses what isn't an object of plain keys, too many keys, or more than its room", () => {
    expect(put.validate({ bytes: bytes([1]) }).ok).toBe(false);
    expect(put.validate({ bytes: bytes("{half") }).ok).toBe(false);
    expect(put.validate({ bytes: bytes({ ["k".repeat(101)]: 1 }) }).ok).toBe(false);
    expect(put.validate({ bytes: bytes({ "a\u0000b": 1 }) }).ok).toBe(false);
    expect(put.validate({ bytes: bytes(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]))) }).ok).toBe(false);
    expect(put.validate({ value: "not bytes" }).ok).toBe(false);
    expect(() => put.validate({ bytes: new ArrayBuffer(SAVED_LIMIT + 1) })).toThrow(/full/);
  });
  it("a write the store refuses or can't make is an error the kit hears", async () => {
    await expect(createSavedModule({ all: async () => ({}), put: async () => "full" }).methods.put.run({ a: 1 }, {}, ctx)).rejects.toThrow(/full/);
    await expect(createSavedModule({ all: async () => ({}), put: async () => { throw new Error("disk"); } }).methods.put.run({ a: 1 }, {}, ctx)).rejects.toThrow(/couldn't be written/);
  });
});
