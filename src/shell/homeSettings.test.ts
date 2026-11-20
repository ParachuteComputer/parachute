// The settings note is the person's and their agent's to write: read strictly, and a bad place never costs the rest.
import { describe, expect, it } from "vitest";
import { MAX_PLACES, placeFor, settingsFrom, vaultFor } from "./homeSettings";
import type { VaultRecord } from "../vault/store";

const rec = (key: string, vault: string, issuer: string, addedAt = "2026-11-01"): VaultRecord =>
  ({ key, vault, issuer, tokenEndpoint: `${issuer}/oauth/token`, clientId: "c", accessToken: "t", scope: "s", addedAt });

describe("the settings note", () => {
  it("keeps the places that parse, in order, once each; drops the rest", () => {
    const s = settingsFrom({ parachute: {
      bar: [{ vault: "kitchen", applet: "Applets/Recipes" }, { vault: "kitchen", applet: "Applets/Recipes" }, { vault: "kitchen" }, { vault: "kitchen", applet: "x", extra: 1 },
        "Applets/Recipes", { vault: "garden", hub: "https://hub.example", applet: "01ABC" }, { vault: "k", applet: "a\u0000b" }],
      start: { vault: "kitchen", applet: "Applets/Home" },
    } });
    expect(s.bar).toEqual([{ vault: "kitchen", applet: "Applets/Recipes" }, { vault: "garden", hub: "https://hub.example", applet: "01ABC" }]);
    expect(s.start).toEqual({ vault: "kitchen", applet: "Applets/Home" });
  });
  it("no note, other metadata, or a bad start: an empty bar and no home", () => {
    for (const m of [null, {}, { parachute: "x" }, { parachute: { bar: "x", start: "Applets/Home" } }, { parachute: { start: { vault: "k" } } }]) expect(settingsFrom(m)).toEqual({ bar: [], start: null, hubs: [], services: [], bundle: null });
  });
  it("a followed bundle's record is found in either folder: the same id under Parachute/Apps and Parachute/Bundles", async () => {
    const { sameRecord } = await import("./homeSettings");
    expect(sameRecord("Parachute/Bundles/techne.md", "Parachute/Apps/techne")).toBe(true);
    expect(sameRecord("Parachute/Apps/techne", "Parachute/Bundles/techne")).toBe(true);
    expect(sameRecord("Parachute/Bundles/techne", "Parachute/Bundles/techne")).toBe(true);
    expect(sameRecord("Parachute/Bundles/other", "Parachute/Apps/techne")).toBe(false);
    expect(sameRecord("Elsewhere/techne", "Parachute/Apps/techne")).toBe(false);
  });
  it("the choice of bundle: `bundle`, else its older name `app` (one release), never both read as two", () => {
    expect(settingsFrom({ parachute: { bundle: "uni" } }).bundle).toBe("uni");
    expect(settingsFrom({ parachute: { app: "uni" } }).bundle).toBe("uni");
    expect(settingsFrom({ parachute: { bundle: "lab", app: "uni" } }).bundle).toBe("lab");
    expect(settingsFrom({ parachute: { app: "Not An Id" } }).bundle).toBeNull();
  });
  it("reads every place it can (the bar shows the first ones it finds), up to a bound", () => {
    const bar = Array.from({ length: 400 }, (_, i) => ({ vault: "k", applet: `A/${i}` }));
    expect(settingsFrom({ parachute: { bar } }).bar).toHaveLength(200);
    expect(MAX_PLACES).toBe(12);
  });
});

describe("which vault a place names", () => {
  const home = rec("kitchen", "kitchen", "https://home.example");
  const other = rec("kitchen@other.example", "kitchen", "https://other.example");
  const list = [home, other];
  it("by its hub when it names one, and none when this device has no vault of that name there", () => {
    expect(vaultFor({ vault: "kitchen", hub: "https://other.example/" }, list, home)?.key).toBe("kitchen@other.example");
    expect(vaultFor({ vault: "kitchen", hub: "https://third.example" }, list, home)).toBeNull();
  });
  it("else the one on the home vault's hub", () => {
    expect(vaultFor({ vault: "kitchen" }, [other, home], home)?.key).toBe("kitchen");
  });
  it("names a vault by its hub only when another hub holds that name too", () => {
    expect(placeFor(home, "Applets/Recipes", [home])).toEqual({ vault: "kitchen", applet: "Applets/Recipes" });
    expect(placeFor(other, "Applets/Recipes", list)).toEqual({ vault: "kitchen", hub: "https://other.example", applet: "Applets/Recipes" });
  });
});

describe("the servers the note lists", () => {
  it("keeps the ones that parse, made plain, and drops the rest", () => {
    const s = settingsFrom({ parachute: { services: [
      { name: "Rooms", kind: "nostr-relay", url: "wss://Relay.Example/" },
      { name: "Mail", kind: "http", url: "https://mail.example:8452/mail/" },
      { name: "Bad", kind: "http", url: "http://mail.example/mail/" },
      { name: "Odd", kind: "smtp", url: "https://x.example/" },
      { kind: "http", url: "https://x.example/" },
    ] } });
    expect(s.services).toEqual([{ name: "Rooms", kind: "nostr-relay", url: "wss://relay.example" }, { name: "Mail", kind: "http", url: "https://mail.example:8452/mail/" }]);
  });
});
