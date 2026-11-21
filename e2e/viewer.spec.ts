// Vault, Parachute's own viewer (applets/vault.tsx, docs/VAULT.md), on a real hub: added with one tap, allowed on its
// card; your vaults, a type's records as a table, a record opened, a field changed (and the vault holds the new value),
// a record an AI writes appearing while it is open; and a record no other applet opens opening in it.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const vaultUi = (page: Page) => page.frameLocator("iframe.applet-frame");
const hub = () => hubState();

/** Core 0.9 serves records with types; 0.8 has neither (this spec's typed half is for 0.9). */
async function typed(): Promise<boolean> {
  const r = await fetch(`${hub().origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hub().token}` } });
  return r.ok;
}
/** Vault, Parachute's own (docs/design/PARACHUTE-SOURCE.md): it opens with no card. */
async function addAndAllow(page: Page) {
  await page.goto("/vault");
  await expect(vaultUi(page).getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
}
const made: string[] = [];
async function seed() {
  const recs = Array.from({ length: 30 }, (_, i) => ({ path: `Shelf/Book ${String(i).padStart(2, "0")}`, content: `A made-up book.${i === 0 ? " See [[Shelf/Book 01]]." : ""}`, types: ["shelfbook"],
    metadata: { author: `Author ${i % 4}`, shelf_status: ["to-read", "reading", "read"][i % 3], pages: 100 + i } }));
  // the type declares its fields (an admin's, or an AI's with manage-types): a choice shows as one
  await api({ ...hub(), token: mintToken(`vault:${VAULT}:admin`) }, "PUT", "types/shelfbook", { fields: { author: { type: "string" }, shelf_status: { type: "string", enum: ["to-read", "reading", "read"] }, pages: { type: "integer" } } });
  const out = await api(hub(), "POST", "records", { records: recs });
  for (const r of (out.records ?? out) as { id: string }[]) made.push(r.id);
}
async function cleanup() {
  for (const id of made.splice(0)) await api(hub(), "DELETE", `records/${id}`).catch(() => {});
  for (const n of await api(hub(), "GET", "notes?path=Applets%2FVault")) await api(hub(), "DELETE", `notes/${n.id}`).catch(() => {});
  for (const n of await api(hub(), "GET", "notes?path_prefix=Parachute%2FViews%2F")) await api(hub(), "DELETE", `notes/${n.id}`).catch(() => {});
  for (const n of await api(hub(), "GET", "notes?path_prefix=Seedlings%2F")) await api(hub(), "DELETE", `notes/${n.id}`).catch(() => {});
  if (await typed()) for (const t of ["shelfbook", "seedling"]) await api({ ...hub(), token: mintToken(`vault:${VAULT}:admin`) }, "DELETE", `types/${t}`).catch(() => {});
}

test.describe("Vault", () => {
  test.beforeAll(async () => { await cleanup(); if (await typed()) await seed(); });
  test.afterAll(cleanup);

  test("a record no applet opens opens in Vault, Parachute's own, with no card; ?with=vault is the plain view", async ({ page }) => {
    const [plain] = await api(hub(), "GET", "notes?path_prefix=Shelf%2F&limit=1");
    test.skip(!plain, "no typed records on this core");
    await page.goto(`/v/${VAULT}/n/${plain.id}`);
    await expect(page).toHaveURL(/\/a\/parachute%3Avault\?/);
    await expect(vaultUi(page).getByRole("heading", { name: plain.path.split("/").pop() })).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await page.goto(`/v/${VAULT}/n/${plain.id}?with=vault`);
    await expect(ui(page).getByRole("heading", { name: plain.path.split("/").pop() })).toBeVisible();
  });

  test("open it; browse a type's table, open a record, change a field; what an AI writes appears", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    test.setTimeout(90_000);
    // Parachute's own: no card (docs/design/PARACHUTE-SOURCE.md)
    await addAndAllow(page);

    // the person's vaults (three at home), then one: its types with how many records each has
    const v = vaultUi(page);
    await v.getByRole("button", { name: new RegExp(`^${VAULT}`) }).click();
    const types = v.getByRole("region", { name: "Types" });
    await expect(types.getByRole("button", { name: /shelfbook.*30/ })).toBeVisible();
    await types.getByRole("button", { name: /shelfbook/ }).click();

    // the type's records as a table: its fields are the columns; a header sorts
    const table = v.getByRole("table", { name: "shelfbook" });
    // on a phone the page never grows wider than the screen: the table scrolls across inside itself, and the new
    // record's name and its Add stay in view (T-476 stranger walk: Add was off the right edge)
    await expect(table).toBeVisible();
    const widths = await v.locator("body").evaluate((b) => ({ page: b.ownerDocument.documentElement.scrollWidth, screen: b.ownerDocument.documentElement.clientWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.screen);
    expect(await v.getByRole("button", { name: "Add", exact: true }).evaluate((b) => b.getBoundingClientRect().right <= b.ownerDocument.documentElement.clientWidth)).toBe(true);
    // the table scrolls across inside itself (not squashed, not clipped)
    expect(await table.evaluate((t) => t.scrollWidth > t.clientWidth)).toBe(true);
    await expect(v.getByText(`${VAULT} · 30 records`)).toBeVisible();
    for (const col of ["Name", "author", "shelf status", "pages", "Updated"]) await expect(table.getByRole("columnheader", { name: col })).toBeVisible();
    await table.getByRole("columnheader", { name: "pages" }).getByRole("button").click();
    await expect(table.getByRole("row").nth(1)).toContainText("Book 00");
    await table.getByRole("columnheader", { name: "pages" }).getByRole("button").click();
    await expect(table.getByRole("row").nth(1)).toContainText("Book 29");

    // open one, change a field where it stands: the vault holds the new value
    await table.getByRole("button", { name: "Open Book 29" }).click();
    const rec = v.getByRole("article", { name: "Book 29" });
    await expect(rec.getByText("A made-up book.")).toBeVisible();
    await rec.getByLabel("shelf status").selectOption("read");
    await expect.poll(async () => (await api(hub(), "GET", `records/${made[29]}`)).fields.shelf_status).toBe("read");

    // an AI writes a record of the type over MCP (create-record, with the access a person grants): it appears, no reload
    await rec.getByRole("button", { name: /Close/ }).click();
    await record(hub(), "create", { path: "Shelf/Written by the AI", body: "From the AI.", types: ["shelfbook"], fields: { author: "An AI", shelf_status: "to-read", pages: 7 } });
    const [ai] = await api(hub(), "GET", `notes?path=${encodeURIComponent("Shelf/Written by the AI")}`);
    made.push(ai.id);
    await expect(table.getByRole("button", { name: "Open Written by the AI" })).toBeVisible({ timeout: 15_000 });
    // and counts at once (it said 30 until the type was opened again)
    await expect(v.getByText(`${VAULT} · 31 records`)).toBeVisible();

    // links both ways: Book 00 links to Book 01, so Book 01 says it is linked from Book 00
    await table.getByRole("button", { name: "Open Book 01" }).click();
    await expect(v.getByRole("region", { name: "Linked from" }).getByRole("button", { name: /Book 00/ })).toBeVisible();

    // publishing asks on the app's own sheet (the applet can't answer it): Cancel leaves it private, Publish makes it
    // readable by anyone with its link (an unsigned read of the hub's page for it), Unpublish takes that back
    const unsigned = async () => (await fetch(`${hub().origin}/vault/${VAULT}/view/${made[1]}`)).status;
    expect(await unsigned()).not.toBe(200);
    await v.getByRole("button", { name: "Publish" }).click();
    const sheet = page.getByRole("dialog", { name: "Publish “Shelf/Book 01”?" });
    await expect(sheet).toContainText("Anyone with its link can read “Shelf/Book 01”");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await unsigned()).not.toBe(200);
    await v.getByRole("button", { name: "Publish" }).click();
    await page.waitForTimeout(800);
    await page.getByRole("dialog", { name: "Publish “Shelf/Book 01”?" }).getByRole("button", { name: "Publish" }).click();
    await expect.poll(unsigned).toBe(200);
    // and its link shows, to copy and send (T-476 stranger walk: "anyone with its link", and no link); a hub on this
    // computer's own address says the link opens here only
    const link = `${hub().origin}/vault/${VAULT}/view/${made[1]}`;
    await expect(v.getByText(link, { exact: true })).toBeVisible();
    await expect(v.getByText("Only this computer can open it")).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await v.getByRole("button", { name: "Copy link" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await v.getByRole("button", { name: "Unpublish" }).click();
    await expect.poll(unsigned).not.toBe(200);
  });

  test("a record no other applet opens opens in Vault; one an applet opens still goes there", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    await addAndAllow(page);
    const target = made[3];
    await page.goto("/");
    await page.goto(`/v/${VAULT}/n/${target}`);
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}&record=${target}`));
    // Parachute's own runs without waiting for a tap (docs/design/PARACHUTE-SOURCE.md)
    await expect(vaultUi(page).getByRole("article", { name: "Book 03" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Vault" })).toHaveCount(0);
    // a recipe, which Recipe box and Cook mode open, still goes to them: not to Vault
    const [toast] = await api(hub(), "GET", `notes?path=${encodeURIComponent("Recipes/Tomato toast")}`);
    await page.goto(`/v/${VAULT}/n/${toast.id}`);
    await expect(ui(page).locator(".open-line")).toContainText("can open this.");
    await expect(page).toHaveURL(new RegExp(`/n/${toast.id}$`));
    // a vault's own address opens it in Vault too
    await page.goto(`/v/${VAULT}`);
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}$`));
    await expect(vaultUi(page).getByRole("region", { name: "Types" })).toBeVisible();
  });

  test("a tap on a record opens it in Vault, running; a second tap switches it", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    await addAndAllow(page);
    // the plain vault view, asked for, lists the records as links: a tap there is a person's tap
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("link", { name: /^Book 05\b/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}&record=${made[5]}`));
    await expect(vaultUi(page).getByRole("article", { name: "Book 05" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Vault" })).toHaveCount(0);
    // back to the list, another tap: the Vault that is running switches to it
    await page.goBack();
    await ui(page).getByRole("link", { name: /^Book 06\b/ }).first().click();
    await expect(vaultUi(page).getByRole("article", { name: "Book 06" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Vault" })).toHaveCount(0);
  });

  test("a record's words, a tag, a field and its history; a saved view; a new type; Revoke on the app's sheet", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    await addAndAllow(page);
    const v = vaultUi(page);
    await v.getByRole("button", { name: new RegExp(`^${VAULT}`) }).click();
    await v.getByRole("region", { name: "Types" }).getByRole("button", { name: /shelfbook/ }).click();
    const table = v.getByRole("table", { name: "shelfbook" });
    // a filter saved as a view: a record in Parachute/Views/, and a tab
    await v.getByRole("button", { name: /^Filter/ }).click();
    await v.getByLabel("shelf status").selectOption("read");
    // only "read" (not to-read, not reading) in the status column
    await expect.poll(async () => [...new Set(await table.getByRole("row").locator(".pa-tcell:nth-child(3)").allTextContents())].filter((x) => x !== "shelf status")).toEqual(["read"]);
    await v.getByLabel("Save this view").fill("Read ones");
    await v.getByRole("button", { name: "Save", exact: true }).click();
    await expect(v.getByRole("button", { name: "Read ones" })).toBeVisible();
    const [view] = await api(hub(), "GET", `notes?path=${encodeURIComponent("Parachute/Views/shelfbook/Read ones")}`);
    expect(view.metadata?.view ?? view.fields?.view).toMatchObject({ where: [{ field: "shelf_status", op: "eq", value: "read" }] });
    // a record: its words edited, a tag added and taken away, a field added; its history then has the old words
    await v.getByRole("button", { name: /^Filter/ }).click();
    await table.getByRole("button", { name: "Open Book 02" }).click();
    const rec = v.getByRole("article", { name: "Book 02" });
    const book2 = async () => (await api(hub(), "GET", `notes?path=${encodeURIComponent("Shelf/Book 02")}&include_content=true`))[0];
    await rec.getByRole("button", { name: "Edit words" }).click();
    await rec.getByLabel("The record's words").fill("New words for book two.");
    await rec.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await book2()).content).toBe("New words for book two.");
    // the record as read again after the save (a change goes to the version it was read at)
    await expect(rec.getByText("New words for book two.")).toBeVisible();
    await expect(rec.getByRole("button", { name: "Edit words" })).toBeVisible();
    await rec.getByLabel("Add a tag or type").fill("#fav");
    await rec.getByRole("button", { name: "Add" }).first().click();
    await expect(rec.getByText("#fav")).toBeVisible();
    await expect.poll(async () => (await book2()).tags).toContain("fav");
    await rec.getByLabel("Add a field").fill("isbn");
    await rec.getByRole("button", { name: "Add" }).last().click();
    await expect.poll(async () => Object.keys((await book2()).metadata ?? {})).toContain("isbn");
    await rec.getByRole("button", { name: "Show history" }).click();
    // the oldest kept version has the words it was made with
    await rec.getByRole("region", { name: "Versions" }).getByRole("button").last().click();
    await expect(rec.getByText(/As it was before/)).toBeVisible();
    await expect(rec.getByText("A made-up book.")).toBeVisible();
    // a new type, made with its first record
    await rec.getByRole("button", { name: "← Close" }).click();
    await v.getByRole("button", { name: new RegExp(`${VAULT}$`) }).first().click();
    await v.getByLabel("New type").fill("seedling");
    await v.getByRole("button", { name: "Make" }).click();
    await expect(v.getByRole("article", { name: "First seedling" })).toBeVisible();
    const types = await api(hub(), "GET", "types");
    expect(types.some((t: { name: string; kind: string }) => t.name === "seedling" && t.kind === "type")).toBe(true);
    // Sharing: Revoke asks on the app's own sheet; yes takes an applet's access back here (Vault itself is Parachute's
    // own: it has no grant to take back, docs/design/PARACHUTE-SOURCE.md)
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const recipes = page.url();
    await page.goto(`/vault?vault=${VAULT}`);
    await v.getByRole("button", { name: "Sharing" }).click();
    const allowed = v.getByRole("region", { name: "Applets you allowed here" });
    await expect(allowed).not.toContainText("Vault");
    await allowed.getByRole("listitem").filter({ hasText: "Recipe box" }).getByRole("button", { name: "Revoke" }).click();
    const sheet = page.getByRole("dialog", { name: "Revoke Recipe box?" });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(800);
    await sheet.getByRole("button", { name: "Revoke" }).click();
    await expect(sheet).toHaveCount(0);
    await page.goto(recipes);
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
  });
});
