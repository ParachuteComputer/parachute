// What an applet asks of the app beyond its vault: read strictly, on the card, and in the grant's key.
import { describe, expect, it } from "vitest";
import { parseApp } from "./app";
import { parseManifest } from "./manifest";
import { canonical, grantKey, grantLines, grantOf } from "./grant";
import { sha256Hex } from "./needs";
import { RECIPES } from "./fixtures";
import { APP_HREF } from "./modules/app";

const m = (() => { const r = parseManifest(RECIPES); if (!r.ok) throw new Error(r.error); return r.manifest; })();

describe("metadata.app", () => {
  it("is a short list of known words, each once; anything else refuses the applet", () => {
    expect(parseApp(undefined)).toEqual({ ok: true, app: [] });
    expect(parseApp(["open", "recent"])).toEqual({ ok: true, app: ["recent", "open"] });
    for (const bad of ["recent", ["recent", "recent"], ["tokens"], [1], {}, ["recent", "pins", "open", "x"]]) expect(parseApp(bad).ok).toBe(false);
  });
  it("each word is a line on the card; reading every vault is stressed", () => {
    const lines = grantLines(grantOf({ ...m, allow: [] }, "v", [], ["recent", "pins", "open"]), "Applets/");
    expect(lines).toEqual([
      { text: "See the titles of the newest notes in every vault on this device", stress: true },
      { text: "See what is on your bar", stress: false },
      { text: "Take you to a note or an applet when you tap", stress: false },
    ]);
  });
  it("adding a word asks again; an applet that asks nothing keeps the key it had (no grant lost to this change)", async () => {
    const none = await grantKey(grantOf(m, "v", []), "Applets/Recipes");
    expect(await grantKey(grantOf(m, "v", [], ["pins"]), "Applets/Recipes")).not.toBe(none);
    expect(await grantKey(grantOf(m, "v", [], ["pins", "open"]), "Applets/Recipes")).not.toBe(await grantKey(grantOf(m, "v", [], ["pins"]), "Applets/Recipes"));
    // the key as it was computed before `app` existed
    const allow = [...new Set(m.allow.map((r) => canonical({ path: r.path, verbs: [...r.verbs].sort() })))].sort();
    expect(none).toBe(await sha256Hex(canonical({ v: 3, note: "Applets/Recipes", applet: m.id, vault: "v", allow, opens: [] })));
  });
  it("open goes only to the app's own places", () => {
    for (const ok of ["/", "/v/kitchen", "/v/kitchen/n/01ABC", "/v/kitchen/a/01ABC", "/v/k%40h/n/Recipes%2FSoup"]) expect(APP_HREF.test(ok), ok).toBe(true);
    for (const bad of ["//evil.example", "https://evil.example", "/settings", "/add", "/v/k/n/x?y=1", "/v/k/x/y", "/oauth/callback", "javascript:alert(1)"]) expect(APP_HREF.test(bad), bad).toBe(false);
  });
});
