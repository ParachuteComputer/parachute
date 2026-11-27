// Library reading an imported book cleanly (T-531): a made-up sūtra book (tools/library-import/make_test_epub.py
// --sutras) with the shapes a real import showed, imported by the real importer into the real hub of e2e/hub.ts, and
// read in Library as a person would, on a phone. Set LIBRARY_SHOTS=<dir> for phone (412x915) and desktop (1440x900)
// screenshots of the book's contents, its printed Contents, a verse page and a long chapter.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "./test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const SHOTS = process.env.LIBRARY_SHOTS || "";
const TOOLS = join(import.meta.dirname, "..", "tools", "library-import");
const BOOK = "Books/The Made-up Sutras";
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, tag] of [[412, 915, "phone"], [1440, 900, "desktop"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `${name}-${tag}.png`) });
  }
  await page.setViewportSize({ width: 412, height: 915 });
}

type Rec = { id: string; path: string };

async function cleanup(made: string[]) {
  const h = hubState();
  const books = ((await api(h, "GET", `notes?path_prefix=${encodeURIComponent(BOOK)}&limit=500`).catch(() => [])) as Rec[]);
  const receipts = ((await api(h, "GET", "notes?path_prefix=Parachute%2FReceipts%2Fbook-the-made-up-sutras&limit=5").catch(() => [])) as Rec[]);
  for (const r of [...books, ...receipts]) made.push(r.id);
  for (const id of [...new Set(made)].reverse()) await api(h, "DELETE", `notes/${id}`).catch(() => {});
}

test("Library reads an imported sūtra book cleanly: contents links, headings, verses, pictures", async ({ page }) => {
  test.setTimeout(180_000);
  const h = hubState();
  const made: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "library-reading-"));
  try {
    const rest = await fetch(`${h.origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${h.token}` } });
    test.skip(rest.status === 404 && process.env.E2E_CORE_NEXT !== "1", "the importer writes through core 0.9's record door");
    const epub = join(dir, "sutras.epub");
    execFileSync("python3", ["-I", join(TOOLS, "make_test_epub.py"), epub, "--sutras"]);
    const key = join(dir, "key");
    writeFileSync(key, h.token, { mode: 0o600 });
    execFileSync("python3", ["-I", join(TOOLS, "import_book.py"), epub, "--vault", VAULT, "--hub", h.origin, "--token-file", key], { stdio: "pipe" });

    const r = appletRecord("library");
    const applet = await api(h, "POST", "notes", { path: r.path, content: r.body, tags: r.tags, metadata: r.fields, extension: r.extension });
    made.push(applet.id);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = frame(page);
    await expect(f.getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });

    // the book's own page: its contents
    await f.getByRole("button", { name: /The Made-up Sutras/ }).first().click();
    await expect(f.locator("header").getByRole("heading", { name: "The Made-up Sutras" })).toBeVisible();
    await shots(page, "01-book");

    // the printed Contents
    const row = (name: RegExp) => f.getByRole("button", { name }).first();
    await row(/^Contents.*\d+ w/).click();
    await expect(f.locator(".lib-reader .pa-note")).toBeVisible();
    await shots(page, "02-contents");

    // a verse page: the first part's opening
    await f.getByRole("button", { name: /The Made-up Sutras/ }).first().click();
    await row(/^(Book One|Part opening).*\d+ w/).click();
    await expect(f.locator(".lib-reader .pa-note")).toContainText("Portion on Beginning");
    await shots(page, "03-verse");

    // further into a long chapter: verse 12's commentary
    const verse12 = f.locator(".lib-reader .pa-note p", { hasText: "On verse 12, part 1" }).first();
    await verse12.scrollIntoViewIfNeeded();
    await shots(page, "04-long");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await cleanup(made);
  }
});
