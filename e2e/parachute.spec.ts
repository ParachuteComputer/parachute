// Parachute's own applets (docs/design/PARACHUTE-SOURCE.md), in the real build against a real hub: they run with no card
// and are never read from the vault; a vault's note that copies one (its path, manifest, name and code) is the person's
// own applet and its card asks; an update signed with a release key runs, a forged one doesn't.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { createHash } from "node:crypto";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
const hub = () => hubState();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const captureAt = `/v/${VAULT}/a/${encodeURIComponent("parachute:capture")}`;
const root = join(import.meta.dirname, "..");
const record = JSON.parse(readFileSync(join(root, "applets/capture.json"), "utf8")) as { path: string; extension: string; tags: string[]; fields: Record<string, unknown>; version?: number };
const body = readFileSync(join(root, "applets/capture.tsx"), "utf8");
/** The tests' release key: the web build made for the tests lists it (src/applet/parachuteSource.ts), no other build does. */
const releaseKey = Uint8Array.from(Buffer.from(readFileSync(join(import.meta.dirname, "fixtures/release-test.key"), "utf8").trim(), "hex"));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Serve an index (signed by `key`) and the code beside it, as parachute.computer would. */
async function publish(page: Page, n: number, code: string, key: Uint8Array): Promise<() => number> {
  const content = JSON.stringify({ v: 1, n, applets: { capture: { version: (record.version ?? 1) + 1, sha256: sha(code), record } } });
  const index = finalizeEvent({ kind: 30481, created_at: Math.floor(Date.now() / 1000), tags: [["d", "parachute-applets"]], content }, key);
  let served = 0;
  await page.route("https://parachute.computer/applets/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/index.json")) served++;
    if (u.pathname.endsWith("/index.json")) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(index) });
    if (u.pathname.endsWith(`/${sha(code)}.tsx`)) return route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: code });
    return route.fulfill({ status: 404, body: "" });
  });
  return () => served;
}
const copies: string[] = [];
test.afterAll(async () => { for (const id of copies.splice(0)) await api(hub(), "DELETE", `notes/${id}`).catch(() => {}); });

test("Parachute's own Capture runs with no card, and the hub is never asked for it", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(hub().origin) && /parachute(%3A|:)capture/i.test(r.url())) asked.push(r.url()); });
  await page.goto(captureAt);
  await expect(frame(page).getByRole("textbox", { name: "Write it down" })).toBeVisible();
  await expect(page.getByRole("region", { name: /asking for access/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Capture" })).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("a vault's note that copies Capture exactly (path, manifest, name, code) is an ordinary applet: its card asks", async ({ page }) => {
  // what a vault writer (an AI, a token, the hub) can do: put Parachute's own words in the vault
  const copy = await api(hub(), "POST", "notes", { path: record.path, content: body, tags: record.tags, metadata: record.fields, extension: record.extension });
  copies.push(copy.id);
  await page.goto(`/v/${VAULT}/a/${copy.id}`);
  const card = page.getByRole("region", { name: /asking for access/ });
  await expect(card).toContainText("Inbox/");
  await expect(card).toContainText("not verified");
  await expect(frame(page).getByRole("textbox", { name: "Write it down" })).toHaveCount(0);
});

test("an update signed with the release key runs; one signed by anyone else doesn't", async ({ browser }) => {
  const marked = (who: string) => `import { Page } from "parachute";\nexport default function Capture() { return <Page title="Capture"><p>${who}</p></Page>; }\n`;
  // a forged index (another key), on a device that took nothing yet: the app's own copy runs
  const forged = await browser.newContext({ storageState: "e2e/.signed-in.json", baseURL: test.info().project.use.baseURL });
  const f = await forged.newPage();
  const forgedServed = await publish(f, 1_000_000, marked("Forged update"), generateSecretKey());
  await f.goto("/");
  // the app read the forged index (and refused it) before Capture opens
  await expect.poll(forgedServed).toBeGreaterThan(0);
  await f.waitForTimeout(300);
  await f.goto(captureAt);
  await expect(frame(f).getByRole("textbox", { name: "Write it down" })).toBeVisible();
  await expect(frame(f).getByText("Forged update")).toHaveCount(0);
  await forged.close();
  // the release key's: taken when the app starts, and run from then on, with no card
  const signed = await browser.newContext({ storageState: "e2e/.signed-in.json", baseURL: test.info().project.use.baseURL });
  const s = await signed.newPage();
  await publish(s, 1, marked("Signed update"), releaseKey);
  await s.goto("/");
  await expect.poll(() => s.evaluate(() => localStorage.getItem("parachute.source.v1") !== null)).toBe(true);
  await s.goto(captureAt);
  await expect(frame(s).getByText("Signed update")).toBeVisible();
  await expect(s.getByRole("region", { name: /asking for access/ })).toHaveCount(0);
  await signed.close();
});

test("an update of Parachute's own that imports from a vault is left: the app's own copy runs, nothing of a vault comes in", async ({ browser }) => {
  const importing = `import Room from "component:room";\nimport { Page } from "parachute";\nexport default function Capture() { return <Page title="Capture"><p>Imported update</p><Room /></Page>; }\n`;
  const ctx = await browser.newContext({ storageState: "e2e/.signed-in.json", baseURL: test.info().project.use.baseURL });
  const p = await ctx.newPage();
  const served = await publish(p, 2, importing, releaseKey);
  await p.goto("/");
  await expect.poll(served).toBeGreaterThan(0);
  await p.waitForTimeout(300);
  await p.goto(captureAt);
  await expect(frame(p).getByRole("textbox", { name: "Write it down" })).toBeVisible();
  await expect(frame(p).getByText("Imported update")).toHaveCount(0);
  await ctx.close();
});

test("a hub that answers a note's read with another id (one of Parachute's own) runs nothing", async ({ page }) => {
  const copy = await api(hub(), "POST", "notes", { path: "Applets/Not journal", content: body, tags: record.tags, metadata: { ...record.fields, applet: { ...(record.fields.applet as object), id: "not-journal" } }, extension: record.extension });
  copies.push(copy.id);
  // the hub (or something between) says the note asked for is parachute:journal
  await page.route((u) => u.href.startsWith(hub().origin) && u.href.includes(copy.id), async (r) => {
    const res = await r.fetch();
    const text = await res.text();
    await r.fulfill({ response: res, body: text.split(copy.id).join("parachute:journal") });
  });
  await page.goto(`/v/${VAULT}/a/${copy.id}`);
  await expect(page.getByRole("alert")).toContainText("the hub answered with another note than the one asked for");
  await expect(page.getByRole("region", { name: /asking for access/ })).toHaveCount(0);
});
