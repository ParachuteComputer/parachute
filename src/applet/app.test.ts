// What an applet asks of the app beyond its vault: read strictly, on the card, and in the grant's key.
import { describe, expect, it } from "vitest";
import { parseApp } from "./app";
import { readApplet } from "./discovery";
import { parseManifest } from "./manifest";
import { canonical, grantKey, grantLines, grantOf } from "./grant";
import { sha256Hex } from "./needs";
import { RECIPES } from "./fixtures";
import { appHref } from "./modules/app";

const m = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();

describe("metadata.app", () => {
  it("is a short list of known words, each once; anything else is refused", () => {
    expect(parseApp(undefined)).toEqual({ ok: true, app: [] });
    expect(parseApp(["open", "recent"])).toEqual({ ok: true, app: ["recent", "open"] });
    for (const bad of ["recent", ["recent", "recent"], ["tokens"], [1], {}, ["recent", "pins", "open", "x"]]) expect(parseApp(bad).ok).toBe(false);
  });
  it("a bad app costs the applet what it asked of the app, not the applet (as a bad opens does)", () => {
    const r = readApplet({ id: "n1", path: "Applets/Recipes", tags: ["applet"], metadata: { applet: RECIPES, app: "recipes" } }, "v");
    expect(r.ok && r.entry.app).toEqual([]);
    expect(r.ok && r.entry.appError).toMatch(/app must be a list/);
    const ok = readApplet({ id: "n1", path: "Applets/Recipes", tags: ["applet"], metadata: { applet: RECIPES, app: ["pins"] } }, "v");
    expect(ok.ok && ok.entry.app).toEqual(["pins"]);
  });
  it("each word is a line on the card; reading every vault is stressed", () => {
    const lines = grantLines(grantOf({ ...m, allow: [] }, "v", [], ["recent", "pins", "open"]), "Applets/");
    expect(lines).toEqual([
      { text: "See the titles of the newest notes in every vault on this device", stress: true },
      { text: "See what is on your bar", stress: false },
      { text: "Take you to a note or an applet when you tap, see which note links lead to a note, and know its vault's web address", stress: false },
    ]);
  });
  it("adding a word asks again; an applet that asks nothing keeps the key it had (no grant lost to this change)", async () => {
    const none = await grantKey(grantOf(m, "v", []), "Applets/Recipes");
    expect(await grantKey(grantOf(m, "v", [], ["pins"]), "Applets/Recipes")).not.toBe(none);
    expect(await grantKey(grantOf(m, "v", [], ["pins", "open"]), "Applets/Recipes")).not.toBe(await grantKey(grantOf(m, "v", [], ["pins"]), "Applets/Recipes"));
    // taking a word away asks again too
    expect(await grantKey(grantOf(m, "v", [], ["pins"]), "Applets/Recipes")).not.toBe(await grantKey(grantOf(m, "v", [], ["pins", "open"]), "Applets/Recipes"));
    expect(await grantKey(grantOf(m, "v", [], ["open", "pins"]), "Applets/Recipes")).toBe(await grantKey(grantOf(m, "v", [], ["pins", "open"]), "Applets/Recipes"));
    // the key as it was computed before `app` existed
    const allow = [...new Set(m.allow.map((r) => canonical({ path: r.path, verbs: [...r.verbs].sort() })))].sort();
    expect(none).toBe(await sha256Hex(canonical({ v: 3, note: "Applets/Recipes", applet: m.id, vault: "v", allow, opens: [] })));
  });
  it("open goes only to the app's own places", () => {
    for (const ok of ["/", "/v/kitchen", "/v/kitchen/n/01ABC", "/v/kitchen/a/01ABC", "/v/k%40h/n/Recipes%2FSoup"]) expect(appHref(ok), ok).toBe(true);
    // an applet at a room (its launch, as a notification's tap gives it), and nothing else in a query
    const ev = "a".repeat(64);
    for (const ok of ["/v/home/a/01ROOMS?room=parachute", `/v/home/a/01ROOMS?room=r_1-x&event=${ev}`]) expect(appHref(ok), ok).toBe(true);
    for (const bad of ["/v/home/n/01X?room=parachute", "/?room=x", "/v/home/a/01R?screen=x", "/v/home/a/01R?room=", "/v/home/a/01R?room=a/b", `/v/home/a/01R?event=${ev}&room=x`,
      "/v/home/a/01R?room=x&event=zz", "/v/home/a/01R?room=x&next=/settings", "/v/home/a/01R?room=x#h", "/v/home/a/../../settings?room=x", "/v/home/a/01R??room=x"]) expect(appHref(bad), bad).toBe(false);
    for (const bad of ["//evil.example", "https://evil.example", "/settings", "/add", "/v/k/n/x?y=1", "/v/k/x/y", "/oauth/callback", "javascript:alert(1)",
      // what the browser would read as another address: a backslash, encoded or plain dot segments, a stripped tab
      "/v/kitchen/n/a\\..\\..\\..\\..\\settings", "/v/%2e%2e/n/x", "/v/%2E%2E", "/v/k/n/..", "/v/../a/x", "/v/k/n/a\t", "/v/k/n/a\n"]) expect(appHref(bad), bad).toBe(false);
  });
});
