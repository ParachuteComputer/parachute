// The bar, in Settings → Your bundle (T-476, Aaron 11-23 via Uni: "I'd also like to be able to select what gets pinned
// to the menu bar. Which should be updating the Bundle as we go right?"). Pin, unpin and move, written to the open
// bundle's record in the home vault, so every device of the person's follows; a bundle someone else offers is copied
// into one of the person's own first.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

type Row = { id: string; path: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
test.afterEach(async () => { for (const t of ["parachute-settings", "parachute-bundle", "parachute-app"]) for (const n of await tagged(t)) await api(hubState(), "DELETE", `notes/${n.id}`); });
const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
// (a first record is written under the names the vault already uses: the older ones, in a vault with none yet)
const barOfRecord = async () => { const r = [...await tagged("parachute-bundle"), ...await tagged("parachute-app")][0]?.metadata; return (r?.bundle ?? r?.app)?.bar as { vault: string; applet: string }[] | undefined; };

test("Settings → Your bundle: pin applets to the bar, move and unpin them; the bundle record holds the bar", async ({ page }) => {
  await page.goto("/settings");
  const onBar = page.getByRole("group", { name: "On the bar" });
  await expect(onBar).toContainText("Nothing pinned yet.");
  await onBar.getByText("Pin another applet").click();
  const pinned = onBar.getByRole("list", { name: "On the bar now" });
  await onBar.getByRole("button", { name: "Pin Recipe box" }).click();
  await expect(pinned.getByRole("listitem")).toHaveText([/Recipe box/]);
  await onBar.getByRole("button", { name: "Pin Post" }).click();
  await expect(pinned.getByRole("listitem")).toHaveText([/Recipe box/, /Post/]);
  await expect.poll(async () => (await barOfRecord())?.map((p) => p.applet)).toEqual(["Applets/Recipes", "Applets/Post"]);
  // moved: Post first
  await pinned.getByRole("button", { name: "Move Post up" }).click();
  await expect(pinned.getByRole("listitem")).toHaveText([/Post/, /Recipe box/]);
  await expect.poll(async () => (await barOfRecord())?.map((p) => p.applet)).toEqual(["Applets/Post", "Applets/Recipes"]);
  await expect(bar(page).getByRole("link", { name: /Post/ })).toBeVisible();
  // unpinned
  await pinned.getByRole("button", { name: "Unpin Recipe box" }).click();
  await expect(pinned.getByRole("listitem")).toHaveText([/Post/]);
  await expect.poll(async () => (await barOfRecord())?.map((p) => p.applet)).toEqual(["Applets/Post"]);
  await expect(bar(page).getByRole("link", { name: /Recipe box/ })).toHaveCount(0);
});

test("a bundle someone else offers: its bar is theirs until the person makes a copy of their own, which then takes pins", async ({ page }) => {
  const origin = hubState().origin;
  // theirs (here: a record in the home vault standing in for theirs) and the person's, following it live
  const theirs = await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/shared-desk", content: "theirs", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "shared-desk", name: "Shared desk", sources: [{ vault: "kitchen", applet: "*" }], bar: [{ vault: "kitchen", applet: "Applets/Recipes" }] } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/desk", content: "mine", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "desk", name: "Desk", live: { hub: origin, vault: "kitchen", path: "Parachute/Bundles/shared-desk" } } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "desk" } } });
  try {
    await page.goto("/settings");
    const onBar = page.getByRole("group", { name: "On the bar" });
    await expect(onBar).toContainText("This bar is the one the bundle's owner offers.");
    await expect(onBar.getByRole("button", { name: /Unpin/ })).toHaveCount(0);
    await onBar.getByRole("button", { name: "Make a copy of your own" }).click();
    // copied: the bar is the person's now, with theirs on it
    await expect(onBar).not.toContainText("This bar is the one the bundle's owner offers.");
    await expect(onBar.getByRole("list", { name: "On the bar now" }).getByRole("listitem")).toHaveText([/Recipe box/]);
    const mine = (await tagged("parachute-bundle")).find((r) => r.path.startsWith("Parachute/Bundles/desk"))!;
    expect(mine.metadata.bundle.live).toBeUndefined();
    expect(mine.metadata.bundle.bar).toEqual([{ hub: origin, vault: "kitchen", applet: "Applets/Recipes" }]);
    expect(mine.metadata.bundle.sources).toEqual([{ hub: origin, vault: "kitchen", applet: "*" }]);
    // what it offers is what theirs offered: kitchen's applets, not letters'
    await onBar.getByText("Pin another applet").click();
    await expect(onBar.getByRole("button", { name: "Pin Post" })).toHaveCount(0);
    await onBar.getByRole("button", { name: "Pin Cook mode" }).click();
    await expect(onBar.getByRole("list", { name: "On the bar now" }).getByRole("listitem")).toHaveText([/Recipe box/, /Cook mode/]);
  } finally { await api(hubState(), "DELETE", `notes/${theirs.id}`).catch(() => {}); }
});

test("a bundle someone else offers that can't be read here: no copy of nothing is offered", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/desk", content: "mine", tags: ["parachute-bundle"], metadata: { bundle: {
    contract: 1, id: "desk", name: "Desk", live: { hub: "https://elsewhere.example", vault: "studio", path: "Parachute/Bundles/desk" } } } });
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "desk" } } });
  await page.goto("/settings");
  const onBar = page.getByRole("group", { name: "On the bar" });
  await expect(onBar).toContainText("it can't be read here now");
  await expect(onBar.getByRole("button", { name: "Make a copy of your own" })).toHaveCount(0);
});

test("on Parachute Simplified, the bar's own places are listed and not offered again", async ({ page }) => {
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "simple" } } });
  await page.goto("/settings");
  const onBar = page.getByRole("group", { name: "On the bar" });
  await expect(onBar.getByRole("list", { name: "On the bar now" }).getByRole("listitem")).toHaveText([/Notes/, /Journal/, /Capture/, /Vault/, /Connect/]);
  await onBar.getByText("Pin another applet").click();
  for (const name of ["Notes", "Journal", "Capture", "Vault", "Connect"]) await expect(onBar.getByRole("button", { name: `Pin ${name}` })).toHaveCount(0);
  await expect(onBar.getByRole("button", { name: "Pin Home" })).toBeVisible();
});
