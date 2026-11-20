import { describe, expect, it } from "vitest";
import { ago, approvedOtherLine, changedLine, lastCodeChange, whoOf, type NoteNow, type Version } from "./changedBy";

const NOW = new Date(2026, 10, 20, 15, 0).getTime();
const UNI = "a".repeat(64), MINE = "b".repeat(64), STRANGER = "c".repeat(64);
const named = (h: string) => (h === UNI ? "Uni" : null);
const own = { key: MINE, account: "u-aaron" };
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("who changed an applet's code, as its card says it", () => {
  it("Uni with its key, the 4th version today; the person's account through MCP", () => {
    expect(changedLine({ at: at(12), by: "u-aaron", via: `nostr:${UNI}` }, { now: NOW, version: 4, own, named })).toBe("Changed 12 minutes ago by Uni. The 4th version today.");
    expect(changedLine({ at: at(12), by: "u-aaron", via: "mcp" }, { now: NOW, version: 4, own, named })).toBe("Changed 12 minutes ago by your account (through MCP). The 4th version today.");
  });
  it("a write nobody named stands out: another account on the hub, a hub token, a key with no name here", () => {
    expect(changedLine({ at: at(180), by: "u-other", via: "api" }, { now: NOW, own, named })).toBe("Changed 3 hours ago by someone else on your hub (through the hub's API).");
    expect(changedLine({ at: at(5), by: "token:9f2", via: "api" }, { now: NOW, own, named })).toBe("Changed 5 minutes ago by a hub token (through the hub's API).");
    expect(changedLine({ at: at(5), by: "u-aaron", via: `nostr:${STRANGER}` }, { now: NOW, own, named })).toBe("Changed 5 minutes ago by a key you haven't named (cccccccc…).");
  });
  it("the person's own key, a hub key by its name (quoted), the operator; an account it can't tell from theirs is not called someone else", () => {
    expect(whoOf({ at: null, by: "u-aaron", via: `nostr:${MINE}` }, { own, named }).who).toBe("you");
    expect(whoOf({ at: null, by: "u-aaron", via: "key:Uni" }, { own, named }).who).toBe("the hub key «Uni»");
    expect(whoOf({ at: null, by: "operator", via: "operator" }, { own, named })).toEqual({ who: "the hub's operator", how: "on the hub itself" });
    expect(whoOf({ at: null, by: "u-aaron", via: "api" }, { own: { key: MINE, account: null }, named })).toEqual({ who: null, how: "through the hub's API" });
  });
  it("only what the hub said: no author, just when; nothing at all, no line; one version today, no count", () => {
    expect(changedLine({ at: at(0.2), by: null, via: null }, { now: NOW, version: 1 })).toBe("Changed just now.");
    expect(changedLine({ at: null, by: null, via: null }, { now: NOW })).toBeNull();
  });
  it("yesterday is the day before, not 24 hours: late the same day it is hours", () => {
    const late = new Date(2026, 10, 20, 23, 50).getTime();
    expect(ago(new Date(2026, 10, 20, 0, 10).toISOString(), late)).toBe("23 hours ago");
    expect(ago(new Date(2026, 10, 19, 23, 50).toISOString(), new Date(2026, 10, 20, 0, 20).getTime())).toBe("30 minutes ago");
    expect(ago(new Date(2026, 10, 19, 20, 0).toISOString(), new Date(2026, 10, 20, 9, 0).getTime())).toBe("yesterday");
    expect(ago(at(3 * 24 * 60), NOW)).toBe("3 days ago");
  });
});

describe("the last write that changed the code, from the hub's kept versions", () => {
  const note = (o: Partial<NoteNow> = {}): NoteNow => ({ hash: "h4", createdAt: "2026-11-18T10:00:00Z", createdBy: "u-aaron", createdVia: "api", updatedAt: at(2), updatedBy: "u-aaron", updatedVia: `nostr:${UNI}`, ...o });
  const v = (before: string | null, min: number, via: string, actor = "u-aaron"): Version => ({ content_hash: before, actor, via, superseded_at: at(min) });
  it("a write of the note's fields after the code changed isn't the change: the code's last writer is named", () => {
    // newest first: Uni touched the fields 2 minutes ago (h4 before and after); a token wrote h4 over h3 at 03:12-ish
    const r = lastCodeChange(note(), [v("h4", 2, `nostr:${UNI}`), v("h3", 300, "api", "token:9f2"), v("h2", 400, "mcp"), v("h1", 2000, "mcp")], NOW);
    expect(r.changed).toEqual({ at: at(300), by: "token:9f2", via: "api" });
    expect(r.version).toBe(2);
    expect(changedLine(r.changed, { now: NOW, version: r.version, own, named })).toBe("Changed 5 hours ago by a hub token (through the hub's API). The 2nd version today.");
  });
  it("made today counts as a version; no versions kept: the note's last write, no count", () => {
    expect(lastCodeChange(note({ createdAt: at(500) }), [v("h3", 10, "mcp")], NOW).version).toBe(2);
    expect(lastCodeChange(note(), null, NOW)).toEqual({ changed: { at: at(2), by: "u-aaron", via: `nostr:${UNI}` }, version: null });
  });
  it("no change of code since the versions begin: whoever made it, while the versions reach back to its making", () => {
    expect(lastCodeChange(note({ createdBy: "u-other" }), [v("h4", 2, "mcp")], NOW).changed).toEqual({ at: "2026-11-18T10:00:00Z", by: "u-other", via: "api" });
    const full = Array.from({ length: 50 }, (_, i) => v("h4", i + 1, "mcp"));
    expect(lastCodeChange(note(), full, NOW).changed).toEqual({ at: null, by: null, via: null });
  });
});

describe("an approval of other code made on another device", () => {
  it("where and when, only when the code differs", () => {
    expect(approvedOtherLine({ approved: true, at: at(3 * 24 * 60), device: "Android", code: "tsx:old" }, "tsx:new", NOW)).toBe("You approved another version on Android, 3 days ago.");
    expect(approvedOtherLine({ approved: true, at: at(5), device: "Android", code: "tsx:new" }, "tsx:new", NOW)).toBeNull();
    expect(approvedOtherLine({ approved: false, at: at(5), code: "" }, "tsx:new", NOW)).toBeNull();
  });
});
