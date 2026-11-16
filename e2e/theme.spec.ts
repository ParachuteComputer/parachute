// The theme record (docs/THEME.md): one note in the home vault that the shell, the frame and every applet follow. It
// is written here the way an agent writes it (the hub's note API), and the app restyles while it runs: no reload, no
// navigation (the frame area reads its notes again only when it is shown, so only the live query can carry this).
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const PAPER = "rgb(242, 237, 226)"; // the built-in bg, #f2ede2
const SAGE = "rgb(236, 238, 233)"; // #eceee9
const THEME = { colors: { bg: "#eceee9", accent: "#2f5470" }, density: "roomy" };

const applet = (page: Page) => page.frameLocator("iframe.applet-frame");
const shellBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const frameBg = (page: Page) => ui(page).locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
const appletVar = (page: Page, v: string) => applet(page).locator("html").evaluate((h, name) => getComputedStyle(h).getPropertyValue(name).trim(), v);
const notReloaded = async (page: Page) => { await page.evaluate(() => { (window as unknown as { __same: number }).__same = 1; }); return () => page.evaluate(() => (window as unknown as { __same?: number }).__same); };

async function themeNote(): Promise<{ id: string } | null> {
  const rows = await api(hubState(), "GET", "notes?tag=parachute-theme&include_metadata=true");
  return (Array.isArray(rows) ? rows : rows.notes)[0] ?? null;
}
async function dropTheme() { const n = await themeNote(); if (n) await api(hubState(), "DELETE", `notes/${n.id}`); }

test.beforeEach(dropTheme);
test.afterEach(dropTheme);

test("writing the theme note restyles the shell and the frame while the app runs, and deleting it brings the default back", async ({ page }) => {
  await page.goto(`/v/${VAULT}`);
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
  expect(await shellBg(page)).toBe(PAPER);
  expect(await frameBg(page)).toBe(PAPER);
  const same = await notReloaded(page);

  // as an agent writes it: one note-create call, nothing else
  const note = await api(hubState(), "POST", "notes", { path: "Parachute/Theme", tags: ["parachute-theme"], metadata: { theme: THEME } });
  await expect.poll(() => shellBg(page)).toBe(SAGE);
  await expect.poll(() => frameBg(page)).toBe(SAGE);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pad").trim())).toBe("20px");

  // a value that doesn't read is the built-in one; the rest stand
  await api(hubState(), "PATCH", `notes/${note.id}`, { metadata: { theme: { ...THEME, colors: { ...THEME.colors, accent: "url(https://example.invalid/x.png)" } } }, if_updated_at: note.updatedAt });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#4f6b3a");
  expect(await shellBg(page)).toBe(SAGE);

  await api(hubState(), "DELETE", `notes/${note.id}`);
  await expect.poll(() => shellBg(page)).toBe(PAPER);
  await expect.poll(() => frameBg(page)).toBe(PAPER);
  expect(await same()).toBe(1);
});

test("a running applet restyles too", async ({ page }) => {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(applet(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  await expect.poll(() => appletVar(page, "--accent")).toBe("#4f6b3a");
  const same = await notReloaded(page);

  await api(hubState(), "POST", "notes", { path: "Parachute/Theme", tags: ["parachute-theme"], metadata: { theme: THEME } });
  await expect.poll(() => appletVar(page, "--accent")).toBe("#2f5470");
  expect(await appletVar(page, "--bg")).toBe("#eceee9");
  expect(await appletVar(page, "--gap")).toBe("18px");
  await expect.poll(() => shellBg(page)).toBe(SAGE);
  expect(await same()).toBe(1);
});

test("the first change in Settings copies the built-in theme into the home vault, and it is the theme from then on", async ({ page }) => {
  await page.goto("/settings");
  const look = page.getByRole("region", { name: "Look" });
  await expect(look.getByRole("status")).toHaveText("The built-in theme.");
  await look.getByRole("radio", { name: "Roomy" }).click();
  await expect(look.getByRole("status")).toContainText("Your theme: Parachute/Theme");
  const n = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Parachute/Theme")}`);
  expect(n.tags).toContain("parachute-theme");
  // written in full, so every value is there for the person or their agent to change
  expect(n.metadata.theme.density).toBe("roomy");
  expect(n.metadata.theme.colors.accent).toBe("#4f6b3a");
  expect(Object.keys(n.metadata.theme.dark)).toHaveLength(7);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gap").trim())).toBe("18px");
  await expect(look.getByRole("button", { name: "Make this mine" })).toHaveCount(0);
});
