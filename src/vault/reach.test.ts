// What the app may hold of a vault, and when it gives write back (docs/design/SCOPES.md): the rule is the point here, so
// it is checked as a rule, with the app's own modules as they are. Only the hub is faked, at the network: its vault
// (two applets), its OAuth discovery and registration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appletLevel, appletsNeedingWrite, neededLevel, narrowIfWider } from "./reach";
import { noteOwnWrite, forgetOwnWrite } from "./writeAsk";
import { saveVault, type VaultRecord } from "./store";
import { HOME_KEY, setWhose } from "./whose";
import { dropClient } from "./client";
import { deviceGrants, subjectOf } from "../applet/grants";
import { appletsNow, forgetApplets, refreshApplets } from "../applet/useApplets";

const HUB = "https://hub.example";
const manifest = (id: string, verbs: string[]) => ({ contract: 2, id, name: id, access: [{ vault: "here", allow: [{ path: "Journal/", verbs }] }] });
const APPLETS = [
  { id: "n-journal", path: "Applets/Journal", extension: "html", tags: ["applet"], content: "<!doctype html><p>journal</p>", metadata: { applet: manifest("journal", ["read", "create"]) } },
  { id: "n-viewer", path: "Applets/Viewer", extension: "html", tags: ["applet"], content: "<!doctype html><p>viewer</p>", metadata: { applet: manifest("viewer", ["read"]) } },
];
const authorizes: string[] = [];

beforeEach(() => {
  localStorage.clear(); authorizes.length = 0;
  for (const s of deviceGrants().subjects()) deviceGrants().revoke(s);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    if (u.pathname === "/.well-known/parachute-account") return new Response("no", { status: 404 });
    if (u.pathname === "/.well-known/oauth-authorization-server") return Response.json({ issuer: HUB, authorization_endpoint: `${HUB}/oauth/authorize`, token_endpoint: `${HUB}/oauth/token`, registration_endpoint: `${HUB}/oauth/register`, code_challenge_methods_supported: ["S256"] });
    if (u.pathname === "/oauth/register") return Response.json({ client_id: "c2" }, { status: 201 });
    if (u.pathname === "/vault/letters/api/records") return new Response("no record door", { status: 404 });
    if (u.pathname === "/vault/letters/api/notes" && u.searchParams.get("tag") === "applet") return Response.json(APPLETS);
    return new Response("not found", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); dropClient("letters"); forgetApplets("letters"); });

const hold = (scope: string, vault = "letters"): VaultRecord => {
  // letters isn't the home: kitchen is (the home stays at write, below)
  localStorage.setItem(HOME_KEY, "kitchen");
  setWhose({ issuer: HUB, vault: "letters" }, "mine"); setWhose({ issuer: HUB, vault: "kitchen" }, "mine");
  if (vault !== "kitchen") saveVault({ issuer: HUB, vault: "kitchen", tokenEndpoint: `${HUB}/oauth/token`, clientId: "c", accessToken: "t0", refreshToken: "r0", scope: "vault:kitchen:read vault:kitchen:write", addedAt: "2026-11-17T00:00:00Z" });
  return saveVault({ issuer: HUB, vault, tokenEndpoint: `${HUB}/oauth/token`, clientId: "c", accessToken: "t", refreshToken: "r", scope, addedAt: "2026-11-18T00:00:00Z" });
};
/** Allow an applet as its card does: under the keys the app read for it now. */
function allow(r: VaultRecord, id: string) {
  const read = appletsNow(r.key);
  const e = read?.state === "ok" ? read.found.entries.find((x) => x.manifest.id === id) : undefined;
  if (!e) throw new Error(`no applet ${id}`);
  deviceGrants().grant(subjectOf(r.key, e.noteId), e.keys.scope, e.keys.html);
  return subjectOf(r.key, e.noteId);
}

describe("what an applet needs of its vault at the hub", () => {
  it("write when its manifest adds or changes notes anywhere; read when it only reads", () => {
    expect(appletLevel({ allow: [{ path: "Journal/", verbs: ["read"] }] })).toBe("read");
    expect(appletLevel({ allow: [{ path: "Journal/", verbs: ["read"] }, { path: "Inbox/", verbs: ["create"] }] })).toBe("write");
    expect(appletLevel({ allow: [{ path: "Journal/", verbs: ["read", "update"] }] })).toBe("write");
    expect(appletLevel({ allow: [] })).toBe("read");
  });
});

describe("what the app needs of a vault now", () => {
  it("the home: write, with nothing allowed there, so it is never given back (Parachute's own applets write there)", async () => {
    const home = hold("vault:kitchen:read vault:kitchen:write", "kitchen");
    expect(neededLevel(home)).toBe("write");
    expect(await narrowIfWider(home.key, "/")).toBeNull();
  });
  it("read with nothing allowed; write while an allowed applet writes there, or the person's own change", async () => {
    const r = hold("vault:letters:read vault:letters:write");
    expect(await refreshApplets(r)).toBe(true);
    expect(neededLevel(r)).toBe("read");
    const journal = allow(r, "journal");
    expect(appletsNeedingWrite(r)).toEqual(["journal"]);
    expect(neededLevel(r)).toBe("write");
    deviceGrants().revoke(journal);
    expect(neededLevel(r)).toBe("read");
    // a read-only applet allowed there needs no write
    allow(r, "viewer");
    expect(neededLevel(r)).toBe("read");
    noteOwnWrite(r);
    expect(neededLevel(r)).toBe("write");
    forgetOwnWrite(r);
    expect(neededLevel(r)).toBe("read");
  });
  it("an applet allowed but its vault's applets not read this session: unknown, so nothing is narrowed on a guess", () => {
    const r = hold("vault:letters:read vault:letters:write");
    deviceGrants().grant(subjectOf(r.key, "n-journal"), "k", "h");
    expect(neededLevel(r)).toBeNull();
  });
  it("an allowed applet whose asks changed since (its grant no longer counts) needs nothing", async () => {
    const r = hold("vault:letters:read vault:letters:write");
    await refreshApplets(r);
    deviceGrants().grant(subjectOf(r.key, "n-journal"), "an older grant key", "h");
    expect(neededLevel(r)).toBe("read");
  });
});

describe("giving write back", () => {
  it("asks the hub for read alone when write is held and nothing needs it; asks nothing otherwise", async () => {
    const wide = hold("vault:letters:read vault:letters:write");
    await refreshApplets(wide);
    const url = new URL((await narrowIfWider(wide.key, "/settings"))!);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("vault:letters:read");
    expect(url.searchParams.get("vault")).toBe("letters");
    localStorage.removeItem("parachute.oauth.pending.v1");
    // Journal allowed: write is needed, nothing is given back
    allow(wide, "journal");
    expect(await narrowIfWider(wide.key, "/settings")).toBeNull();
    // the person's own write keeps it too
    for (const s of deviceGrants().subjects()) deviceGrants().revoke(s);
    noteOwnWrite(wide);
    expect(await narrowIfWider(wide.key, "/settings")).toBeNull();
    forgetOwnWrite(wide);
    // already read only: nothing to give back
    hold("vault:letters:read");
    expect(await narrowIfWider(wide.key, "/settings")).toBeNull();
  });
});
