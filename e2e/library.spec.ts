// Library applet (applets/library.json + library.tsx): runs in the sealed frame against a real local hub.
// Public-domain fixtures only (Walden by Henry David Thoreau, Meditations by Marcus Aurelius).
// Exercises: Allow, Shelf (covers + Reading now), Book (parts, contents, chapter summaries, Details),
// Read (reading serif, attached picture via vault.file, Summary drawer, text selection -> Quote with note,
// marked quote in text, writing `at` when leaving chapter), and Quotes (grouped by book, opening at place).
// Set LIBRARY_SHOTS=<dir> to capture 390x844 and 1440x900 walkthrough screenshots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "./test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";
import {
  FIXTURE_PATHS,
  MEDITATIONS_CH1_BODY,
  MEDITATIONS_CH2_BODY,
  WALDEN_CH1_BODY,
  WALDEN_CH3_BODY,
  WALDEN_SUMMARIES,
  meditationsBookBody,
  meditationsCoverPng,
  waldenBookBody,
  waldenCh2Body,
  waldenCoverPng,
  waldenPondPng,
} from "./fixtures/library/books";

test.use({ storageState: "e2e/.signed-in.json" });

const SHOTS = process.env.LIBRARY_SHOTS || "";
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

async function shot(page: Page, name: string, width: number, height: number) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

test("Library applet: Shelf, Book, Read (pictures, summary, select->Quote, marks, reading stop), Quotes", async ({ page }) => {
  test.setTimeout(120_000);
  const r = appletRecord("library");
  const h = hubState();
  const createdIds: string[] = [];

  const uploadPng = async (buf: Buffer, filename: string): Promise<string> => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: "image/png" }), filename);
    const up = await fetch(`${h.origin}/vault/${VAULT}/api/storage/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${h.token}` },
      body: form,
    });
    expect(up.status).toBeLessThan(300);
    return String(((await up.json()) as { path: string }).path).replace(/^\/?(api\/storage\/)?/, "");
  };

  const seed = async (
    path: string,
    content: string,
    tags: string[],
    metadata: Record<string, unknown> = {},
    extension?: string,
  ): Promise<{ id: string; path: string }> => {
    const n = await api(h, "POST", "notes", {
      path,
      content,
      tags,
      metadata,
      ...(extension ? { extension } : {}),
    });
    createdIds.push(n.id);
    return n as { id: string; path: string };
  };

  try {
    const applet = await seed(r.path, r.body, r.tags, r.fields, r.extension);

    // Upload public-domain fixture cover art and chapter illustration
    const waldenCover = await uploadPng(waldenCoverPng(), "walden-cover.png");
    const waldenPond = await uploadPng(waldenPondPng(), "walden-pond.png");
    const medCover = await uploadPng(meditationsCoverPng(), "meditations-cover.png");

    // Seed Walden (2 parts, 3 chapters, cover + inline chapter picture, summaries)
    const waldenBook = await seed(
      FIXTURE_PATHS.walden.bookPath,
      waldenBookBody(`/api/storage/${waldenCover}`),
      ["book"],
      {
        author: "Henry David Thoreau",
        language: "en",
        kind: "book",
        status: "reading",
        rights: "Public domain",
        at: `${FIXTURE_PATHS.walden.ch1Path}#p2`,
      },
    );
    await api(h, "POST", `notes/${waldenBook.id}/attachments`, { path: waldenCover, mimeType: "image/png" });

    await seed(
      FIXTURE_PATHS.walden.partOnePath,
      "# Part One – By the Pond\n\nLife beside the water in Concord.\n",
      ["chapter"],
      { book: FIXTURE_PATHS.walden.bookPath, order: 0, words: 12 },
    );
    await seed(
      FIXTURE_PATHS.walden.ch1Path,
      WALDEN_CH1_BODY,
      ["chapter"],
      { book: FIXTURE_PATHS.walden.bookPath, part: FIXTURE_PATHS.walden.partOnePath, order: 1, words: 138 },
    );
    const waldenCh2 = await seed(
      FIXTURE_PATHS.walden.ch2Path,
      waldenCh2Body(`/api/storage/${waldenPond}`),
      ["chapter"],
      { book: FIXTURE_PATHS.walden.bookPath, part: FIXTURE_PATHS.walden.partOnePath, order: 2, words: 214 },
    );
    await api(h, "POST", `notes/${waldenCh2.id}/attachments`, { path: waldenPond, mimeType: "image/png" });

    await seed(
      FIXTURE_PATHS.walden.partTwoPath,
      "# Part Two – The Quiet\n\nEvening walks and solitude.\n",
      ["chapter"],
      { book: FIXTURE_PATHS.walden.bookPath, order: 3, words: 9 },
    );
    await seed(
      FIXTURE_PATHS.walden.ch3Path,
      WALDEN_CH3_BODY,
      ["chapter"],
      { book: FIXTURE_PATHS.walden.bookPath, part: FIXTURE_PATHS.walden.partTwoPath, order: 4, words: 185 },
    );

    await seed(FIXTURE_PATHS.walden.bookSummaryPath, WALDEN_SUMMARIES.book, ["summary"], {
      of: FIXTURE_PATHS.walden.bookPath,
      by: "Fixture",
      made: "2026-11-01",
    });
    await seed(FIXTURE_PATHS.walden.ch1SummaryPath, WALDEN_SUMMARIES.ch1, ["summary"], {
      of: FIXTURE_PATHS.walden.ch1Path,
      by: "Fixture",
      made: "2026-11-01",
    });
    await seed(FIXTURE_PATHS.walden.ch2SummaryPath, WALDEN_SUMMARIES.ch2, ["summary"], {
      of: FIXTURE_PATHS.walden.ch2Path,
      by: "Fixture",
      made: "2026-11-01",
    });
    await seed(FIXTURE_PATHS.walden.ch3SummaryPath, WALDEN_SUMMARIES.ch3, ["summary"], {
      of: FIXTURE_PATHS.walden.ch3Path,
      by: "Fixture",
      made: "2026-11-01",
    });

    // Seed Meditations (2 chapters, cover, summary, 1 seed quote)
    const medBook = await seed(
      FIXTURE_PATHS.meditations.bookPath,
      meditationsBookBody(`/api/storage/${medCover}`),
      ["book"],
      {
        author: "Marcus Aurelius",
        translator: "George Long",
        language: "en",
        kind: "book",
        status: "want to read",
        rights: "Public domain",
      },
    );
    await api(h, "POST", `notes/${medBook.id}/attachments`, { path: medCover, mimeType: "image/png" });

    await seed(FIXTURE_PATHS.meditations.ch1Path, MEDITATIONS_CH1_BODY, ["chapter"], {
      book: FIXTURE_PATHS.meditations.bookPath,
      order: 1,
      words: 72,
    });
    await seed(FIXTURE_PATHS.meditations.ch2Path, MEDITATIONS_CH2_BODY, ["chapter"], {
      book: FIXTURE_PATHS.meditations.bookPath,
      order: 2,
      words: 68,
    });
    await seed(FIXTURE_PATHS.meditations.ch1SummaryPath, "Gratitude for family and teachers who shaped character and restraint.", ["summary"], {
      of: FIXTURE_PATHS.meditations.ch1Path,
      by: "Fixture",
      made: "2026-11-01",
    });
    await seed(
      FIXTURE_PATHS.meditations.quotePath,
      "> Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.\n\nA reminder for quiet mornings.\n",
      ["quote"],
      {
        book: FIXTURE_PATHS.meditations.bookPath,
        from: FIXTURE_PATHS.meditations.ch1Path,
        block: 3,
        before: "Look within.",
        after: "",
        by: "Marcus Aurelius",
      },
    );

    // 1. Open Library applet and allow access
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Books/");
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Quotes/");
    await page.getByRole("button", { name: "Allow" }).click();

    const f = frame(page);
    await expect(f.getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });

    // 2. Shelf: verify covers load and "Reading now" shows Walden
    await expect(f.getByRole("region", { name: "Reading now" })).toContainText("Walden");
    await expect(f.getByRole("region", { name: "Reading now" })).toContainText("Stopped at Economy");
    const waldenCoverImg = f.getByRole("img", { name: "Walden cover" }).first();
    await expect(waldenCoverImg).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => waldenCoverImg.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBe(180);
    const medCoverImg = f.getByRole("img", { name: "Meditations cover" }).first();
    await expect.poll(() => medCoverImg.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBe(180);

    await shot(page, "library-01-shelf-390", 390, 844);
    await shot(page, "library-01-shelf-1440", 1440, 900);
    await page.setViewportSize({ width: 390, height: 844 });

    // 3. Book view: open Walden -> verify parts, contents, chapter summaries, and book summary
    await f.getByRole("region", { name: "Reading now" }).getByRole("button", { name: "Contents" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Walden" })).toBeVisible();
    await expect(f.getByText("Henry David Thoreau")).toBeVisible();
    await expect(f.getByText("Part One - By the Pond").first()).toBeVisible();
    await expect(f.getByText(/Explains the purpose of moving to the woods/)).toBeVisible();
    await expect(f.getByText("Where you stopped · ¶ 2")).toBeVisible();

    await shot(page, "library-02-book-390", 390, 844);
    await shot(page, "library-02-book-1440", 1440, 900);
    await page.setViewportSize({ width: 390, height: 844 });

    // 4. Read view: open Chapter 2 ("Where I Lived, and What I Lived For")
    await f.getByRole("button", { name: /Where I Lived, and What I Lived For/ }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Where I Lived, and What I Lived For" })).toBeVisible();

    // Verify inline chapter picture loads via vault.file
    const pondImg = f.getByRole("img", { name: "Walden Pond at dawn" });
    await expect(pondImg).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => pondImg.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBe(320);

    // Tap Summary (a tap away) -> drawer shows chapter summary
    await f.getByRole("button", { name: "Summary" }).click();
    const sumDialog = f.getByRole("dialog", { name: "Chapter summary" });
    await expect(sumDialog).toBeVisible();
    await expect(sumDialog).toContainText("live deliberately, simplify affairs");
    await page.keyboard.press("Escape");
    await expect(sumDialog).toHaveCount(0);

    // Select a passage in Chapter 2 and mark a quote with a note
    const targetPhrase = "to front only the essential facts of life";
    const iframeEl = await page.locator("iframe.applet-frame:visible").elementHandle();
    const contentFrame = await iframeEl!.contentFrame();
    const selectedOk = await contentFrame!.evaluate((phrase) => {
      const reader = document.querySelector(".lib-reader .pa-note");
      if (!reader) return false;
      const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const val = n.nodeValue ?? "";
        const idx = val.indexOf(phrase);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(n, idx);
          range.setEnd(n, idx + phrase.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          return true;
        }
      }
      return false;
    }, targetPhrase);
    expect(selectedOk).toBe(true);

    // Tap Quote in the floating selection bar, add a note, and save
    await f.getByRole("button", { name: "Quote", exact: true }).click();
    const quoteDialog = f.getByRole("dialog", { name: "Mark quote" });
    await expect(quoteDialog).toBeVisible();
    await expect(quoteDialog).toContainText(targetPhrase);
    await quoteDialog.getByRole("textbox").fill("Core intention of Walden.");
    await quoteDialog.getByRole("button", { name: "Save quote" }).click();
    await expect(quoteDialog).toHaveCount(0);

    // Verify the quote is now marked directly in the chapter text
    const mark = f.locator("mark.lib-mark").first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await expect(mark).toHaveText(targetPhrase);

    // the record is a `quote` (the door tags it with the type the card opens in Quotes/), linked to its chapter and book
    const saved = ((await api(h, "GET", "notes?path_prefix=Quotes/Walden/&include_metadata=true")) as { tags?: string[]; metadata?: Record<string, unknown> }[]);
    expect(saved).toHaveLength(1);
    expect(saved[0].tags).toContain("quote");
    expect(saved[0].metadata).toMatchObject({ from: FIXTURE_PATHS.walden.ch2Path, book: FIXTURE_PATHS.walden.bookPath, block: expect.any(Number) });

    // the summary a tap away after a save: the chapter's text and its mark stay as they were
    await f.getByRole("button", { name: "Summary" }).click();
    await expect(f.getByRole("dialog", { name: "Chapter summary" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(f.locator("mark.lib-mark")).toHaveCount(1);
    await expect(f.locator("mark.lib-mark").first()).toHaveText(targetPhrase);

    await shot(page, "library-03-read-390", 390, 844);
    await shot(page, "library-03-read-1440", 1440, 900);
    await page.setViewportSize({ width: 390, height: 844 });

    // Tapping the mark opens the Marked quote drawer with the saved note
    await mark.click();
    const viewDialog = f.getByRole("dialog", { name: "Marked quote" });
    await expect(viewDialog).toBeVisible();
    await expect(viewDialog).toContainText("Core intention of Walden.");
    await page.keyboard.press("Escape");
    await expect(viewDialog).toHaveCount(0);

    // On to the next chapter: the book says you are at its start (and only that: no older place written after it)
    const waldenAt = async () => String((await api(h, "GET", `notes/${waldenBook.id}`)).metadata?.at ?? "");
    await f.getByRole("button", { name: /Part Two - The Quiet →/ }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Part Two - The Quiet" })).toBeVisible();
    await expect.poll(waldenAt, { timeout: 15_000 }).toBe(`${FIXTURE_PATHS.walden.partTwoPath}#p1`);
    await page.waitForTimeout(1500);
    expect(await waldenAt()).toBe(`${FIXTURE_PATHS.walden.partTwoPath}#p1`);

    // Back to chapter 2, then leave it: where we stopped is written to Walden's `at` on the hub
    await f.getByRole("button", { name: /← Where I Lived/ }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Where I Lived, and What I Lived For" })).toBeVisible();
    await f.getByRole("button", { name: "← Walden" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Walden" })).toBeVisible();
    await expect.poll(waldenAt, { timeout: 15_000 }).toMatch(/^Books\/Walden\/02 Where I Lived, and What I Lived For#p\d+$/);

    // 5. Quotes tab: grouped by book, and tapping a quote opens the chapter at its marked place
    await f.getByRole("button", { name: "← Shelf" }).click();
    await f.getByRole("button", { name: /Quotes/ }).click();
    await expect(f.getByRole("region", { name: /Walden · 1/ })).toContainText(targetPhrase);
    await expect(f.getByRole("region", { name: /Meditations · 1/ })).toContainText("fountain of good");

    await shot(page, "library-04-quotes-390", 390, 844);
    await shot(page, "library-04-quotes-1440", 1440, 900);
    await page.setViewportSize({ width: 390, height: 844 });

    // Tap the Walden quote -> opens Chapter 2 with focused mark
    await f.getByRole("region", { name: /Walden · 1/ }).getByRole("button").first().click();
    await expect(f.locator("header").getByRole("heading", { name: "Where I Lived, and What I Lived For" })).toBeVisible();
    const focusedMark = f.locator("mark.lib-mark.lib-mark-focus").first();
    await expect(focusedMark).toBeVisible({ timeout: 15_000 });
    await expect(focusedMark).toHaveText(targetPhrase);
  } finally {
    // Clean up any quotes created during the test plus all seeded records
    const quotes = (await api(h, "GET", "notes?path_prefix=Quotes/&limit=50").catch(() => [])) as { id: string }[];
    for (const q of Array.isArray(quotes) ? quotes : []) {
      if (!createdIds.includes(q.id)) await api(h, "DELETE", `notes/${q.id}`).catch(() => {});
    }
    for (const id of createdIds.reverse()) {
      await api(h, "DELETE", `notes/${id}`).catch(() => {});
    }
  }
});
