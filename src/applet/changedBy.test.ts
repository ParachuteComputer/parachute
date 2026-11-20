import { describe, expect, it } from "vitest";
import { ago, approvedOtherLine, changedLine, versionToday, whoOf } from "./changedBy";

const NOW = Date.parse("2026-11-20T15:00:00");
const UNI = "a".repeat(64), MINE = "b".repeat(64), STRANGER = "c".repeat(64);
const named = (h: string) => (h === UNI ? "Uni" : null);
const own = { key: MINE, account: "u-aaron" };
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("who changed an applet's code, as its card says it", () => {
  it("Uni through MCP, the 4th version today", () => {
    expect(changedLine({ at: at(12), by: "u-aaron", via: `nostr:${UNI}` }, { now: NOW, version: 4, own, named })).toBe("Changed 12 minutes ago by Uni. The 4th version today.");
    expect(changedLine({ at: at(12), by: "u-aaron", via: "mcp" }, { now: NOW, version: 4, own, named })).toBe("Changed 12 minutes ago by your account (through MCP). The 4th version today.");
  });
  it("a write nobody named stands out: another account on the hub, a hub token, a key with no name here", () => {
    expect(changedLine({ at: at(180), by: "u-other", via: "api" }, { now: NOW, own, named })).toBe("Changed 3 hours ago by someone else on your hub (through the hub's API).");
    expect(changedLine({ at: at(5), by: "token:9f2", via: "api" }, { now: NOW, own, named })).toBe("Changed 5 minutes ago by a hub token (through the hub's API).");
    expect(changedLine({ at: at(5), by: "u-aaron", via: `nostr:${STRANGER}` }, { now: NOW, own, named })).toBe("Changed 5 minutes ago by a key you haven't named (cccccccc…).");
  });
  it("the person's own key or a hub key by its name, quoted", () => {
    expect(whoOf({ at: null, by: "u-aaron", via: `nostr:${MINE}` }, { own, named }).who).toBe("you");
    expect(whoOf({ at: null, by: "u-aaron", via: "key:uni-mcp" }, { own, named }).who).toBe("the hub key «uni-mcp»");
    expect(whoOf({ at: null, by: "operator", via: "operator" }, { own, named })).toEqual({ who: "the hub's operator", how: "on the hub itself" });
  });
  it("only what the hub said: no author, just when; nothing at all, no line; one version today, no count", () => {
    expect(changedLine({ at: at(0.2), by: null, via: null }, { now: NOW, version: 1 })).toBe("Changed just now.");
    expect(changedLine({ at: null, by: null, via: null }, { now: NOW })).toBeNull();
  });
  it("counts the versions written today: each write replaced one, the hub kept it with the time", () => {
    expect(versionToday({ createdAt: "2026-11-18T10:00:00", updatedAt: at(12), replaced: [at(12), at(40), at(90), "2026-11-19T09:00:00"], now: NOW })).toBe(3);
    expect(versionToday({ createdAt: at(200), updatedAt: at(12), replaced: [at(12), at(40), at(90)], now: NOW })).toBe(4);
    expect(versionToday({ createdAt: null, updatedAt: "2026-11-19T09:00:00", replaced: [], now: NOW })).toBeNull();
    expect(versionToday({ createdAt: null, updatedAt: at(3), replaced: null, now: NOW })).toBeNull();
  });
  it("an approval of other code made on another device: where and when", () => {
    expect(approvedOtherLine({ approved: true, at: at(3 * 24 * 60), device: "Android" }, NOW)).toBe("You approved another version on Android, 3 days ago.");
    expect(approvedOtherLine({ approved: false, at: at(5) }, NOW)).toBeNull();
    expect(ago(at(60 * 24), NOW)).toBe("yesterday");
  });
});
