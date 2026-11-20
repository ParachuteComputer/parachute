import { describe, expect, it } from "vitest";
import { isAppOwn, isAppPath } from "./notes";

describe("isAppPath", () => {
  it.each(["/v/recipes/n/abc", "/settings"])("keeps %s in the app", (h) => expect(isAppPath(h)).toBe(true));
  it.each(["//evil.example", "/\\evil.example", "https://x.example", "javascript:alert(1)", "#top"])("sends %s outside", (h) => expect(isAppPath(h)).toBe(false));
});

describe("the app's own notes", () => {
  it("a pointer is the app's, not something the person wrote lately; the person's own note in the same folder is theirs", () => {
    expect(isAppOwn({ path: "Parachute/From/techne.example/techne/component-events", tags: ["parachute-pointer"] })).toBe(true);
    // a bundle record, under its name and its older one, is the app's own, never among what the person wrote lately
    expect(isAppOwn({ path: "Parachute/Bundles/uni", tags: ["parachute-bundle"] })).toBe(true);
    expect(isAppOwn({ path: "Parachute/Apps/uni", tags: ["parachute-app"] })).toBe(true);
    expect(isAppOwn({ path: "Parachute/From/techne.example/techne/my notes", tags: [] })).toBe(false);
  });
});
