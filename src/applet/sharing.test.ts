// Sharing a vault with people, through the kit (docs/design/SHARING.md; modules/vaults.ts people/invite/takeBack/end):
// a link that lets someone in, and ending someone's access, are the person's to say on the app's own sheet, never an
// applet's; the End sheet names the person as the hub has them, whatever the applet says; and the hub's refusals of a
// signed request reach the applet as words.
import { describe, expect, it } from "vitest";
import { createVaultsModule, type PeopleRow, type VaultsDeps } from "./modules/vaults";
import { createRouter } from "./router";

const BO = "b".repeat(64);
function shell(opts: { answer?: "yes" | "no" | "untapped"; people?: PeopleRow; refuse?: unknown } = {}) {
  const sheets: { title: string; body: string }[] = [];
  const done: string[] = [];
  const deps: VaultsDeps = {
    list: () => [{ key: "recipes", name: "recipes", host: "hub.example", mine: true, home: false, level: "write", connector: "", view: null, reach: "network" }],
    door: async () => "records", applets: async () => [], request: async () => [], watch: () => () => {},
    access: async () => ({ level: "write", mine: true, home: false, hub: "https://hub.example", connector: "", applets: [] }),
    revoke: async () => {}, readOnly: async () => {}, emit: () => {},
    confirm: async (q) => { sheets.push(q); return opts.answer ?? "yes"; },
    people: async () => opts.people ?? { people: [{ key: BO, name: "Bo", role: "member" }], invites: [] },
    invite: async (_v, name) => { if (opts.refuse) throw opts.refuse; done.push(`invite ${name}`); return { id: "i".repeat(64), url: "https://hub.example/invite#x", expires_at: "2026-11-28T00:00:00.000Z" }; },
    takeBack: async () => { done.push("take back"); return true; },
    end: async (_v, key) => { done.push(`end ${key.slice(0, 4)}`); return true; },
  };
  const router = createRouter([createVaultsModule(["vaults", "sharing"], deps)]);
  const call = (method: string, params: unknown) => router.call("vaults", method, params, {}, { charge() {}, closed: () => false });
  return { call, sheets, done };
}

describe("sharing a vault, from an applet", () => {
  it("a link is made only after the person's yes on the app's own sheet, which says who it lets in and from whom", async () => {
    const s = shell();
    await s.call("invite", { vault: "recipes", name: "Bo", from: "Aaron" });
    expect(s.sheets[0].title).toBe("Invite Bo to recipes?");
    expect(s.sheets[0].body).toContain("can read and change everything in recipes");
    expect(s.sheets[0].body).toContain("It says it is from Aaron.");
    expect(s.done).toEqual(["invite Bo"]);
  });
  it("no yes, no link: the person's No, or no live tap in the applet", async () => {
    for (const answer of ["no", "untapped"] as const) {
      const s = shell({ answer });
      await expect(s.call("invite", { vault: "recipes", name: "Bo" })).rejects.toThrow(answer === "no" ? /not_confirmed/ : /needs_tap/);
      expect(s.done).toEqual([]);
    }
  });
  it("End names the person as the hub has them, with their key, whatever name the applet gives", async () => {
    const s = shell();
    await s.call("end", { vault: "recipes", key: BO, name: "an old test key" });
    expect(s.sheets[0].title).toBe("End Bo's access to recipes?");
    expect(s.sheets[0].body).toContain("key bbbbbbbb…");
    expect(s.sheets[0].body).not.toContain("an old test key");
    expect(s.done).toEqual(["end bbbb"]);
  });
  it("End without a yes ends no one; nor for a key that isn't in the vault", async () => {
    const no = shell({ answer: "no" });
    await expect(no.call("end", { vault: "recipes", key: BO })).rejects.toThrow(/not_confirmed/);
    expect(no.done).toEqual([]);
    const stranger = shell();
    await expect(stranger.call("end", { vault: "recipes", key: "c".repeat(64) })).rejects.toThrow(/no one with that key/);
    expect(stranger.sheets).toEqual([]);
  });
  it("names the hub won't take never reach a sheet: over 40 characters, a control, or You", async () => {
    for (const name of ["x".repeat(41), "Bo\u0007", "Bo\u202e", "Bo\u200b", "you", " "]) {
      const s = shell();
      await expect(s.call("invite", { vault: "recipes", name })).rejects.toThrow();
      expect(s.sheets).toEqual([]);
    }
  });
  it("the hub's refusal of a signed request reaches the applet in its words, not as [object Object]", async () => {
    const s = shell({ refuse: { code: "not_owner", message: "You cannot invite people to vault \"recipes\"." } });
    await expect(s.call("invite", { vault: "recipes", name: "Bo" })).rejects.toThrow(/You cannot invite people/);
  });
});
