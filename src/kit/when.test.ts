// when: the kit's dates. What a moment is read as (seconds or milliseconds), and which words a day gets, are the logic.
import { describe, expect, it } from "vitest";
import { when } from "./when";

const now = new Date(2026, 10, 19, 15, 30); // Thu 19 Nov 2026, 3:30 PM, local time
const at = (d: number, h = 9, m = 41, y = 2026, mo = 10) => new Date(y, mo, d, h, m);

describe("when", () => {
  it("reads a Date, an ISO string, milliseconds and a relay's seconds as the same moment", () => {
    const d = at(17);
    for (const t of [d, d.toISOString(), d.getTime(), Math.floor(d.getTime() / 1000)]) expect(when.parse(t)?.getTime()).toBe(Math.floor(d.getTime() / 1000) * 1000);
  });
  it("reads a date alone as that day here, not as midnight in London", () => {
    expect(when.parse("2026-11-17")?.getDate()).toBe(17);
    expect(when.day("2026-11-17", now)).toMatch(/Tuesday/);
    expect(when.parse("2026-02-31")).toBeNull();
  });
  it("gives nothing for what isn't a moment", () => {
    for (const t of [null, undefined, "", "soon", NaN, new Date("x")]) { expect(when.parse(t)).toBeNull(); expect(when.short(t)).toBe(""); expect(when.stamp(t)).toBe(""); }
  });
  it("names the day: today, yesterday by the calendar, else the date (with the year when not this one)", () => {
    expect(when.day(at(19, 0, 5), now)).toBe("Today");
    expect(when.day(at(18, 23, 59), now)).toBe("Yesterday");
    expect(when.day(at(17), now)).toMatch(/Tuesday/);
    expect(when.day(at(17, 9, 41, 2025), now)).toMatch(/2025/);
  });
  it("short: the time today, Yesterday, the weekday this week, the date after", () => {
    expect(when.short(at(19), now)).toBe(when.time(at(19)));
    expect(when.short(at(18), now)).toBe("Yesterday");
    expect(when.short(at(15), now)).toMatch(/Sun/);
    expect(when.short(at(2), now)).toMatch(/Nov/);
    expect(when.short(at(2), now)).not.toMatch(/2026/);
    expect(when.short(at(2, 9, 41, 2025), now)).toMatch(/2025/);
  });
  it("ago: now, minutes, hours today, then as short", () => {
    expect(when.ago(new Date(now.getTime() - 20_000), now)).toBe("now");
    expect(when.ago(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m");
    expect(when.ago(new Date(now.getTime() - 3 * 3600_000), now)).toBe("3h");
    expect(when.ago(at(18, 22, 0), now)).toBe("Yesterday");
  });
  it("stamp and path: the moment in a note's name, sorted as text", () => {
    expect(when.stamp(at(7, 8, 5))).toBe("2026-11-07 08-05");
    expect(when.path(at(7, 8, 5))).toBe("2026/11-07/08-05");
    expect(when.path(new Date(2026, 10, 7, 8, 5, 9), true)).toBe("2026/11-07/08-05-09");
  });
});
