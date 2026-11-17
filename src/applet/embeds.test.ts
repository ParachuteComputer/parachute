import { describe, expect, it } from "vitest";
import { embedKey, embedSubject, embedSubjectParts, embedTokens, grantInVault, isEmbedSubject, parseEmbeds } from "./embeds";
import { subjectOf } from "./grants";
import { grantKey, type Grant } from "./grant";
import { grow } from "../views/AppletScreen";
import { failureOf } from "../views/Embeds";
import { VaultAuthError, VaultPermissionError, VaultUnreachableError } from "@openparachute/surface-client";
import { DEFAULT_THEME } from "../theme/theme";

describe("a page's embeds", () => {
  it("are at most 8, each name once; anything that isn't an embed is dropped", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `e${i}`, record: `C/${i}` }));
    expect(parseEmbeds(many)).toHaveLength(8);
    expect(parseEmbeds([{ name: "a", record: "x" }, { name: "a", record: "y" }, { name: "B", record: "z" }, { name: "c", record: "" }, { name: "d", record: "w", extra: 1 }, "e"]))
      .toEqual([{ name: "a", record: "x", props: {} }]);
    expect(parseEmbeds(undefined)).toEqual([]);
  });
  it("each has a grant subject no applet's can be, whatever the vault is called", () => {
    const s = embedSubject("embed", "01HOME", "events", "techne");
    expect(isEmbedSubject(s)).toBe(true);
    expect(s.startsWith(subjectOf("embed", ""))).toBe(false);
    expect(embedSubjectParts(s)).toEqual({ hostVault: "embed", hostNote: "01HOME", name: "events", from: "techne" });
    // signing out of the page's vault, or of the component's, ends it; another vault's sign-out doesn't
    expect(grantInVault(s, subjectOf("embed", ""), "embed")).toBe(true);
    expect(grantInVault(s, subjectOf("techne", ""), "techne")).toBe(true);
    expect(grantInVault(s, subjectOf("kitchen", ""), "kitchen")).toBe(false);
  });
  it("a grant's key changes with what the component is, its rules and its props", async () => {
    const base = { hub: "https://t.example", vault: "techne", record: "01A", allow: [{ path: "Events/", verbs: ["read" as const] }], props: { days: 7 } };
    const k = await embedKey(base);
    expect(await embedKey({ ...base })).toBe(k);
    for (const changed of [{ record: "01B" }, { hub: "https://u.example" }, { allow: [{ path: "Events/", verbs: ["read" as const, "update" as const] }] }, { props: { days: 8 } }])
      expect(await embedKey({ ...base, ...changed }), JSON.stringify(changed)).not.toBe(k);
  });
  it("an embed gets the colours as #rrggbb, the density's values and the app's own fonts: no free text crosses", () => {
    const t = embedTokens({ bg: "#ABC", surface: "rgb(1 2 3)", text: "#11223344", serif: "Secret words, serif", scheme: "light", density: "roomy", pad: "999px" });
    expect(t.bg).toBe("#aabbcc");
    expect(t.surface).toBe(DEFAULT_THEME.colors.surface);
    expect(t.text).toBe("#112233");
    expect(t.serif).toBe(DEFAULT_THEME.fonts.serif);
    expect(t.pad).toBe("20px");
  });
});

describe("a host's grant", () => {
  const g: Grant = { applet: { id: "home", name: "Home" }, vault: "kitchen", allow: [{ path: "Recipes/", verbs: ["read"] }], opens: [], app: [] };
  it("is keyed as before when its page shows nothing from someone else's vaults", async () => {
    expect(await grantKey({ ...g, embedsFrom: [] }, "Applets/Home")).toBe(await grantKey(g, "Applets/Home"));
  });
  it("asks again when its page first shows something from someone else's vault", async () => {
    expect(await grantKey({ ...g, embedsFrom: ["techne at t.example"] }, "Applets/Home")).not.toBe(await grantKey(g, "Applets/Home"));
  });
});

describe("a page with embeds", () => {
  it("grows to its content, and is held where it is when it grows by the same step three times (a layout measured from the screen)", () => {
    let h = { h: 0, steps: [] as number[] };
    h = grow(h, 700); h = grow(h, 720); h = grow(h, 740);
    expect(h.h).toBe(740);
    h = grow(h, 760);
    expect(h.h).toBe(740);
    expect(grow(h, 300).h).toBe(300);
    expect(grow({ h: 0, steps: [] }, 1e9).h).toBe(20_000);
  });
  it("a 401 is a refused sign-in; a 403 is the vault's plain answer; no answer is a hub out of reach", () => {
    expect(failureOf(new VaultAuthError("x", 401))).toBe("refused");
    expect(failureOf(new VaultPermissionError("x"))).toBe("other");
    expect(failureOf(new VaultUnreachableError("x", 0))).toBe("offline");
    expect(failureOf(new TypeError("Failed to fetch"))).toBe("offline");
  });
});
