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
    await page.goto("/");
    await expect(bar(page).getByRole("link", { name: /Shelves/ })).toBeVisible();
    await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Shelves/ })).toBeVisible();
  } finally {
    await api(pantry(), "DELETE", `notes/${made.id}`, undefined, PANTRY);
    for (const n of await api(pantry(), "GET", "notes?tag=parachute-settings", undefined, PANTRY) as { id: string }[]) await api(pantry(), "DELETE", `notes/${n.id}`, undefined, PANTRY);
  }
});
