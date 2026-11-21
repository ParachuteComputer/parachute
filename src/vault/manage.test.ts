// The admin held for managing who reaches a vault (vault/manage.ts): for the applet that asked and no other, for this
// visit, never past its time, and ended at the hub (its access and refresh tokens) every way it is let go.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endAllManage, endManageFor, holdManage, listReach, manageHeld, ManageEndedError } from "./manage";

const rec = { issuer: "https://hub.example", vault: "recipes" };
const pending = { issuer: "https://hub.example", clientId: "c1", revocationEndpoint: "https://hub.example/oauth/revoke", applet: "home:vault" };
let ended: string[] = [];
let answer: Response = new Response("{}");
beforeEach(() => {
  sessionStorage.clear();
  ended = [];
  // the hub, which this app does not control: answered here
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/oauth/revoke")) { ended.push(new URLSearchParams(String(init?.body)).get("token") ?? ""); return new Response("{}"); }
    return answer;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the admin held for managing a vault", () => {
  it("is the asking applet's alone", () => {
    holdManage(pending, { access_token: "a1", refresh_token: "r1", expires_in: 900 } as never, "recipes");
    expect(manageHeld(rec, "home:vault")?.access).toBe("a1");
    expect(manageHeld(rec, "home:other-applet")).toBeNull();
    expect(manageHeld({ ...rec, vault: "letters" }, "home:vault")).toBeNull();
  });
  it("runs out a minute before the hub's end, and is ended at the hub then", () => {
    const now = Date.now();
    holdManage(pending, { access_token: "a1", refresh_token: "r1", expires_in: 900 } as never, "recipes", now);
    expect(manageHeld(rec, "home:vault", now + 839_000)).not.toBeNull();
    expect(manageHeld(rec, "home:vault", now + 841_000)).toBeNull();
    expect(ended.sort()).toEqual(["a1", "r1"]);
    expect(sessionStorage.getItem("parachute.manage")).toBeNull();
  });
  it("is ended, access and refresh, when its applet is let go, and when the page goes", () => {
    holdManage(pending, { access_token: "a1", refresh_token: "r1" } as never, "recipes");
    holdManage({ ...pending, applet: "home:other" }, { access_token: "a2" } as never, "letters");
    endManageFor("home:vault");
    expect(ended.sort()).toEqual(["a1", "r1"]);
    expect(manageHeld({ ...rec, vault: "letters" }, "home:other")?.access).toBe("a2");
    dispatchEvent(new Event("pagehide"));
    expect(ended).toContain("a2");
    expect(sessionStorage.getItem("parachute.manage")).toBeNull();
  });
  it("a second ask for the same vault ends the first", () => {
    holdManage(pending, { access_token: "a1", refresh_token: "r1" } as never, "recipes");
    holdManage(pending, { access_token: "a2", refresh_token: "r2" } as never, "recipes");
    expect(ended.sort()).toEqual(["a1", "r1"]);
    expect(manageHeld(rec, "home:vault")?.access).toBe("a2");
    endAllManage();
  });
  it("a 401 from the hub drops it: the next call asks again", async () => {
    holdManage(pending, { access_token: "a1", refresh_token: "r1" } as never, "recipes");
    answer = new Response("{}", { status: 401 });
    await expect(listReach(rec, "home:vault")).rejects.toBeInstanceOf(ManageEndedError);
    expect(manageHeld(rec, "home:vault")).toBeNull();
    await expect(listReach(rec, "home:vault")).rejects.toBeInstanceOf(ManageEndedError);
  });
});

describe("whether a hub lists who reaches a vault", () => {
  it("a readable 401 says yes; a refusal or an unreadable answer says no; too slow is an error, asked again", async () => {
    const { hubLists } = await import("./manage");
    answer = new Response("{}", { status: 401 });
    expect(await hubLists({ issuer: "https://new.example", vault: "v" })).toBe(true);
    answer = new Response("{}", { status: 405 });
    expect(await hubLists({ issuer: "https://old.example", vault: "v" })).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await hubLists({ issuer: "https://cloud.example", vault: "v" })).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }));
    await expect(hubLists({ issuer: "https://slow.example", vault: "v" })).rejects.toThrow(/in time/);
    // asked again at once, not kept as "no"
    answer = new Response("{}", { status: 401 });
    vi.stubGlobal("fetch", vi.fn(async () => answer));
    expect(await hubLists({ issuer: "https://slow.example", vault: "v" })).toBe(true);
  });
});
