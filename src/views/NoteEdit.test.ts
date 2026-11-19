// The editor's two rules: a new note is named by its first line, and a vault given to read only isn't written.
import { describe, expect, it } from "vitest";
import { pathFromText } from "./NoteEdit";
import { levelIn } from "../vault/parachute";

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
    expect(levelIn("vault:garden:read vault:garden:write", "garden")).toBe("write");
    expect(levelIn("vault:read vault:write", "garden")).toBe("write");
    expect(levelIn("vault:garden:read", "garden")).toBe("read");
    expect(levelIn("vault:read", "garden")).toBe("read");
  });
});
