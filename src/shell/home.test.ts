import { beforeEach, expect, it } from "vitest";
import { holdHome, homeVault, HOME_KEY } from "./frameSource";
import { saveVault, type VaultRecord } from "../vault/store";
import { forgetWhoseCache, setWhose } from "../vault/whose";

beforeEach(() => { localStorage.clear(); forgetWhoseCache(); });
const rec = (issuer: string, vault: string, addedAt: string): Omit<VaultRecord, "key"> => ({ issuer, vault, addedAt, tokenEndpoint: `${issuer}/oauth/token`, clientId: "c", accessToken: "t", scope: "" });

it("signing in again to a Parachute (new records of its vaults) doesn't move the home to another one", () => {
  // two of the person's own Parachutes, no home chosen: the default is the first signed in to
  for (const r of [saveVault(rec("https://a.example", "notes", "2026-01-01T00:00:00Z")), saveVault(rec("https://b.example", "work", "2026-02-01T00:00:00Z"))]) setWhose(r, "mine");
  expect(homeVault()?.vault).toBe("notes");
  // what a sign-in does before it keeps its first vault, then the new record of `notes`
  holdHome();
  saveVault(rec("https://a.example", "notes", "2026-03-01T00:00:00Z"));
  expect(homeVault()?.vault).toBe("notes");
  expect(localStorage.getItem(HOME_KEY)).toBe("notes");
});

it("a home the person chose stays chosen", () => {
  for (const r of [saveVault(rec("https://a.example", "notes", "2026-01-01T00:00:00Z")), saveVault(rec("https://a.example", "work", "2026-01-01T00:00:00Z"))]) setWhose(r, "mine");
  localStorage.setItem(HOME_KEY, "work");
  holdHome();
  expect(localStorage.getItem(HOME_KEY)).toBe("work");
});
