// Writing applet end-to-end and keystroke-latency test (T-476):
// Against a real hub: open a piece, type into the quiet editor (saved debounced), see a reference prepared beside it,
// insert it as a quote with a source link, ask Uni (creating a `reference` with `state: asked` and never editing the
// piece), check a published piece's read-only metadata, and verify typing into a long piece stays within the same
// keystroke-to-paint budget as a plain textarea on a phone's CPU.
import { expect, test, type Page } from "@playwright/test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const SLOWDOWN = 4;
const FRAME = 16;
const WORDS = "the quiet editor keeps pace with every key";
const stamp = Date.now().toString(36);
const PLAIN = `import { useState } from "react";
import { Page, Write } from "parachute";
export default function Plain() { const [t, setT] = useState(""); return <Page title="Plain"><Write label="A plain box" value={t} onChange={setT} /></Page>; }
`;

async function keysIn(page: Page, title: string, box: string, expectedEnd: string): Promise<number[]> {
  const app = page.frameLocator(`iframe[title="${title}"]`);
  const area = app.getByLabel(box, { exact: true });
  await area.click();
  await area.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(el.value.length, el.value.length);
  });
  const frame = (await (await page.locator(`iframe[title="${title}"]`).elementHandle())!.contentFrame())!;
  await frame.evaluate(() => {
    const w = window as unknown as { __keys: number[] };
    w.__keys = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (["keydown", "keypress", "input"].includes(e.name)) w.__keys.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOWDOWN });
  try {
    await page.keyboard.type(WORDS, { delay: 60 });
    await page.waitForTimeout(400);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await expect(area).toHaveValue(new RegExp(`${expectedEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  return (await frame.evaluate(() => (window as unknown as { __keys: number[] }).__keys.slice())).sort((a, b) => a - b);
}

const p90 = (k: number[]) => (k.length ? k[Math.min(k.length - 1, Math.floor(k.length * 0.9))] : 0);

test("Writing applet: open a piece, type, see a reference, insert it as a quote, and ask Uni", async ({ page }) => {
  const h = hubState();
  const r = appletRecord("writing");
  const applet = await record(h, "create", r);
  const piece = await api(h, "POST", "notes", {
    path: `Writing/Pieces/Quiet desks ${stamp}`,
    tags: ["piece"],
    content: "Starting a draft on quiet writing tools.",
    metadata: { stage: "draft" },
  });
  const ref = await api(h, "POST", "notes", {
    path: `References/Calm rooms ${stamp}`,
    tags: ["reference"],
    content: "Context note.",
    metadata: {
      for: piece.id,
      state: "ready",
      quote: "A calm desk holds only the page and one open reference.",
      source: "Fieldcraft Notes",
      author: "M. Alvarez",
      source_url: "https://example.org/fieldcraft",
      why: "Echoes the opening paragraph.",
    },
  });
  const made = [applet.id, piece.id, ref.id];
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator('iframe[title="Writing"]');

    await f.getByRole("button", { name: new RegExp(`Quiet desks ${stamp}`) }).click();
    const box = f.getByLabel("Piece", { exact: true });
    await expect(box).toHaveValue("Starting a draft on quiet writing tools.");
    await expect(f.getByText(/A calm desk holds only the page/)).toBeVisible();

    // Type and wait for debounced save
    await box.fill("Starting a draft on quiet writing tools. Every key feels immediate.");
    await expect.poll(async () => (await api(h, "GET", `notes/${piece.id}?include_content=true`)).content, { timeout: 10_000 })
      .toContain("Every key feels immediate.");

    // Insert reference as quote
    await f.getByRole("button", { name: "Insert quote" }).first().click();
    await expect(box).toHaveValue(/> A calm desk holds only the page[\s\S]*Fieldcraft Notes/);

    // Ask Uni creates a reference with state: asked and never edits the piece body
    const beforeAsk = await box.inputValue();
    await f.getByLabel("Ask Uni").fill("Find a counterexample from letterpress shops");
    await f.getByRole("button", { name: "Ask" }).click();
    await expect(f.getByText("Find a counterexample from letterpress shops")).toBeVisible();
    expect(await box.inputValue()).toBe(beforeAsk);
  } finally {
    for (const n of await api(h, "GET", "notes?path_prefix=References/").catch(() => [])) {
      // only what this test made: its references, and the asks for its piece
      if (made.includes(n.id) || n.metadata?.for === piece.id) await api(h, "DELETE", `notes/${n.id}`).catch(() => {});
    }
    for (const id of made) await api(h, "DELETE", `notes/${id}`).catch(() => {});
  }
});

test("typing into a long piece in Writing stays within the same keystroke budget as a plain textarea", async ({ page }) => {
  test.setTimeout(240_000);
  const h = hubState();
  const plain = await record(h, "create", {
    path: `Applets/Plain writing ${stamp}`,
    extension: "tsx",
    tags: ["applet"],
    body: PLAIN,
    fields: { applet: { contract: 2, id: `plain-wr-${stamp}`, name: "Plain", glyph: "❦", access: [] } },
  });
  const writing = await record(h, "create", appletRecord("writing"));
  const longText = Array.from(
    { length: 120 },
    (_, i) => `Paragraph ${i + 1}. Quiet software gives the page back to the writer and keeps references close by without crowding the sentence in progress.`,
  ).join("\n\n") + "\n\n";
  const piece = await api(h, "POST", "notes", {
    path: `Writing/Pieces/Long essay ${stamp}`,
    tags: ["piece"],
    content: longText,
    metadata: { stage: "draft" },
  });
  const made = [plain.id, writing.id, piece.id];
  for (let i = 0; i < 20; i++) {
    const ref = await api(h, "POST", "notes", {
      path: `References/Long ref ${i} ${stamp}`,
      tags: ["reference"],
      content: `Note ${i}`,
      metadata: {
        for: piece.id,
        state: i % 3 === 0 ? "kept" : "ready",
        quote: `Prepared passage number ${i + 1} on steady pacing and clear margins.`,
        source: `Notebook ${i + 1}`,
        source_url: `https://example.org/notes/${i + 1}`,
        why: `Supports section ${(i % 5) + 1}.`,
      },
    });
    made.push(ref.id);
  }
  try {
    await page.goto(`/v/${VAULT}/a/${plain.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const floor = await keysIn(page, "Plain", "A plain box", WORDS);

    await page.goto(`/v/${VAULT}/a/${writing.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator('iframe[title="Writing"]');
    await f.getByRole("button", { name: new RegExp(`Long essay ${stamp}`) }).click();
    await expect(f.getByLabel("Piece", { exact: true })).toBeVisible();
    const measured = await keysIn(page, "Writing", "Piece", WORDS);

    const base = Math.max(FRAME, p90(floor));
    console.log(`keystrokes over ${FRAME} ms at ${SLOWDOWN}x CPU: plain p90 ${p90(floor)} ms (${floor.length}), Writing p90 ${p90(measured)} ms (${measured.length})`);
    expect(p90(measured), `writing ${measured.join(" ")}\nplain ${floor.join(" ")}`).toBeLessThanOrEqual(
      base + Math.max(2 * FRAME, base / 2),
    );
  } finally {
    for (const id of made) await api(h, "DELETE", `notes/${id}`).catch(() => {});
  }
});

// The walkthrough's screenshots, from the real build on a real hub, with made-up pieces and references:
//   WALKTHROUGH_DIR=../walkthrough npx playwright test e2e/writing.spec.ts --project=phone -g walkthrough
test("walkthrough: Writing at 1440 and 390", async ({ page }) => {
  test.skip(!process.env.WALKTHROUGH_DIR, "set WALKTHROUGH_DIR to take the walkthrough's screenshots");
  test.setTimeout(180_000);
  const dir = process.env.WALKTHROUGH_DIR!;
  const h = hubState();
  const applet = await record(h, "create", appletRecord("writing"));
  const note = (path: string, tags: string[], content: string, metadata: Record<string, unknown>) =>
    api(h, "POST", "notes", { path, tags, content, metadata });
  const made: string[] = [applet.id];
  const piece = async (...a: Parameters<typeof note>) => { const n = await note(...a); made.push(n.id); return n; };
  try {
    await piece("Writing/Pieces/Walking to the creek", ["piece"],
      "Every morning before the wind comes up, the trail along the creek is cool enough to hear the gravel settle.\n\nThe walk is the same each day, and never the same twice.",
      { stage: "published", slug: "walking-to-the-creek", url: "https://unforced.example/writing/walking-to-the-creek/", published_at: "2026-11-10" });
    await piece("Writing/Pieces/Letterpress spacing", ["piece"], "Lead furniture, leading, and why generous margins change how carefully people read.", { stage: "seed" });
    await piece("Writing/Pieces/Notes on small ponds", ["piece"], "How a backyard pond holds warmth in late autumn.", { stage: "seed" });
    await piece("Writing/Pieces/A long field essay on calm workshops", ["piece"], "Benches, light, and the sound of a room where people make things.", { stage: "draft" });
    const quiet = await piece("Writing/Pieces/Tools that stay quiet", ["piece"],
      "Most software asks for attention before you have a sentence down. A good writing surface does the opposite: it hands back the page, keeps your notes within arm's reach, and gets out of the way while a thought is still fragile.\n\nWhen research lives in another window, switching tabs breaks the cadence of a paragraph.",
      { stage: "draft" });
    // oldest first, so the ready one is newest and on top
    await piece("References/Ask 2026-11-23 11-20 Margin notes history", ["reference"],
      "Find a historical example of scholars keeping marginalia beside drafts.", { for: quiet.id, state: "asked" });
    await piece("References/Fieldcraft desk margin", ["reference"], "", {
      for: quiet.id, state: "kept", quote: "Keep the desk clear except for the sheet in progress and one open notebook beside it.",
      source: "Fieldcraft Notebook", author: "H. Okafor", source_url: "https://example.org/fieldcraft-notebook",
      why: "Gives a physical picture of the page with one shelf beside it." });
    await piece("References/Alvarez on calm rooms", ["reference"], "", {
      for: quiet.id, state: "ready", quote: "A room that lets you hear yourself think has no more than two things asking for your eyes.",
      source: "Notes on Calm Rooms", author: "M. Alvarez", source_url: "https://example.org/calm-rooms",
      why: "Echoes your opening: only the page and one nearby shelf in view." });

    const f = page.frameLocator('iframe[title="Writing"]');
    const open = async () => {
      await page.goto(`/v/${VAULT}/a/${applet.id}`);
      const allow = page.getByRole("button", { name: "Allow" });
      // the first open asks to allow the applet; a later one may find it stopped
      const again = page.getByRole("button", { name: "Open Writing" });
      await expect(allow.or(again).or(page.locator('iframe[title="Writing"]')).first()).toBeVisible({ timeout: 10_000 });
      if (await allow.isVisible()) await allow.click();
      if (await again.isVisible()) await again.click(); // the app had stopped it
      await expect(f.getByRole("button", { name: /Tools that stay quiet/ })).toBeVisible();
    };
    const shot = async (name: string) => { await page.waitForTimeout(400); await page.screenshot({ path: `${dir}/${name}.png` }); };

    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    await shot("1440-01-pieces");
    await f.getByRole("button", { name: /Tools that stay quiet/ }).click();
    await expect(f.getByText(/A room that lets you hear yourself think/)).toBeVisible();
    await shot("1440-02-piece-beside");
    const box = f.getByLabel("Piece", { exact: true });
    await box.click();
    await box.evaluate((el: HTMLTextAreaElement) => { const at = el.value.indexOf("\n\n"); el.setSelectionRange(at, at); });
    await f.getByRole("button", { name: "Insert quote" }).first().click();
    await expect(box).toHaveValue(/> A room that lets you hear yourself think[\s\S]*\[Notes on Calm Rooms\]\(https:\/\/example\.org\/calm-rooms\)/);
    await expect(f.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await shot("1440-03-inserted-quote");
    await f.getByRole("button", { name: "Details" }).first().click();
    await expect(f.getByText("Why it fits")).toBeVisible();
    await shot("1440-04-reference-page");
    await f.getByRole("button", { name: /Tools that stay quiet/ }).click(); // back to the piece
    await f.getByRole("button", { name: /^.?\s*Writing$/ }).first().click(); // back to the list
    await f.getByRole("button", { name: /Walking to the creek/ }).click();
    await expect(f.getByText("walking-to-the-creek", { exact: true })).toBeVisible();
    await shot("1440-05-published");
    await f.getByRole("button", { name: /^.?\s*Writing$/ }).first().click();
    // on the list, and the app has kept that (saved state reaches it within 250 ms), so the next open starts there
    await expect(f.getByRole("button", { name: /Tools that stay quiet/ })).toBeVisible();
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await shot("390-01-pieces");
    await f.getByRole("button", { name: /Tools that stay quiet/ }).click();
    await expect(f.getByLabel("Piece", { exact: true })).toBeVisible();
    await shot("390-02-piece-editor");
    await f.getByRole("button", { name: /^Beside it/ }).click();
    await expect(f.locator("blockquote", { hasText: /A room that lets you hear yourself think/ })).toBeVisible();
    await shot("390-03-beside-drawer");
    await f.getByRole("button", { name: "Details" }).first().click();
    await expect(f.getByText("Why it fits")).toBeVisible();
    await shot("390-04-reference-page");
  } finally {
    for (const n of await api(h, "GET", "notes?path_prefix=References/").catch(() => [])) {
      if (n.metadata?.for && made.includes(n.metadata.for)) made.push(n.id);
    }
    for (const id of made) await api(h, "DELETE", `notes/${id}`).catch(() => {});
  }
});
