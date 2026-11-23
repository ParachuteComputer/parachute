// Choosing a bundle (T-476, Aaron 11-23 on a fresh Mac: "I'm not actually sure if we're the Uni app bundle. Or where to
// select it. In settings I see Parachute simplified and everything; and I'm still a bit curious about what exactly
// everything implies"). Settings → Your bundle names every bundle in the person's vaults on this device, each with what
// it puts on the bar, and says what Everything is; choosing one kept in another vault makes that vault the home.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const PANTRY = "pantry";
const pantry = () => ({ origin: hubState().origin, token: mintToken(`vault:${PANTRY}:write`) });
const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });

test("Your bundle lists the bundles in the person's other vaults and says what each puts on the bar; choosing one there makes that vault home", async ({ page }) => {
  // a bundle as an older install wrote it (Parachute/Apps/, tagged parachute-app), in a vault that isn't the home
  const made = await api(pantry(), "POST", "notes", { path: "Parachute/Apps/uni", content: "Uni", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "uni", name: "Uni", glyph: "◉", sources: [{ vault: PANTRY, applet: "*" }], bar: [{ vault: PANTRY, applet: "Applets/Shelves" }] } } }, PANTRY);
  try {
    await page.goto("/settings");
    const choice = page.getByRole("group", { name: "Which bundle opens" });
    // what Everything and Simplified are, in plain words
    await expect(choice.getByRole("radio", { name: /Everything/ })).toBeChecked();
    await expect(choice).toContainText("Everything: every applet in every vault on this device, in one list. On the bar: Applets.");
    await expect(choice).toContainText("Parachute Simplified: your notes first. On the bar: Notes, Journal, Capture, Vault, Connect.");
    // the bundle in pantry, by name, where it is, and its bar
    const uni = choice.getByRole("radio", { name: /Uni/ });
    await expect(uni).toBeVisible();
    await expect(choice).toContainText("Uni, in pantry. On the bar: Shelves, Applets.");
    await expect(page.getByText("Choosing a bundle kept in another vault makes that vault your home.")).toBeVisible();

    await uni.check();
    await expect(uni).toBeChecked();
    await expect(page.getByRole("radio", { name: PANTRY, exact: true })).toBeChecked();
    // saved: the choice is no longer being written, and Uni is the home's bundle now
    await expect(choice).toBeEnabled();
    await expect(choice.getByRole("radio", { name: /Uni/ })).toBeChecked();
    await expect.poll(async () => ((await api(pantry(), "GET", "notes?tag=parachute-settings&include_metadata=true", undefined, PANTRY)) as { metadata?: { parachute?: { bundle?: string } } }[])[0]?.metadata?.parachute?.bundle).toBe("uni");
    await page.goto("/");
    await expect(bar(page).getByRole("link", { name: /Shelves/ })).toBeVisible();
    await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Shelves/ })).toBeVisible();
  } finally {
    await api(pantry(), "DELETE", `notes/${made.id}`, undefined, PANTRY);
    for (const n of await api(pantry(), "GET", "notes?tag=parachute-settings", undefined, PANTRY) as { id: string }[]) await api(pantry(), "DELETE", `notes/${n.id}`, undefined, PANTRY);
  }
});

test("the line says the person's own pins where a bundle has no bar of its own", async ({ page }) => {
  // the settings note's pins, as an older install kept them, on Everything (which has no bar of its own)
  const note = await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bar: [{ vault: "letters", applet: "Applets/Post" }] } } });
  try {
    await page.goto("/settings");
    const choice = page.getByRole("group", { name: "Which bundle opens" });
    await expect(choice).toContainText("Everything: every applet in every vault on this device, in one list. On the bar: Post, Applets.");
    await page.goto("/");
    await expect(bar(page).getByRole("link", { name: /Post/ })).toBeVisible();
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});

test("choosing a bundle in another vault that can't be saved there leaves the home as it was, and says so", async ({ page }) => {
  const made = await api(pantry(), "POST", "notes", { path: "Parachute/Apps/uni", content: "Uni", tags: ["parachute-app"], metadata: { app: {
    contract: 1, id: "uni", name: "Uni", glyph: "◉", sources: [{ vault: PANTRY, applet: "*" }], bar: [{ vault: PANTRY, applet: "Applets/Shelves" }] } } }, PANTRY);
  try {
    await page.goto("/settings");
    const choice = page.getByRole("group", { name: "Which bundle opens" });
    await expect(choice.getByRole("radio", { name: /Uni/ })).toBeVisible();
    // pantry reads, but takes no change (a Parachute that refuses writes there)
    await page.route(`${hubState().origin}/vault/${PANTRY}/**`, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":"no"}' })));
    await choice.getByRole("radio", { name: /Uni/ }).check();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("radio", { name: "kitchen", exact: true })).toBeChecked();
    await expect(choice.getByRole("radio", { name: /Everything/ })).toBeChecked();
  } finally {
    await page.unrouteAll();
    await api(pantry(), "DELETE", `notes/${made.id}`, undefined, PANTRY);
    for (const n of await api(pantry(), "GET", "notes?tag=parachute-settings", undefined, PANTRY) as { id: string }[]) await api(pantry(), "DELETE", `notes/${n.id}`, undefined, PANTRY);
  }
});
