// A hostile frame. The frame's document in the app's own frame (the iframe the shell listens to) is replaced by one
// that tries everything: the shell's storage, its document, its address, every call in the bridge and calls that
// aren't in it, and a move to an applet. It can read no token and grant nothing. (The document is swapped from the
// test, in the shell's realm: the app has no hook for it. Playwright's evaluate and its reads of a frame count as a tap,
// and a tap lasts five seconds, so the hostile document waits six before it acts, and the test doesn't look until it's done.)
import { expect, test, type Page } from "@playwright/test";
import { VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const hostileDoc = (go = "") => String.raw`<!doctype html><pre id="report"></pre><p id="done"></p><script>
setTimeout(function () {
var r = {}, n = 0, pending = {};
function probe(name, f) { try { r[name] = "read: " + String(f()); } catch (e) { r[name] = "refused: " + e.name; } }
probe("own storage", function () { return localStorage.getItem("parachute.vaults.v1"); });
probe("shell storage", function () { return parent.localStorage.getItem("parachute.vaults.v1"); });
probe("shell session storage", function () { return parent.sessionStorage.length; });
probe("shell document", function () { return parent.document.body.innerHTML.length; });
probe("shell address", function () { return parent.location.href; });
probe("shell cookies", function () { return document.cookie; });
probe("tauri", function () { return typeof parent.__TAURI_INTERNALS__; });
probe("move the shell", function () { top.location.href = "https://evil.example/"; return "moved"; });
addEventListener("message", function (e) { if (e.data && e.data.id && pending[e.data.id]) { pending[e.data.id](e.data); delete pending[e.data.id]; } });
function ask(method, params) { return new Promise(function (res) { var id = "h" + (++n); pending[id] = res; parent.postMessage({ pf: 1, id: id, method: method, params: params }, "*"); setTimeout(function () { if (pending[id]) { delete pending[id]; res({ timeout: true }); } }, 5000); }); }
var calls = [
  ["vaults.list", {}], ["vault.query", { vault: "VAULT", query: { limit: 50, includeContent: true, includeMetadata: true } }],
  ["vault.note", { vault: "VAULT", id: ".parachute/notes/settings" }], ["vault.roles", { vault: "VAULT" }],
  ["applets.list", { vault: "VAULT", fresh: true }], ["defaults.get", { vault: "VAULT" }],
  ["clipboard.write", { text: "x" }], ["link.out", { url: "https://evil.example/?x=1" }],
  ["grants.grant", { vault: "VAULT" }], ["applets.allow", {}], ["vault.token", { vault: "VAULT" }], ["storage.get", { key: "parachute.vaults.v1" }],
  ["nav.go", { to: "/oauth/callback?code=x&state=y" }], ["nav.go", { to: "https://evil.example/" }],
  ["defaults.set", { vault: "VAULT", type: "recipe", choice: "not-an-applet" }]
];
Promise.all(calls.map(function (c) { return ask(c[0], c[1]).then(function (a) { return [c[0], a]; }); })).then(function (answers) {
  r.answers = answers;
  document.getElementById("report").textContent = JSON.stringify(r);
  document.getElementById("done").textContent = "done";
  if ("GO") ask("nav.go", { to: "GO" });
});
}, 6000);
</script>`.replaceAll("VAULT", VAULT).replaceAll("GO", go);

async function hostile(page: Page, go?: string) {
  await page.goto(`/v/${VAULT}`);
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
  await page.evaluate((doc) => { (document.querySelector("iframe.app-frame") as HTMLIFrameElement).srcdoc = doc; }, hostileDoc(go));
  // no polling while it acts: Playwright's reads of the frame count as taps too
  await page.waitForTimeout(7_500);
  // one that moves the person to an applet is gone by now: the frame isn't kept beside a shell screen
  if (go) return null;
  await expect(ui(page).locator("#done")).toHaveText("done", { timeout: 5_000 });
  return JSON.parse((await ui(page).locator("#report").textContent())!) as Record<string, string> & { answers: [string, { result?: unknown; error?: string; timeout?: boolean }][] };
}
const stored = (page: Page) => page.evaluate(() => ({ vaults: localStorage.getItem("parachute.vaults.v1") ?? "", grants: localStorage.getItem("parachute.applets.grants.v1") }));

test("a hostile frame reads no token and reaches nothing of the shell's", async ({ page }) => {
  await page.goto("/");
  const before = await stored(page);
  // the control: from the shell's own realm the same read finds the sign-in
  const rec = JSON.parse(before.vaults)[0];
  expect(rec.accessToken).toBeTruthy();
  const r = (await hostile(page))!;
  for (const k of ["own storage", "shell storage", "shell session storage", "shell document", "shell address", "tauri"]) expect(r[k], k).toMatch(/^refused: /);
  expect(r["move the shell"]).not.toBe("read: moved");
  expect(new URL(page.url()).pathname).toBe(`/v/${VAULT}`);
  // it may read the vault (that is what a frame is for), and it is told of the vault, but never how to sign in to it
  const answers = Object.fromEntries(r.answers);
  expect(answers["vault.query"].result).toBeTruthy();
  expect(answers["vaults.list"].result).toEqual([expect.objectContaining({ key: VAULT })]);
  const all = JSON.stringify(r);
  for (const secret of [rec.accessToken, rec.refreshToken, rec.clientId].filter(Boolean)) expect(all).not.toContain(secret);
  for (const m of ["grants.grant", "applets.allow", "vault.token", "storage.get"]) expect(answers[m].error, m).toBe("unknown_method");
  expect(r.answers.filter(([m]) => m === "nav.go").map(([, a]) => a.error)).toEqual(["not_allowed", "not_allowed"]);
  expect(answers["clipboard.write"].result).toBe(false);
  expect(answers["link.out"].result).toBe(false);
  // a choice that names no applet of the vault isn't kept
  expect(answers["defaults.set"].error).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem("parachute.openwith.v1"))).toBeNull();
  expect((await stored(page)).grants).toBe(before.grants);
});

test("a hostile frame can't approve an applet, or start one the person allowed", async ({ page }) => {
  await page.goto(`/v/${VAULT}`);
  const chip = ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ });
  const href = (await chip.getAttribute("href"))!;
  const grantsBefore = (await stored(page)).grants;
  // never allowed: it sends the person to the applet; the shell shows its card, and nothing it can do presses Allow
  await hostile(page, href);
  await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  expect((await stored(page)).grants).toBe(grantsBefore);
  // allowed by the person's tap: a move the frame makes without one leaves it stopped
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await hostile(page, href);
  await expect(page.getByRole("button", { name: /^Open Recipe box$/ })).toBeVisible();
  await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
});

test("the frame is there only while it is shown: never beside a shell screen, never at a sign-in's return", async ({ page }) => {
  await page.goto(`/v/${VAULT}`);
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Vaults" })).toBeVisible();
  await expect(page.locator("iframe.app-frame")).toHaveCount(0);
  // a return from the hub carries its code in the address: no frame is made there to read it
  await page.goto("/oauth/callback?code=CODE-FROM-HUB&state=nope");
  await expect(page.getByRole("alert").or(page.getByRole("status")).first()).toBeVisible();
  await expect(page.locator("iframe.app-frame")).toHaveCount(0);
});
