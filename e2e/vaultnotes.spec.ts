// Vault's first screen is the vault's notes (T-476; Aaron, 11-27: "Good simple defaults like an apple notes"): a calm
// list, newest first, each with its first words; a search; a new note in one tap, typed straight in and kept without a
// Save; a note opens to its words, and a tap in them writes. Types, tables, Changes and Sharing are one step away, and
// a record's fields, links and history sit under one line. On a computer the list stays beside the open note.
import { expect, test, type Page } from "./test";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
const vaultUi = (page: Page) => page.frameLocator("iframe.applet-frame");
const hub = () => hubState();
type Row = { id: string; path: string; content?: string };
const under = async (prefix: string) => (await api(hub(), "GET", `notes?path_prefix=${encodeURIComponent(prefix)}&include_content=true&limit=50`)) as Row[];
async function cleanup() {
  for (const p of ["Garden/", "Notes/"]) for (const n of await under(p)) await api(hub(), "DELETE", `notes/${n.id}`).catch(() => {});
}
async function seed() {
  // oldest first, so the trellis is the newest
  for (const [path, content] of [
    ["Garden/Seed swap", "# Seed swap\n\nMira brings the beans. I bring the squash."],
    ["Garden/Compost log", "Turned the pile on Sunday. It steams."],
    ["Garden/Tomato trellis ideas", "# Tomato trellis ideas\n\nCattle panel arch over the path, or strings from a ridge pole."],
  ]) await api(hub(), "POST", "notes", { path, content });
}
const notes = (page: Page) => vaultUi(page).getByRole("region", { name: "Notes" });
/** Vault, at the test's vault: picked from Your vaults when Vault holds more than one. */
async function openVault(page: Page) {
  await page.goto("/vault");
  await expect(vaultUi(page).getByRole("heading", { level: 1 })).toBeVisible();
  const pick = vaultUi(page).getByRole("region", { name: "Vaults" }).getByRole("button", { name: new RegExp(`^${VAULT}\\b`) });
  if (await pick.isVisible()) await pick.click();
  await expect(vaultUi(page).getByRole("heading", { level: 1, name: VAULT })).toBeVisible();
}

test.describe("Vault's notes", () => {
  test.beforeEach(async () => { await cleanup(); await seed(); });
  test.afterAll(cleanup);

  test("opens on the vault's notes, newest first, each with its first words; search narrows; tables are one step away", async ({ page }) => {
    await openVault(page);
    const rows = notes(page).getByRole("button");
    await expect(rows.first()).toContainText("Tomato trellis ideas");
    // its first words, without its own title said twice
    await expect(rows.first()).toContainText("Cattle panel arch over the path");
    await expect(rows.first()).not.toContainText("Tomato trellis ideas Tomato trellis ideas");
    await expect(rows.nth(1)).toContainText("Compost log");
    await expect(rows.nth(1)).toContainText("Turned the pile on Sunday");
    // nothing of the tables on the first screen
    await expect(vaultUi(page).getByRole("region", { name: "Types" })).toHaveCount(0);
    await expect(vaultUi(page).getByRole("textbox", { name: "New type" })).toHaveCount(0);

    await vaultUi(page).getByRole("searchbox", { name: `Search ${VAULT}` }).fill("ridge pole");
    await expect(vaultUi(page).getByRole("region", { name: "Found" }).getByRole("button")).toHaveCount(1);
    await expect(vaultUi(page).getByRole("region", { name: "Found" })).toContainText("Tomato trellis ideas");
    await vaultUi(page).getByRole("searchbox", { name: `Search ${VAULT}` }).fill("");

    // one step away: the types and tables, then back to the notes
    await vaultUi(page).getByRole("button", { name: "Types and tables" }).click();
    await expect(vaultUi(page).getByRole("textbox", { name: "New type" })).toBeVisible();
    await vaultUi(page).getByRole("button", { name: `← ${VAULT}` }).click();
    await expect(rows.first()).toContainText("Tomato trellis ideas");
  });

  test("New note is one tap: type, and it is kept without a Save; its first line names it", async ({ page }) => {
    test.setTimeout(60_000);
    await openVault(page);
    await vaultUi(page).getByRole("button", { name: "New note" }).click();
    const box = vaultUi(page).getByRole("textbox", { name: "The note's words" });
    await expect(box).toBeFocused();
    // nothing is in the vault until there are words
    expect(await under("Notes/")).toHaveLength(0);
    await box.pressSequentially("Bee course notes\n\nSmoke first, then lift the lid.");
    await expect(vaultUi(page).getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    // typing on: the same note, never a second one, and the box keeps the caret
    await expect(box).toBeFocused();
    await box.pressSequentially(" Wear the veil.");
    await expect.poll(async () => (await under("Notes/")).map((n) => n.content), { timeout: 10_000 }).toEqual(["Bee course notes\n\nSmoke first, then lift the lid. Wear the veil."]);
    await vaultUi(page).getByRole("button", { name: "Done" }).click();
    // read as written, named by its first line
    await expect(vaultUi(page).getByRole("article", { name: "Bee course notes" })).toContainText("Smoke first, then lift the lid. Wear the veil.");
    await vaultUi(page).getByRole("button", { name: `← ${VAULT}` }).click();
    await expect(notes(page).getByRole("button").first()).toContainText("Bee course notes");
    await expect(notes(page).getByRole("button").first()).toContainText("Smoke first");
  });

  test("a note opens to its words; a tap in them writes, kept as you go; fields, links and history are under one line", async ({ page }) => {
    test.setTimeout(60_000);
    await openVault(page);
    await notes(page).getByRole("button", { name: /Compost log/ }).click();
    const note = vaultUi(page).getByRole("article", { name: "Compost log" });
    await expect(note).toContainText("Turned the pile on Sunday. It steams.");
    // a plain note: its fields and history are there, closed
    const more = note.locator("details", { hasText: "Fields, links, history, sharing" });
    await expect(more).toBeVisible();
    await expect(note.getByRole("textbox", { name: "Add a field" })).toBeHidden();
    await note.getByText("Turned the pile on Sunday").click();
    const box = note.getByRole("textbox", { name: "The note's words" });
    await expect(box).toBeFocused();
    await box.press("Control+End");
    await box.pressSequentially(" Added leaves.");
    await expect.poll(async () => (await under("Garden/Compost log"))[0]?.content, { timeout: 10_000 }).toBe("Turned the pile on Sunday. It steams. Added leaves.");
    await note.getByRole("button", { name: "Done" }).click();
    await expect(note).toContainText("It steams. Added leaves.");
    await more.locator("summary").click();
    await expect(note.getByRole("textbox", { name: "Add a field" })).toBeVisible();
    await expect(note.getByRole("region", { name: "Versions" })).toBeVisible();
  });

  test("on a computer the notes stay beside the open note; on a phone the note takes their place", async ({ page }) => {
    await openVault(page);
    await notes(page).getByRole("button", { name: /Seed swap/ }).click();
    await expect(vaultUi(page).getByRole("article", { name: "Seed swap" })).toBeVisible();
    await expect(notes(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(vaultUi(page).getByRole("article", { name: "Seed swap" })).toBeVisible();
    await expect(notes(page).getByRole("button", { name: /Seed swap/ })).toHaveAttribute("aria-current", "true");
    // another note, without leaving the list
    await notes(page).getByRole("button", { name: /Compost log/ }).click();
    await expect(vaultUi(page).getByRole("article", { name: "Compost log" })).toBeVisible();
    await expect(notes(page).getByRole("button", { name: /Tomato trellis ideas/ })).toBeVisible();
  });
});
