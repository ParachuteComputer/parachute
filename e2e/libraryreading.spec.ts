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
  books.push(...((await api(h, "GET", `notes?path_prefix=${encodeURIComponent("Books/An Old Import")}&limit=50`).catch(() => [])) as Rec[]));
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

    // a book imported before these fixes (seeded as it was written then; read at the end)
    const OLD = "Books/An Old Import";
    made.push((await api(h, "POST", "notes", { path: OLD, content: "# An Old Import\n", tags: ["book"], metadata: { author: "Sam Example" } })).id);
    made.push((await api(h, "POST", "notes", { path: `${OLD}/05 Book One`, tags: ["chapter"], metadata: { book: OLD, order: 5, words: 60 },
      content: ["### *Book One*", "### ***Ārambha Pāda***", "#### *Portion on Beginning*", "This first book sets out the ground.",
        "**1. Tīśa yarasa vipra.**", "**tīśa** = stillness; **yarasa** = the river;", "**Stillness rests in the river.**",
        "#### *A Note on the Words*", "The commentary follows.", "[[Books/An Old Import/09 Gone|Gone\\\n*Chapter*]] stays words."].join("\n\n") })).id);
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

    // the book's own contents: short front matter is one record, the long first part is cut at its verses
    const toc = await f.locator("body").innerText();
    for (const gone of ["Dedication", "Copyright", "Books by the Same"]) expect(toc).not.toContain(gone);
    await expect(f.getByRole("button", { name: /^Verses 1–5/ })).toBeVisible();

    // the printed Contents: each entry one clean link, the line with no link plain words
    const row = (name: RegExp) => f.getByRole("button", { name }).first();
    await row(/^Contents.*\d+ w/).click();
    const prose = f.locator(".lib-reader .pa-note");
    await expect(prose).toBeVisible();
    await expect(prose.locator("a")).toHaveText(["Foreword", "Book One – Ārambha Pāda (Portion on Beginning)",
      "Book Two – Sādhana Pāda (Portion on Practice)", "Glossary of Made-up Terms"]);
    await expect(prose).not.toContainText("[[");
    await expect(prose).not.toContainText("*");
    await expect(prose.getByText("Index", { exact: true })).toBeVisible();
    await shots(page, "02-contents");

    // a link in it opens the part; its opening says what it is, with no heading that repeats the title
    await prose.getByRole("link", { name: /^Book One/ }).click();
    await expect(f.locator("header").getByRole("heading", { name: /^Book One – Ārambha Pāda/ })).toBeVisible();
    await expect(prose).toContainText("This first book sets out the ground");
    await expect(prose.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(0);

    // a verse page: verses 1-5, no ornament before each verse, the same space between every paragraph
    await f.getByRole("button", { name: /^Verses 1–5 →/ }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Verses 1–5" })).toBeVisible();
    await expect(prose).toContainText("1. Tīśa yarasa vipra.");
    await expect(prose.locator("img")).toHaveCount(0);
    await shots(page, "03-verse");
    const gaps = await prose.evaluate((el) => {
      const blocks = [...el.querySelectorAll("p")].filter((p) => (p.textContent ?? "").trim());
      return blocks.slice(1).map((p, i) => Math.round(p.getBoundingClientRect().top - blocks[i].getBoundingClientRect().bottom));
    });
    expect(Math.max(...gaps) - Math.min(...gaps), `gaps between paragraphs: ${gaps.join(" ")}`).toBeLessThanOrEqual(2);

    // the last verses, with the book's one real picture: as much space around it as around a paragraph, give or take
    await f.getByRole("button", { name: /The Made-up Sutras/ }).first().click();
    await row(/^Verses 26–30.*\d+ w/).click();
    const pic = prose.getByRole("img", { name: "A diagram of the four streams" });
    await expect(pic).toBeVisible({ timeout: 20_000 });
    await pic.scrollIntoViewIfNeeded();
    const around = await pic.evaluate((img) => {
      const box = (img.closest("p, figure") ?? img) as HTMLElement;
      const prev = box.previousElementSibling as HTMLElement, next = box.nextElementSibling as HTMLElement;
      const r = img.getBoundingClientRect();
      const gap = (a: DOMRect, b: DOMRect) => Math.round(b.top - a.bottom);
      const p = [...document.querySelectorAll(".lib-reader .pa-note p")].filter((x) => (x.textContent ?? "").trim()).slice(0, 2);
      return { above: gap(prev.getBoundingClientRect(), r), below: gap(r, next.getBoundingClientRect()),
        para: gap(p[0].getBoundingClientRect(), p[1].getBoundingClientRect()), html: box.outerHTML.slice(0, 300) };
    });
    console.log("around the picture", JSON.stringify(around));
    for (const g of [around.above, around.below]) expect(g, JSON.stringify(around)).toBeLessThanOrEqual(around.para * 2.2);
    await shots(page, "04-long");

    // a book imported before these fixes keeps its old shape until it is imported again: stacked headings wrapped in
    // emphasis (`### *Book One*`, `#### *Portion…*`) are drawn plain, with even space between them
    await f.getByRole("button", { name: /The Made-up Sutras/ }).first().click();
    await f.getByRole("button", { name: /Shelf/ }).first().click();
    await f.getByRole("button", { name: /An Old Import/ }).first().click();
    await row(/^Book One.*\d+ w/).click();
    await expect(prose).toContainText("This first book sets out the ground");
    await expect(prose).not.toContainText("*");
    await expect(prose.locator("a")).toHaveCount(0);
    await expect(prose).toContainText("Gone – Chapter stays words.");
    const spacing = await prose.evaluate((el) => {
      const kids = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6, p")].filter((x) => (x.textContent ?? "").trim());
      const gap = (i: number) => Math.round(kids[i + 1].getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom);
      const pairs = kids.slice(0, -1).map((k, i) => [`${k.tagName}>${kids[i + 1].tagName}`, gap(i)] as const);
      return pairs;
    });
    console.log("old-shape spacing", JSON.stringify(spacing));
    const of = (kind: (a: string, b: string) => boolean) => spacing.filter(([k]) => kind(...(k.split(">") as [string, string]))).map(([, g]) => g);
    const isH = (t: string) => /^H\d$/.test(t);
    for (const group of [of((a, b) => isH(a) && isH(b)), of((a, b) => isH(a) && b === "P"), of((a, b) => a === "P" && b === "P")]) {
      expect(Math.max(...group) - Math.min(...group), JSON.stringify(spacing)).toBeLessThanOrEqual(2);
    }
    await shots(page, "05-old-import");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await cleanup(made);
  }
});
