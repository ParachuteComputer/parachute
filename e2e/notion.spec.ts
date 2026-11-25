// Import from Notion (T-476), on a real hub: a person coming from Notion taps Import from Notion in Vault, chooses their
// export (e2e/fixtures/notion-export.zip, a made-up workspace shaped like a real "Markdown & CSV" export) in the app's
// own picker, and their tables land as types with typed fields, their rows as records, their pages as pages with
// working links, all under Notion/<its workspace>/, with a receipt; choosing the same export again changes nothing.
// Needs a hub where write access may define a type over REST (core #139); on an older one it skips, unless
// E2E_CORE_NEXT=1 says this hub is a core that must have it (CI's 0.9.0-pre.2 leg). In the `packs` project (a 403 refreshes the sign-in).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { api, hubState, mintToken, VAULT } from "./hub";
import { signIn } from "./helpers";
import { RECEIPTS } from "../src/kit/packs";

const ZIP = readFileSync(new URL("./fixtures/notion-export.zip", import.meta.url));
const TYPES = ["reading-list", "projects", "tasks", "sketch-log"];
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const hub = () => hubState();
const admin = () => ({ ...hub(), token: mintToken(`vault:${VAULT}:admin`) });
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());

async function restTypes(): Promise<boolean> {
  const probe = `notionprobe${Date.now()}`;
  const r = await fetch(`${hub().origin}/vault/${VAULT}/api/types/${probe}`, { method: "PUT", headers: { authorization: `Bearer ${hub().token}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "type", fields: { x: { type: "string" } } }) });
  if (r.ok) await api(admin(), "DELETE", `types/${probe}`).catch(() => {});
  return r.ok;
}
async function cleanup() {
  const a = admin();
  for (const f of ["Notion/", `${RECEIPTS}notion-`]) for (const n of await api(a, "GET", `notes?path_prefix=${encodeURIComponent(f)}&limit=200`)) await api(a, "DELETE", `notes/${n.id}`).catch(() => {});
  for (const t of TYPES) await api(a, "DELETE", `types/${t}`).catch(() => {});
}
const under = async (prefix: string) => (await api(hub(), "GET", `records?path_prefix=${encodeURIComponent(prefix)}&include_fields=true&limit=200`)) as { id: string; path: string; types: string[]; fields: Record<string, unknown>; updatedAt: string }[];

/** Vault, the vault, Import from Notion, and the export chosen in the app's own picker. */
async function importIt(page: Page) {
  const app = frame(page);
  await app.getByRole("button", { name: "Import from Notion" }).click({ timeout: 30_000 });
  const picker = page.getByRole("dialog", { name: "Vault asks for a file" });
  await expect(picker).toContainText("Parachute reads it and writes it into this vault, under Notion/. At most 200 MB.");
  await picker.locator("input[type=file]").setInputFiles({ name: "Export-0c5e1b7a-notion.zip", mimeType: "application/zip", buffer: ZIP });
  return app;
}

test.describe.serial("Import from Notion", () => {
  test.setTimeout(120_000);
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("a Notion export comes in as tables, rows and pages; the same export again changes nothing", async ({ page }) => {
    test.skip(!(await restTypes()) && process.env.E2E_CORE_NEXT !== "1", "the app makes types over REST: needs core #139");
    await signIn(page);
    await page.goto(`/v/${VAULT}`);
    await expect(page).toHaveURL(/\/a\/parachute%3Avault/);
    await shot(page, "01-vault");
    const app = await importIt(page);
    const said = app.getByRole("region", { name: "What came from Notion" });
    await expect(said).toContainText("From Notion: 4 tables (82 rows), 9 pages and 1 attachment, under Notion/Juno's studio/.", { timeout: 60_000 });
    await shot(page, "02-imported");

    // the vault has them: each table a type with typed fields, each row a record of it, each page at its place
    const types = (await api(hub(), "GET", "types?include_schema=true")) as { name: string; fields: Record<string, { type: string; cardinality?: string }> }[];
    const books = types.find((t) => t.name === "reading-list");
    expect(books?.fields).toMatchObject({ rating: { type: "number" }, finished: { type: "date" }, tags: { type: "array" } });
    expect(types.find((t) => t.name === "tasks")?.fields.project).toMatchObject({ type: "reference", cardinality: "many" });
    const recs = await under("Notion/");
    // 82 rows, 9 pages, 4 tables' own records: more than a frame's 60 reads in 10 s, in one tap
    expect(recs.length).toBe(95);
    // the page headed "@Today" is its row's words, under the row's own name
    const today = recs.find((r) => r.path === "Notion/Juno's studio/Home/Sketch log/@November 21, 2026")!;
    expect(today.fields).toMatchObject({ minutes: 29, subject: "Owls" });
    expect((await api(hub(), "GET", `records/${today.id}`)).body).toContain("owl wings");
    expect(recs.find((r) => r.path === "Notion/Juno's studio/Home/Reading List/Piranesi")).toMatchObject({ types: ["reading-list"], fields: { author: "Susanna Clarke", rating: 5, finished: "2026-07-07" } });
    expect(recs.find((r) => r.path === "Notion/Juno's studio/Home/Tasks/Invoice Little Fern Café")?.fields).toMatchObject({ done: true, project: ["Notion/Juno's studio/Home/Projects/Café menu illustrations"] });
    const home = recs.find((r) => r.path === "Notion/Juno's studio/Home")!;
    expect((await api(hub(), "GET", `records/${home.id}`)).body).toContain("[[Notion/Juno's studio/Home/Reading List]]");
    const ideas = recs.find((r) => r.path === "Notion/Juno's studio/Home/Ideas")!;
    const ideasBody = (await api(hub(), "GET", `records/${ideas.id}`)).body as string;
    expect(ideasBody).toMatch(/!\[owl sketch\]\(\/api\/storage\/.+\)/);
    const ideasAtts = (await api(hub(), "GET", `notes/${ideas.id}/attachments`)) as { mimeType?: string; mime_type?: string }[];
    expect(ideasAtts).toHaveLength(1);
    expect(ideasAtts[0].mimeType ?? ideasAtts[0].mime_type).toBe("image/png");
    const [receipt] = await under(`${RECEIPTS}notion-`);
    expect(receipt.fields.receipt).toMatchObject({ contract: 1, name: "Notion: Export-0c5e1b7a-notion", version: 1 });

    // the table opens from what it said, its rows there
    await said.getByRole("button", { name: "reading-list" }).click();
    await expect(app.getByText("Piranesi")).toBeVisible();
    await shot(page, "03-table");

    // a relation reads as the names of the rows it links in the table; on the record it is its paths, as a list
    await app.getByRole("button", { name: `← ${VAULT}` }).click();
    await app.getByText("projects", { exact: true }).first().click({ timeout: 30_000 });
    const harbor = app.getByRole("row", { name: /Harbor Books cover/ });
    await expect(harbor).toContainText("Send Harbor Books three sketches");
    await expect(harbor).not.toContainText("Notion/");
    await shot(page, "04-reference");
    await harbor.click();
    await expect(app.getByRole("article", { name: /Harbor Books cover/ })).toBeVisible();
    await expect(app.getByRole("textbox", { name: "tasks" })).toHaveValue("Notion/Juno's studio/Home/Tasks/Send Harbor Books three sketches");
    // on the record the list is edited as its paths, one after another, not as text in brackets (`["Notion/Juno's studio/Home/Tasks/…"]`)
    expect(await app.locator("input, textarea").evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value).filter((x) => x.startsWith("[")))).toEqual([]);

    // the same export again: nothing new, nothing changed
    const before = new Map(recs.map((r) => [r.path, r.updatedAt]));
    await page.goto(`/v/${VAULT}`);
    await importIt(page);
    await expect(frame(page).getByRole("region", { name: "What came from Notion" })).toContainText("Already here from Notion", { timeout: 60_000 });
    const after = await under("Notion/");
    expect(after.length).toBe(recs.length);
    for (const r of after) expect(r.updatedAt, r.path).toBe(before.get(r.path));

    // Ideas, found in Vault by its words, with its picture drawn: the record's attachment (above), its bytes handed to
    // the frame by vaults.file (docs/design/PICTURES.md)
    await page.goto(`/v/${VAULT}`);
    await frame(page).getByRole("searchbox", { name: `Search ${VAULT}` }).fill("print series of city birds");
    await frame(page).getByText("Ideas", { exact: true }).first().click({ timeout: 30_000 });
    const owl = frame(page).getByRole("article", { name: "Ideas" }).getByRole("img", { name: "owl sketch" });
    await expect(owl).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => owl.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(frame(page).getByRole("article", { name: "Ideas" })).not.toContainText("not loaded");
    await shot(page, "05-ideas");
  });
});
