import { describe, expect, it } from "vitest";
import { isAppPath } from "./notes";

describe("isAppPath", () => {
  it.each(["/v/recipes/n/abc", "/settings"])("keeps %s in the app", (h) => expect(isAppPath(h)).toBe(true));
  it.each(["//evil.example", "/\\evil.example", "https://x.example", "javascript:alert(1)", "#top"])("sends %s outside", (h) => expect(isAppPath(h)).toBe(false));
});

describe("the app's own notes", () => {
  it("a pointer is the app's, not something the person wrote lately", async () => {
    const { isAppOwn } = await import("./notes");
    expect(isAppOwn({ path: "Parachute/From/techne.example/techne/component-events", tags: ["parachute-pointer"] })).toBe(true);
  });
});
