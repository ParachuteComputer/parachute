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
  it("every record the app keeps is its own: any parachute- tag, and its folders", () => {
    // approvals, receipts, keys, saved views: out of what the person wrote lately (T-476: they led a person's Lately)
    for (const t of ["parachute-approval", "parachute-receipt", "parachute-keys", "parachute-view"]) expect(isAppOwn({ path: "Somewhere/x", tags: [t] })).toBe(true);
    expect(isAppOwn({ path: "Parachute/Approvals/127.0.0.1:26047/kitchen/01KQ7Z3V9M4T2B8XJ6R5N1C0HD", tags: [] })).toBe(true);
    expect(isAppOwn({ path: "Parachute/Settings", tags: [] })).toBe(true);
    expect(isAppOwn({ path: ".parachute/state", tags: [] })).toBe(true);
    // the person's: a tag that only starts like the app's, and their own folders
    expect(isAppOwn({ path: "Notes/Parachute packing list", tags: ["parachuting"] })).toBe(false);
    expect(isAppOwn({ path: "Trips/Parachute/Packing", tags: [] })).toBe(false);
  });
});

describe("a note's title", () => {
  it("is its name; a journal entry's without its time (Journal's and the Uni app's paths)", async () => {
    const { titleOf } = await import("./notes");
    expect(titleOf({ id: "x", path: "Notes/Groceries.md" })).toBe("Groceries");
    expect(titleOf({ id: "x", path: "Journal/2026/11-21/07-15 Walked to the bakery" })).toBe("Walked to the bakery");
    expect(titleOf({ id: "x", path: "Journal/2026/11-21/07-15-42 Walked to the bakery" })).toBe("Walked to the bakery");
    expect(titleOf({ id: "x", path: "Journal/2026/11-21/07-15-42-2 Walked to the bakery" })).toBe("Walked to the bakery");
    // a time-looking name elsewhere is a name, under a dated folder too
    expect(titleOf({ id: "x", path: "Meetings/07-15 Standup" })).toBe("07-15 Standup");
    expect(titleOf({ id: "x", path: "Photos/2026/11-21/07-15 IMG_0001" })).toBe("07-15 IMG_0001");
  });

  it("is never an id: a record with no name of its own is called by its type and first words, else by its kind and date", async () => {
    const { titleOf } = await import("./notes");
    const ulid = "01KQ7Z3V9M4T2B8XJ6R5N1C0HD";
    // its first words, without markdown, cut on a word
    expect(titleOf({ id: ulid, path: `Inbox/${ulid}`, content: "# Call the roofer\n\nbefore the rain" })).toBe("Call the roofer");
    expect(titleOf({ id: ulid, path: "", content: "- [ ] **Order** the flashing for the shed roof, and ask the yard about cedar shakes this week" })).toBe("Order the flashing for the shed roof, and ask the yard…");
    expect(titleOf({ id: ulid, path: ulid, content: "Pick up [[Rye bread|the rye]] at six", types: ["task"] })).toBe("Task: Pick up the rye at six");
    // a list read: the hub's first line, else its preview (lists carry no words)
    expect(titleOf({ id: ulid, path: ulid, displayTitle: "Call the roofer", preview: "# Call the roofer before the rain" })).toBe("Call the roofer");
    expect(titleOf({ id: ulid, path: ulid, preview: "Call the roofer before the rain." })).toBe("Call the roofer before the rain");
    // a path that is a UUID or a hex run, or no path at all
    expect(titleOf({ id: "x", path: "Notes/3f2a9c1e-77b0-4c1d-9a55-0e8d2f4b6a10", content: "Seed swap" })).toBe("Seed swap");
    expect(titleOf({ id: "x", path: "Notes/a3f29c1e77b04c1d", content: "Seed swap" })).toBe("Seed swap");
    // no words (empty, or data): its type or "A note", and the day it was made
    const day = new Date("2026-11-21T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    expect(titleOf({ id: ulid, path: ulid, content: "{\"a\": 1}", createdAt: "2026-11-21T12:00:00Z" })).toBe(`A note from ${day}`);
    expect(titleOf({ id: ulid, path: ulid, types: ["meeting"], createdAt: "2026-11-21T12:00:00Z" })).toBe(`Meeting from ${day}`);
    expect(titleOf({ id: ulid, path: "" })).toBe("A note with no name");
    // the app's own folders: the kind of thing kept there
    expect(titleOf({ id: ulid, path: `Parachute/Approvals/127.0.0.1:26047/kitchen/${ulid}`, content: "{}" })).toBe("Approval");
    expect(titleOf({ id: ulid, path: `Parachute/Keys/${ulid}` })).toBe("Key");
    // a name that only looks a little like an id is a name
    expect(titleOf({ id: ulid, path: "Notes/2026 budget" })).toBe("2026 budget");
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
