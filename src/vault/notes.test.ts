import { describe, expect, it } from "vitest";
import { isAppPath } from "./notes";

describe("isAppPath", () => {
  it.each(["/v/recipes/n/abc", "/settings"])("keeps %s in the app", (h) => expect(isAppPath(h)).toBe(true));
  it.each(["//evil.example", "/\\evil.example", "https://x.example", "javascript:alert(1)", "#top"])("sends %s outside", (h) => expect(isAppPath(h)).toBe(false));
});
