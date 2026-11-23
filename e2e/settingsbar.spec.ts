// Settings is one tap away from every place (T-476, Aaron 11-22: "on the bottom bar settings is not there by default"):
// the shell ends the bar with it, whatever the open bundle's bar says, and holds it on screen however full the bar is,
// at a phone's width (the foot) and a computer's (the sidebar down the left edge).
import { expect, test, type Page } from "@playwright/test";
import { clearBarAndHome, writeBundle } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
test.afterEach(clearBarAndHome);

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
const idOf = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;

/** The bar's Settings: there, on screen, and the thing a tap at its middle lands on (no place passes over it). */
async function settingsInReach(page: Page, where: string) {
  const s = bar(page).getByRole("link", { name: "Settings", exact: true });
  await expect(s, where).toBeVisible();
  await expect(s, where).toBeInViewport({ ratio: 0.9 });
  const box = (await s.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".home-bar-settings"), [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit, `${where}: a tap on Settings lands on it`).toBe(true);
  return s;
}

/** A place brought into view the nearest way (as focus does) from the start of the bar is not under Settings. */
async function notUnderSettings(page: Page, name: string) {
  await bar(page).evaluate((n) => { n.scrollLeft = 0; n.scrollTop = 0; });
  const place = bar(page).getByRole("link", { name: new RegExp(`${name}$`) });
  await place.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  const a = (await place.boundingBox())!;
  const free = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".home-bar-place:not(.home-bar-settings)"), [a.x + a.width / 2, a.y + a.height / 2]);
  expect(free, `${name}, brought into view, is not under Settings`).toBe(true);
}

test("Settings is on the bar at every place, in reach with a full bar, at a phone's width and a computer's; a tap opens it", async ({ page }) => {
  const made: string[] = [];
  try {
    for (let i = 1; i <= 11; i++) {
      const n = await api(hubState(), "POST", "notes", { path: `Applets/Extra ${i}`, content: "<!doctype html><p>extra</p>", extension: "html", tags: ["applet"],
        metadata: { applet: { contract: 2, id: `extra-${i}`, name: `Extra ${i}`, glyph: "✦" } } });
      made.push(n.id);
    }
    // a bundle whose bar is full (12 places) and names nothing of the app's own
    await writeBundle({ bar: [{ vault: VAULT, applet: "Applets/Recipes" }, ...Array.from({ length: 11 }, (_, i) => ({ vault: VAULT, applet: `Applets/Extra ${i + 1}` }))] });
    const places: [string, string][] = [
      ["the list", "/"],
      ["a vault", `/v/${VAULT}?with=vault`],
      ["a note", `/v/${VAULT}/n/${await idOf("Welcome")}`],
      ["an applet", `/v/${VAULT}/a/${await idOf("Applets/Recipes")}`],
      ["Capture", "/capture"],
      ["Journal", "/journal"],
      ["Connect", "/connect"],
      ["Vault", "/vault"],
    ];
    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      for (const [name, href] of places) {
        await page.goto(href);
        await expect(bar(page).getByRole("link", { name: /Extra 11/ })).toBeAttached();
        const s = await settingsInReach(page, `${name} at ${size.width}`);
        await expect(bar(page).getByRole("link")).toHaveCount(14);
        // last on the bar, after the way home
        await expect(bar(page).getByRole("link").last()).toHaveText(/Settings/);
        await expect(s).not.toHaveAttribute("aria-current", "page");
      }
      await bar(page).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      const s = await settingsInReach(page, `Settings at ${size.width}`);
      await expect(s).toHaveAttribute("aria-current", "page");
      // the bar's other places scroll past it, and a place brought into view (a key's focus, say) is not under it (the
      // index at 1440×900 holds them all: the short window below is the computer's case)
      if (size.width < 960) await notUnderSettings(page, "Extra 6");
    }
    // a computer's window too short for the index: Settings is held at its foot, and the places pass above it
    await page.setViewportSize({ width: 1440, height: 640 });
    await page.goto("/");
    await expect(bar(page).getByRole("link", { name: /Extra 11/ })).toBeAttached();
    expect(await bar(page).evaluate((n) => n.scrollHeight > n.clientHeight), "the index overflows").toBe(true);
    await settingsInReach(page, "the list at 1440×640");
    await notUnderSettings(page, "Extra 11");
    await bar(page).evaluate((n) => { n.scrollTop = n.scrollHeight; });
    await settingsInReach(page, "the list at 1440×640, scrolled to the end");
    // on Daylight, Settings open: still at the index's foot
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.setItem("parachute.screen.v1", "daylight"));
    await page.goto("/settings");
    const foot = await bar(page).evaluate((n) => n.getBoundingClientRect().bottom);
    const box = (await (await settingsInReach(page, "Settings on Daylight at 1440")).boundingBox())!;
    expect(foot - (box.y + box.height), "Settings sits at the index's foot on Daylight").toBeLessThan(40);
    await page.evaluate(() => localStorage.removeItem("parachute.screen.v1"));
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`);
  }
});

test("a bundle whose bar is empty, or names only its own places, still ends with Settings", async ({ page }) => {
  await writeBundle({ bar: [] });
  await page.goto("/");
  await expect(bar(page).getByRole("link")).toHaveText([/Applets/, /Settings/]);
  await writeBundle({ bar: [{ screen: "home" }, { shipped: "journal" }, { screen: "settings" }] });
  await page.goto("/");
  // a record can't name, move or hide Settings: an entry that says so is left out, and the shell's own is last
  await expect(bar(page).getByRole("link")).toHaveText([/Applets/, /Journal/, /Settings/]);
  await settingsInReach(page, "the list");
});
