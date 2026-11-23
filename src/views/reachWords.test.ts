import { describe, expect, it } from "vitest";
import { names, reachCount, reachLine, why, type ReachFacts } from "./reachWords";

const f = (x: Partial<ReachFacts>): ReachFacts => ({ level: "read", home: false, applets: [], own: false, theirs: false, ...x });

describe("what Parachute holds of a vault, in words", () => {
  it("the home is said as the home, whatever else reaches it", () => {
    expect(reachLine(f({ level: "write", home: true, applets: ["Journal"] }))).toBe("reads and changes notes · your home");
  });
  it("names the applets allowed there, sorted, the rest counted", () => {
    expect(reachLine(f({ level: "write", applets: ["Mail"] }))).toBe("reads and changes notes · for Mail");
    expect(names(["Rooms", "Mail", "Journal"])).toBe("Journal, Mail and Rooms");
    expect(names(["Rooms", "Mail", "Journal", "Calendar", "Mail"])).toBe("Calendar, Journal and 2 more");
    expect(why(f({ applets: ["Post"] })).long).toMatch(/^Post reaches it, as you allowed on its card/);
  });
  it("held for nothing allowed is said plainly, so it can be let go", () => {
    const w = why(f({ level: "write" }));
    expect(w.idle).toBe(true);
    expect(reachLine(f({ level: "write" }))).toBe("reads and changes notes · no applet uses it");
    expect(reachLine(f({ level: "write", own: true }))).toBe("reads and changes notes · for your own changes");
  });
  it("someone else's says so first", () => {
    expect(reachLine(f({ theirs: true, applets: ["Events"] }))).toBe("Someone else's · reads notes · for Events");
  });
  it("counts what it reaches and what it doesn't read", () => {
    expect(reachCount(1, 0)).toBe("Parachute reaches 1 vault here.");
    expect(reachCount(3, 12)).toBe("Parachute reaches 3 vaults here, and doesn't read 12 more.");
    expect(reachCount(0, 2)).toBe("Parachute reads none of your 2 vaults here.");
    expect(reachCount(0, 0)).toBe("");
  });
});
