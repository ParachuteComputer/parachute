// The starter home applet, written the way a chat AI with the Parachute MCP writes it: one `create-note` call with the
// arguments in docs/WRITE-AN-APPLET.md, and the settings note's `start`. The app opens on it after the person's Allow.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, record, VAULT } from "./hub";
import { ui } from "./helpers";

const guide = readFileSync(new URL("../docs/WRITE-AN-APPLET.md", import.meta.url), "utf8");
const section = guide.slice(guide.indexOf("## A home applet"), guide.indexOf("## What the person sees"));
const ARGS = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)![1]) as { path: string; body: string } & Record<string, unknown>;
const LAID_OUT = section.match(/```tsx\n([\s\S]*?)```/)![1];
const applet = (page: Page) => page.frameLocator("iframe.applet-frame");

test.use({ storageState: "e2e/.signed-in.json" });

async function settings(parachute: Record<string, unknown>) {
  // one settings note: a sign-in in an earlier test may have left one (it lists the person's Parachutes)
  for (const n of await api(hubState(), "GET", "notes?tag=parachute-settings")) await api(hubState(), "DELETE", `notes/${n.id}`);
  return api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute } });
}
async function start(page: Page) { await page.goto("about:blank"); await page.goto("/"); }

test("the guide's home applet is the code it lays out", () => {
  expect(ARGS.body).toBe(LAID_OUT);
});

test("a home applet written only by create-note opens on start after Allow: the newest notes across vaults, and the pins", async ({ page }) => {
  const home = await record(hubState(), "create", ARGS);
  // the newest notes, one in each of two vaults
  const fresh = [await api(hubState(), "POST", "notes", { path: "Fresh in the kitchen", content: "x" }), await api({ ...hubState(), token: mintToken("vault:letters:write") }, "POST", "notes", { path: "Fresh in letters", content: "x" }, "letters")];
  const s = await settings({ start: { vault: VAULT, applet: "Applets/Home" }, bar: [{ vault: VAULT, applet: "Applets/Recipes" }] });
  try {
    await start(page);
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("See the titles of the newest notes in every vault on this device");
    await expect(card).toContainText("See what is on your bar");
    await expect(card).toContainText("Take you to a note or an applet when you tap, and see which note links lead to a note");
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow" }).click();
    const lately = applet(page).getByRole("region", { name: "Lately" });
    await expect(lately.getByRole("button", { name: /^Fresh in the kitchen kitchen/ })).toBeVisible();
    await expect(lately.getByRole("button", { name: /^Fresh in letters letters/ })).toBeVisible();
    // the app's own notes and applets' code are not "what changed lately"
    await expect(lately.getByRole("button", { name: /Settings|Recipes\b|Cook mode/ })).toHaveCount(0);
    await expect(applet(page).getByRole("region", { name: "Pinned" }).getByRole("button", { name: /Recipe box/ })).toBeVisible();
    // a tap on a note takes the person there
    await lately.getByRole("button", { name: /^Fresh in the kitchen kitchen/ }).click();
    await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/n/`));
    await expect(ui(page).locator("header").getByRole("heading", { name: "Fresh in the kitchen" })).toBeVisible();
    // Back returns to Home, running: it is the home chosen on this device (Allow at its start)
    await ui(page).getByRole("button", { name: "Back" }).click();
    await expect(applet(page).getByRole("region", { name: "Lately" }).getByRole("button", { name: /^Fresh in the kitchen kitchen/ })).toBeVisible();
    // and a restart opens it by itself
    await start(page);
    await expect(applet(page).getByRole("region", { name: "Lately" }).getByRole("button", { name: /^Fresh in the kitchen kitchen/ })).toBeVisible();
    // a pin takes the person to that applet
    await applet(page).getByRole("region", { name: "Pinned" }).getByRole("button", { name: /Recipe box/ }).click();
    await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`));
    await expect(page.getByRole("heading", { level: 1, name: /Recipe box/ })).toBeVisible();
  } finally {
    await api(hubState(), "DELETE", `notes/${home.id}`);
    await api(hubState(), "DELETE", `notes/${s.id}`);
    for (const [n, v] of [[fresh[0], VAULT], [fresh[1], "letters"]] as const) await api({ ...hubState(), token: v === VAULT ? hubState().token : mintToken(`vault:${v}:write`) }, "DELETE", `notes/${n.id}`, undefined, v).catch(() => {});
  }
});

test("hostile: app.open goes nowhere without a tap, and an applet that didn't ask for app gets nothing", async ({ page }) => {
  const home = await record(hubState(), "create", ARGS);
  const s = await settings({ start: { vault: VAULT, applet: "Applets/Home" } });
  try {
    await start(page);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(applet(page).getByRole("region", { name: "Lately" })).toBeVisible();
    const here = page.url();
    const went = await applet(page).locator("body").evaluate(() => (window as unknown as { parachute: { app: { open(h: string): Promise<boolean> } } }).parachute.app.open("/v/kitchen"));
    expect(went).toBe(false);
    expect(page.url()).toBe(here);
    // Recipe box asks nothing of the app
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const said = await applet(page).locator("body").evaluate(() => (window as unknown as { parachute: { app: { recent(): Promise<unknown> } } }).parachute.app.recent().then(() => "answered", (e: { code?: string }) => e.code));
    expect(said).toBe("not_granted");
  } finally {
    await api(hubState(), "DELETE", `notes/${home.id}`);
    await api(hubState(), "DELETE", `notes/${s.id}`);
  }
});

test("hostile: a tap that has worn off moves nothing, and a home the note no longer names waits for a tap", async ({ page }) => {
  const home = await record(hubState(), "create", ARGS);
  const s = await settings({ start: { vault: VAULT, applet: "Applets/Home" } });
  try {
    await start(page);
    await page.getByRole("button", { name: "Allow" }).click();
    const lately = applet(page).getByRole("region", { name: "Lately" });
    await expect(lately).toBeVisible();
    // a real tap inside the applet (focus stays in its frame), then the applet's own timer calls open once the tap's
    // activation has worn off (Playwright's evaluate carries a gesture of its own, so the call can't come from it)
    await applet(page).getByRole("heading").first().click();
    const here = page.url();
    await applet(page).locator("body").evaluate(() => {
      const kit = (window as unknown as { parachute: { app: { open(h: string): Promise<boolean> } } }).parachute;
      setTimeout(() => { kit.app.open("/v/kitchen").then((r) => { document.body.dataset.went = String(r); }, (e: { code?: string }) => { document.body.dataset.went = `error ${e.code}`; }); }, 6500);
    });
    // waited out, not polled: Playwright's reads carry a gesture of their own too
    await page.waitForTimeout(8_000);
    expect(await applet(page).locator("body").getAttribute("data-went")).toBe("false");
    expect(page.url()).toBe(here);
    // the agent clears the home in the note; the home's address, reached again, waits for a tap
    const now = await api(hubState(), "GET", `notes/${s.id}`);
    await api(hubState(), "PATCH", `notes/${s.id}`, { metadata: { parachute: { start: null } }, if_updated_at: now.updatedAt });
    await page.goto(here);
    await expect(page.getByRole("button", { name: /^Open Home$/ })).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally {
    await api(hubState(), "DELETE", `notes/${home.id}`);
    await api(hubState(), "DELETE", `notes/${s.id}`);
  }
});

test("Back to the home while the settings are read again still finds it running", async ({ page }) => {
  const home = await record(hubState(), "create", ARGS);
  // the newest note of all, so Lately shows it
  const fresh = await api(hubState(), "POST", "notes", { path: "A note to come back from", content: "x" });
  const s = await settings({ start: { vault: VAULT, applet: "Applets/Home" } });
  try {
    await start(page);
    await page.getByRole("button", { name: "Allow" }).click();
    const lately = applet(page).getByRole("region", { name: "Lately" });
    // a slow hub: the settings note's read, made again as the note's screen shows, is still on its way at the Back
    await page.route((u) => u.searchParams.get("tag") === "parachute-settings", async (r) => { await new Promise((res) => setTimeout(res, 4000)); await r.continue().catch(() => {}); });
    await lately.getByRole("button", { name: /^A note to come back from kitchen/ }).click();
    await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/n/`));
    await ui(page).getByRole("button", { name: "Back" }).click();
    await expect(applet(page).getByRole("region", { name: "Lately" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open Home$/ })).toHaveCount(0);
  } finally {
    await api(hubState(), "DELETE", `notes/${fresh.id}`);
    await api(hubState(), "DELETE", `notes/${home.id}`);
    await api(hubState(), "DELETE", `notes/${s.id}`);
  }
});
