import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { approvalContent, dOf, type SignedEvent, type Subject } from "../applet/approvals";
import { askedOf, codeOf, DEFAULTS, fullOf, loosens, raise, subjectFor, syncLevels, type Asked, type Levels } from "./levels";
import { appOf } from "./apps";

const home = { issuer: "https://hub.example", vault: "home" };
const now = Date.parse("2026-11-19T12:00:00Z");

/** A device: its levels raised as Rust raises them, and a lowering taken only through `levelsAdopt`. */
function device(start: Levels) {
  const d = { levels: start, adopted: [] as SignedEvent[] };
  return {
    d,
    native: {
      levelsRaise: async (asked: Asked) => (d.levels = raise(d.levels, asked)),
      levelsAdopt: async (ev: SignedEvent) => { d.adopted.push(ev); d.levels = fullOf(askedFromCode(JSON.parse(ev.content).code)); return d.levels; },
    },
  };
}
const askedFromCode = (code: string): Asked => {
  const m = /^levels:v1:approvals=(\w+),code=(\w+),join=(\w+),idle=(\d+)$/.exec(code)!;
  return { approvals: m[1] as Levels["approvals"], code: m[2] as Levels["code"], join: m[3] as Levels["join"], idle: Number(m[4]) };
};
function signed(sk: Uint8Array, s: Subject, levels: Levels, at = now - 60_000): SignedEvent {
  const content = approvalContent({ subject: s, approved: true, code: codeOf(levels), scope: "", now: at, seen: null });
  return finalizeEvent({ kind: 30479, created_at: Math.floor(at / 1000), tags: [["d", dOf(s)]], content: JSON.stringify(content) }, sk) as SignedEvent;
}

describe("security levels", () => {
  it("names the levels exactly as the native side reads them back", () => {
    // the same line as src-tauri/src/levels.rs `the_levels_text_reads_back_exactly`
    expect(codeOf({ approvals: "none", code: "passcode", join: "unlock", idle: 15 })).toBe("levels:v1:approvals=none,code=passcode,join=unlock,idle=15");
  });

  it("reads a record's security strictly, and the record's older word for approving code", () => {
    expect(askedOf({ approve: "passcode" })).toEqual({ code: "passcode" });
    expect(askedOf({ approvals: "nothing", join: "PASSCODE", idle: -1, code: "none" })).toEqual({ code: "none" });
    expect(fullOf({ code: "none" }).code).toBe("unlock");
    expect(askedOf({ idle: 99999 })).toEqual({ idle: 1440 });
    expect(appOf({ contract: 1, id: "uni", name: "Uni", security: { approvals: "passcode", idle: 5 } }, "Parachute/Apps/uni", "01A")!.security).toEqual({ approvals: "passcode", idle: 5 });
    expect(appOf({ contract: 1, id: "uni", name: "Uni" }, "Parachute/Apps/uni", "01A")!.security).toEqual({});
  });

  it("lets a record make a device stricter, never looser", () => {
    const strict: Levels = { approvals: "passcode", code: "passcode", join: "passcode", idle: 5 };
    for (const asked of [{ approvals: "none", code: "unlock", join: "none", idle: 0 }, { idle: 60 }, {}] as Asked[]) expect(raise(strict, asked)).toEqual(strict);
    expect(raise(DEFAULTS, { idle: 10, approvals: "passcode" })).toEqual({ ...DEFAULTS, idle: 10, approvals: "passcode" });
    expect(loosens({ ...DEFAULTS, idle: 5 }, DEFAULTS)).toBe(true);
    expect(loosens(DEFAULTS, { ...DEFAULTS, idle: 5 })).toBe(false);
  });

  it("an unsigned record edit weakens nothing; only the person's own signed approval of exactly those levels does", async () => {
    const mine = generateSecretKey(), me = getPublicKey(mine);
    const strict: Levels = { ...DEFAULTS, idle: 5, approvals: "passcode" };
    const loose: Levels = { ...DEFAULTS, idle: 0, approvals: "none" };
    const app = { id: "uni", security: loose as Asked };
    const s = subjectFor(home, "uni");
    const deps = (events: unknown[]) => ({ approvals: async () => events, trusted: async () => new Set([me]), floor: () => null, raiseFloor: () => {}, now });

    // someone who can write the vault turns the idle lock off and the cards to a tap: nothing changes
    let dev = device(strict);
    expect(await syncLevels(app, home, { native: dev.native, ...deps([]) })).toEqual(strict);
    expect(dev.d.adopted).toEqual([]);
    // with an approval signed by a key of theirs
    dev = device(strict);
    expect(await syncLevels(app, home, { native: dev.native, ...deps([signed(generateSecretKey(), s, loose)]) })).toEqual(strict);
    // with the person's approval of other levels (an older lowering, put beside a newer edit)
    dev = device(strict);
    expect(await syncLevels(app, home, { native: dev.native, ...deps([signed(mine, s, { ...loose, idle: 15 })]) })).toEqual(strict);
    // with the person's approval edited after signing
    const edited = { ...signed(mine, s, loose) };
    edited.content = edited.content.replace("approvals=none", "approvals=unlock");
    dev = device(strict);
    expect(await syncLevels({ id: "uni", security: { ...loose, approvals: "unlock" } }, home, { native: dev.native, ...deps([edited]) })).toEqual({ ...strict, approvals: "passcode" });
    expect(dev.d.adopted).toEqual([]);
    // with another app's approval moved over
    dev = device(strict);
    expect(await syncLevels(app, home, { native: dev.native, ...deps([signed(mine, subjectFor(home, "simple"), loose)]) })).toEqual(strict);

    // the person's own signed approval of exactly the record's levels: taken (Rust checks it again)
    dev = device(strict);
    const ok = signed(mine, s, loose);
    expect(await syncLevels(app, home, { native: dev.native, ...deps([ok]) })).toEqual(loose);
    expect(dev.d.adopted.map((e) => e.id)).toEqual([ok.id]);
  });

  it("a stricter record is taken at once, with nothing signed", async () => {
    const dev = device(DEFAULTS);
    expect(await syncLevels({ id: "uni", security: { idle: 5, join: "passcode" } }, home, { native: dev.native, approvals: async () => { throw new Error("not read"); }, trusted: async () => new Set(), floor: () => null, raiseFloor: () => {} })).toEqual({ ...DEFAULTS, idle: 5 });
  });
});
