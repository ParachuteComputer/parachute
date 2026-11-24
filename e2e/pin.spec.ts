// Pinning, one tap wherever an applet is (T-476, Aaron 11-24: "I dont see a way to pin applets so I can get to them
// easily"): the same Pin button on each applet's row in the list and in an applet's own top bar, pressed when it is on the
// bar. Each tap writes the open bundle's record (as Settings → On the bar does, #204), so every device follows. And the
// bar keeps its way to the list in reach however many places are pinned.
import { expect, test, type Page } from "@playwright/test";
import { bundleOf, clearBarAndHome, ui, writeBundle } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
test.afterEach(clearBarAndHome);

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
const appletFrame = (page: Page) => page.frameLocator("iframe.applet-frame");
const pinsOfRecord = async () => ((await bundleOf())?.body.bar ?? []).map((p: { applet: string }) => p.applet);
async function start(page: Page) { await page.goto("about:blank"); await page.goto("/"); }

test("the list: each applet's Pin pins it to the bar and unpins it, written to the bundle", async ({ page }) => {
  await start(page);
  const list = ui(page).getByRole("list", { name: "Applets" });
  const pin = list.getByRole("button", { name: "Pin Recipe box to the bar" });
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect.poll(pinsOfRecord).toEqual(["Applets/Recipes"]);
  // the same button, pressed now: a tap unpins
  const unpin = list.getByRole("button", { name: "Unpin Recipe box from the bar" });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await expect(unpin).toHaveText(/Pinned/);
  await unpin.click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  await expect.poll(pinsOfRecord).toEqual([]);
  // the row's tap still opens the applet: the button is beside the link, not in it
  await list.getByRole("link", { name: /Recipe box/ }).click();
  await expect(page).toHaveURL(new RegExp(`/v/${VAULT}/a/`));
});

test("an applet's own screen: the same Pin in its top bar, before it runs and while it runs", async ({ page }) => {
  await start(page);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  // still asking: pinning runs nothing, so it is offered on the card's screen too
  await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
  const top = page.locator("header.bar");
  await top.getByRole("button", { name: "Pin Recipe box to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await expect.poll(pinsOfRecord).toEqual(["Applets/Recipes"]);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(appletFrame(page).getByRole("heading", { name: "Recipe box" })).toBeVisible();
  const unpin = top.getByRole("button", { name: "Unpin Recipe box from the bar" });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await unpin.click();
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
  await expect.poll(pinsOfRecord).toEqual([]);
  // Parachute's own applets pin the same way
  await page.goto(`/v/${VAULT}/a/parachute%3Ajournal`);
  await page.locator("header.bar").getByRole("button", { name: "Pin Journal to the bar" }).click();
  await expect(bar(page).getByRole("link", { name: /Journal/ })).toBeVisible();
  await expect.poll(pinsOfRecord).toEqual(["parachute:journal"]);
});

test("a full bar keeps Applets in reach beside Settings on a phone, with no sideways scroll", async ({ page }) => {
  await writeBundle({ bar: ["Recipes", "Cook mode", "Recipes", "Cook mode"].map((a) => ({ vault: VAULT, applet: `Applets/${a}` }))
    .concat([{ vault: VAULT, applet: "parachute:journal" }, { vault: VAULT, applet: "parachute:capture" }, { vault: VAULT, applet: "parachute:vault" }, { vault: VAULT, applet: "parachute:notes" }]) });
  await start(page);
  await expect(bar(page).getByRole("link", { name: /Capture/ })).toBeAttached();
  // (the place in front rises 1px into the bar's top line, so "whole" is 0.95)
  await page.screenshot({ path: test.info().outputPath("full-bar.png") });
  await expect(bar(page).getByRole("link", { name: /Applets/ })).toBeInViewport({ ratio: 0.95 });
  await expect(bar(page).getByRole("link", { name: /Settings/ })).toBeInViewport({ ratio: 0.95 });
  // and the nearest pin passes under them: the bar scrolls, the two stay
  await bar(page).evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect(bar(page).getByRole("link", { name: /Applets/ })).toBeInViewport({ ratio: 0.95 });
  // the place you are in is shown, clear of them: opened at its address (a start, a hub's page coming back), the bar
  // scrolls to it
  await page.goto(`/v/${VAULT}/a/parachute%3Avault`);
  const here = bar(page).getByRole("link", { name: /Vault/ });
  await expect(here).toHaveAttribute("aria-current", "page");
  await expect(here).toBeInViewport({ ratio: 0.95 });
  const [a, b] = [await here.boundingBox(), await bar(page).locator(".home-bar-held").boundingBox()];
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);
});

test("no Pin where a tap couldn't pin: a bar someone else offers, and one of Parachute's own the bundle places on its bar", async ({ page }) => {
  const origin = hubState().origin;
  // someone else's bundle (a record standing in for theirs), followed live: its bar is theirs
  const theirs = await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/shared-desk", content: "theirs", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "shared-desk", name: "Shared desk", sources: [{ vault: VAULT, applet: "*" }], bar: [] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/desk", content: "mine", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "desk", name: "Desk", live: { hub: origin, vault: VAULT, path: "Parachute/Bundles/shared-desk" } } } });
  const settings = await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "desk" } } });
  try {
    await start(page);
    const list = ui(page).getByRole("list", { name: "Applets" });
    await expect(list.getByRole("link", { name: /Recipe box/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /to the bar|from the bar/ })).toHaveCount(0);
    await list.getByRole("link", { name: /Recipe box/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
    await expect(page.locator("header.bar").getByRole("button", { name: /to the bar|from the bar/ })).toHaveCount(0);
    // Parachute Simplified: Journal is the bundle's own place on its bar, not a pin, so it offers none; Vault isn't there
    await api(hubState(), "PATCH", `notes/${settings.id}`, { metadata: { parachute: { bundle: "simple" } }, if_updated_at: (await api(hubState(), "GET", `notes/${settings.id}`)).updatedAt });
    await page.goto(`/v/${VAULT}/a/parachute%3Ajournal`);
    await expect(bar(page).getByRole("link", { name: /Journal/ })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("header.bar").getByRole("button", { name: /to the bar|from the bar/ })).toHaveCount(0);
    await page.goto(`/v/${VAULT}/a/parachute%3Ahome`);
    await expect(page.locator("header.bar").getByRole("button", { name: "Pin Home to the bar" })).toBeVisible();
  } finally { await api(hubState(), "DELETE", `notes/${theirs.id}`).catch(() => {}); }
});
