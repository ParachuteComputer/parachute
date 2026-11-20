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
/** Vault in the home vault and allowed in this browser: added with its one tap when it isn't there yet. */
async function addAndAllow(page: Page) {
  await page.goto("/vault");
  const add = page.getByRole("button", { name: "Add Vault" }), allow = page.getByRole("button", { name: "Allow" });
  await expect(add.or(allow)).toBeVisible();
  if (await add.isVisible()) await add.click();
  await allow.click();
  await expect(vaultUi(page).getByRole("heading", { level: 1 })).toBeVisible();
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
  if (await typed()) await api({ ...hub(), token: mintToken(`vault:${VAULT}:admin`) }, "DELETE", "types/shelfbook").catch(() => {});
}

test.describe("Vault", () => {
  test.beforeAll(async () => { await cleanup(); if (await typed()) await seed(); });
  test.afterAll(cleanup);

  test("before it is added, a record opens plain, with a line that adds Vault", async ({ page }) => {
    const [plain] = await api(hub(), "GET", "notes?path_prefix=Shelf%2F&limit=1");
    test.skip(!plain, "no typed records on this core");
    await page.goto(`/v/${VAULT}/n/${plain.id}`);
    await expect(ui(page).getByRole("heading", { name: plain.path.split("/").pop() })).toBeVisible();
    await expect(ui(page).getByRole("link", { name: /See its fields, types, links and history in Vault: add it/ })).toBeVisible();
  });

  test("add it, allow it; browse a type's table, open a record, change a field; what an AI writes appears", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    await page.goto("/vault");
    await page.getByRole("button", { name: "Add Vault" }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("See every record in every vault on this device");
    await expect(card).toContainText("See what reaches each vault");
    await page.getByRole("button", { name: "Allow" }).click();

    // the person's vaults (three at home), then one: its types with how many records each has
    const v = vaultUi(page);
    await v.getByRole("button", { name: new RegExp(`^${VAULT}`) }).click();
    const types = v.getByRole("region", { name: "Types" });
    await expect(types.getByRole("button", { name: /shelfbook.*30/ })).toBeVisible();
    await types.getByRole("button", { name: /shelfbook/ }).click();

    // the type's records as a table: its fields are the columns; a header sorts
    const table = v.getByRole("table", { name: "shelfbook" });
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

    // links both ways: Book 00 links to Book 01, so Book 01 says it is linked from Book 00
    await table.getByRole("button", { name: "Open Book 01" }).click();
    await expect(v.getByRole("region", { name: "Linked from" }).getByRole("button", { name: /Book 00/ })).toBeVisible();

    // publishing asks on the app's own sheet (the applet can't answer it); No leaves it private, Publish publishes
    await v.getByRole("button", { name: "Publish" }).click();
    const sheet = page.getByRole("dialog", { name: "Publish Book 01?" });
    await expect(sheet).toContainText("Anyone with its link can read Book 01");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    expect((await api(hub(), "GET", `records/${made[1]}`)).tags ?? []).not.toContain("published");
    await v.getByRole("button", { name: "Publish" }).click();
    await page.waitForTimeout(800);
    await page.getByRole("dialog", { name: "Publish Book 01?" }).getByRole("button", { name: "Publish" }).click();
    await expect.poll(async () => (await api(hub(), "GET", `records/${made[1]}`)).tags ?? []).toContain("published");
    await expect(v.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("a record no other applet opens opens in Vault; one an applet opens still goes there", async ({ page }) => {
    test.skip(!(await typed()), "types are core 0.9's");
    await addAndAllow(page);
    const target = made[3];
    await page.goto("/");
    await page.goto(`/v/${VAULT}/n/${target}`);
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}&record=${target}`));
    // arrived by an address, not a tap: it waits for Open (a tap on a record carries on running)
    await page.getByRole("button", { name: "Open Vault" }).click();
    await expect(vaultUi(page).getByRole("article", { name: "Book 03" })).toBeVisible();
    // a recipe, which Recipe box and Cook mode open, still goes to them: not to Vault
    const [toast] = await api(hub(), "GET", `notes?path=${encodeURIComponent("Recipes/Tomato toast")}`);
    await page.goto(`/v/${VAULT}/n/${toast.id}`);
    await expect(ui(page).locator(".open-line")).toContainText("can open this.");
    await expect(page).toHaveURL(new RegExp(`/n/${toast.id}$`));
    // a vault's own address opens it in Vault too
    await page.goto(`/v/${VAULT}`);
    await expect(page).toHaveURL(new RegExp(`/a/[^/?]+\\?vault=${VAULT}$`));
    await page.getByRole("button", { name: "Open Vault" }).click();
    await expect(vaultUi(page).getByRole("region", { name: "Types" })).toBeVisible();
  });
});
