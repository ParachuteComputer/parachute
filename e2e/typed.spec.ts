// Typed records end to end (T-476; the Claude audit's walk 4): what an applet changes is what an AI reads back. The
// AI's type and records go in as an AI writes them (a `book` type with `book_status`); the audit's reading tracker
// ticks a book and the vault's field changes, in one call; the note view shows the record's fields; the app's editor
// changes one, typed by the type's own definition. Needs a hub with the record door (core 0.9).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const TRACKER = readFileSync(new URL("./fixtures/typed/Reading tracker.tsx", import.meta.url), "utf8");
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
/** A screenshot for the walkthrough, when WALKTHROUGH_DIR names where. */
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());
const hasDoor = async () => (await fetch(`${hubState().origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hubState().token}` } })).status === 200;
const status = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).metadata?.book_status;

async function world() {
  const made: string[] = [];
  // the type, as the AI defined it (an admin pass: on a hub before core's T-476, write access couldn't)
  const admin = mintToken(`vault:${VAULT}:admin`);
  const put = await fetch(`${hubState().origin}/vault/${VAULT}/api/tags/book`, { method: "PUT", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
    body: JSON.stringify({ description: "A book", fields: { book_status: { type: "string", enum: ["to-read", "reading", "read"] }, book_author: { type: "string" } } }) });
  expect(put.status).toBe(200);
  for (const [title, author] of [["The Overstory", "Richard Powers"], ["A Pattern Language", "Christopher Alexander"]]) {
    made.push((await record(hubState(), "create", { path: `Books/${title}`, body: `Imported from [[Books I want to read]].`, types: ["book"], fields: { book_status: "to-read", book_author: author } })).id as string);
  }
  made.push((await record(hubState(), "create", { path: "Applets/Reading tracker", extension: "tsx", body: TRACKER, tags: ["applet"],
    fields: { applet: { contract: 2, id: "reading-tracker", name: "Reading tracker", glyph: "📚", access: [{ vault: "here", allow: [{ path: "Books/", verbs: ["read", "create", "update"] }] }] } } })).id as string);
  return made;
}
async function tearDown(made: string[]) {
  for (const n of await api(hubState(), "GET", "notes?path_prefix=Books/")) await api(hubState(), "DELETE", `notes/${n.id}`).catch(() => {});
  for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
}

test("the audit's reading tracker ticks book_status for real, and adds a typed book", async ({ page }) => {
  test.skip(!(await hasDoor()), "types and fields need the record door (core 0.9)");
  const made = await world();
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Reading tracker/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByText("The Overstory")).toBeVisible();
    await app.getByText("The Overstory").click();
    await expect(app.getByRole("region", { name: "Read", exact: true })).toContainText("The Overstory");
    // the vault says so too: what the AI reads back
    await expect.poll(() => status("Books/The Overstory")).toBe("read");
    expect(await status("Books/A Pattern Language")).toBe("to-read");
    // and back
    await app.getByText("The Overstory").click();
    await expect.poll(() => status("Books/The Overstory")).toBe("to-read");
    // a new book is a typed record, with its field
    await app.getByRole("textbox", { name: "Add a book" }).fill("Braiding Sweetgrass");
    await app.getByRole("button", { name: "Add" }).click();
    await expect(app.getByText("Braiding Sweetgrass")).toBeVisible();
    const added = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Books/Braiding Sweetgrass")}`);
    expect(added.types).toEqual(["book"]);
    expect(added.metadata.book_status).toBe("to-read");
    await shot(page, "02-tracker-ticked");
  } finally { await tearDown(made); }
});

test("the note view shows a typed record's fields, and the editor changes one by its type's definition", async ({ page }) => {
  test.skip(!(await hasDoor()), "types and fields need the record door (core 0.9)");
  const made = await world();
  try {
    await page.goto(`/v/${VAULT}/n/${made[0]}`);
    const fields = ui(page).getByRole("definition").first();
    await expect(fields).toBeVisible();
    const list = ui(page).locator("dl.note-fields");
    await expect(list).toContainText("book status");
    await expect(list).toContainText("to-read");
    await expect(list).toContainText("book author");
    await expect(list).toContainText("Richard Powers");
    await shot(page, "03-note-fields");
    await ui(page).getByRole("link", { name: "Edit" }).click();
    const status_ = page.getByLabel("book status");
    await expect(status_).toBeVisible();
    // an enum is a choice of the type's own values
    expect(await status_.locator("option").allTextContents()).toEqual(["–", "to-read", "reading", "read"]);
    await status_.selectOption("reading");
    await shot(page, "04-edit-fields");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => status("Books/The Overstory")).toBe("reading");
    // the body is as it was, and the other field untouched
    const after = await api(hubState(), "GET", `notes?id=${made[0]}`);
    expect(after.content).toBe("Imported from [[Books I want to read]].");
    expect(after.metadata.book_author).toBe("Richard Powers");
    await expect(ui(page).locator("dl.note-fields")).toContainText("reading");
  } finally { await tearDown(made); }
});
