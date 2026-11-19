import { describe, expect, it } from "vitest";
import { keptId, KEEP, KEEP_DESKTOP, stays } from "./kept";

const entry = (id: string, at: number, keepable = true) => ({ id, at, keepable, location: { pathname: `/v/x/a/${id}`, search: "", hash: "", state: null, key: id } });

describe("kept applets", () => {
  it("an applet's own address is kept; one that hands it a note is not", () => {
    expect(keptId({ pathname: "/v/home/a/01ABC", search: "" })).toBe('["home","01ABC"]');
    expect(keptId({ pathname: "/v/home/a/01ABC", search: "?room=r1&event=" + "e".repeat(64) })).toBe('["home","01ABC"]');
    // two applets whose names would join alike are two screens (one applet's start never carries to another)
    expect(keptId({ pathname: "/v/a%7Cb/a/c", search: "" })).not.toBe(keptId({ pathname: "/v/a/a/b%7Cc", search: "" }));
    expect(keptId({ pathname: "/v/home/a/01ABC", search: "?note=01N" })).toBeNull();
    expect(keptId({ pathname: "/v/home/a/01ABC", search: "?room=r1&screen=s" })).toBeNull();
    expect(keptId({ pathname: "/v/home/n/01ABC", search: "" })).toBeNull();
    expect(keptId({ pathname: "/settings", search: "" })).toBeNull();
  });
  it("the one shown stays; of the others only those that run, the most recently shown first, KEEP of them", () => {
    const all = [entry("a", 1), entry("b", 2), entry("c", 3, false), entry("d", 4), entry("e", 5), entry("f", 6)];
    expect(stays(all, "a", 3).map((e) => e.id).sort()).toEqual(["a", "d", "e", "f"]);
    expect(stays(all, "a", 3)).toHaveLength(4);
    // a computer (the tests' browser) keeps 12
    expect(KEEP).toBe(KEEP_DESKTOP);
    const many = Array.from({ length: 20 }, (_, i) => entry(`x${i}`, i));
    expect(stays(many, null)).toHaveLength(KEEP);
    // the one shown stays even while it can't be kept (asking, stopped)
    expect(stays([entry("c", 3, false)], "c").map((e) => e.id)).toEqual(["c"]);
    // nothing shown (the launcher): only the ones that run
    expect(stays([entry("c", 3, false), entry("d", 4)], null).map((e) => e.id)).toEqual(["d"]);
  });
});
