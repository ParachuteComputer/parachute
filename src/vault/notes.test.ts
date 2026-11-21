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

describe("a note's title", () => {
  it("is its name; a journal entry's without its time (Journal's and the Uni app's paths)", async () => {
    const { titleOf } = await import("./notes");
    expect(titleOf({ id: "x", path: "Notes/Groceries.md" })).toBe("Groceries");
    expect(titleOf({ id: "x", path: "Journal/2026/11-21/07-15 Walked to the bakery" })).toBe("Walked to the bakery");
    expect(titleOf({ id: "x", path: "Journal/2026/11-21/07-15-42 Walked to the bakery" })).toBe("Walked to the bakery");
    // a time-looking name elsewhere is a name, under a dated folder too
    expect(titleOf({ id: "x", path: "Meetings/07-15 Standup" })).toBe("07-15 Standup");
    expect(titleOf({ id: "x", path: "Photos/2026/11-21/07-15 IMG_0001" })).toBe("07-15 IMG_0001");
    expect(titleOf({ id: "01ABC", path: "" })).toBe("01ABC");
  });
});

describe("a journal entry's time", () => {
  it("is said beside its title, so two entries of a day with the same words stay apart", async () => {
    const { entryTime } = await import("./notes");
    expect(entryTime({ path: "Journal/2026/11-21/07-15 Tired" })).toBe("07:15");
    expect(entryTime({ path: "Journal/2026/11-21/21-40-12 Tired" })).toBe("21:40");
    expect(entryTime({ path: "Notes/Groceries" })).toBeNull();
  });
});
