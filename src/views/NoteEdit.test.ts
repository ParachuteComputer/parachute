// The editor's two rules: a new note is named by its first line, and a vault given to read only isn't written.
import { describe, expect, it } from "vitest";
import { canWrite, pathFromText } from "./NoteEdit";

describe("a new note's name", () => {
  it("is its first line, plain: no heading mark, folder, or leading dot or space", () => {
    expect(pathFromText("# Seed order\n\nBeans")).toBe("Seed order");
    expect(pathFromText("\n\n  ../.. call mum / now")).toBe("call mum now");
    expect(pathFromText(". call mum")).toBe("call mum");
    expect(pathFromText("a".repeat(200))).toHaveLength(80);
  });
  it("with no words, the time it was written", () => {
    expect(pathFromText("  \n ", new Date(2026, 10, 18, 9, 5))).toBe("Note 2026-11-18 09-05");
  });
});

describe("may this device write there", () => {
  it("as the sign-in's scope says", () => {
    expect(canWrite({ scope: "vault:garden:read vault:garden:write" })).toBe(true);
    expect(canWrite({ scope: "vault:read vault:write" })).toBe(true);
    expect(canWrite({ scope: "vault:garden:read" })).toBe(false);
    expect(canWrite({ scope: "vault:read" })).toBe(false);
  });
});
