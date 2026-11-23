// The pages and the tabs (docs/LOOK.md, "Structure"): a place written on the kit's Page is a short run of pages you
// turn, in a real browser against a real hub. The arrows turn it (gliding, flowing; at once, still), the keys turn it at
// once, a swipe turns it once under still; what you write in sits under the pages and writing never turns them; a place
// that says so opens on its first page each time it is shown; the bar's places are tabs, the one you are in joined to
// the page.
import { expect, test, type Browser, type Frame, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const stamp = Date.now().toString(36);
const FOLDER = `Pages ${stamp}/`;
const CODE = `import { useEffect, useState } from "react";
import { List, Loading, Page, ready, vault, Write } from "parachute";

export default function Leaves() {
  const [rows, setRows] = useState(null);
  const [line, setLine] = useState("");
  const load = () => vault.queryRecords({ pathPrefix: ${JSON.stringify(FOLDER)}, limit: 100 }).then((r) => setRows(r.sort((a, b) => a.path.localeCompare(b.path))));
  useEffect(() => { ready().then(load); }, []);
  const add = async () => { await vault.createRecord({ path: ${JSON.stringify(FOLDER)} + "zz " + line, body: "" }); setLine(""); await load(); };
  // while it reads, a page of its own; then another (a new Page drawn while the first is still there: it pages too)
  if (rows === null) return <Page title="Leaves"><Loading /></Page>;
  return (
    <>
      <Page title="Leaves" start="first">
        <List label="Leaves" rows={rows.map((r) => ({ key: r.id, title: r.path.slice(${FOLDER.length}), meta: "A leaf of the oak, the ash or the rowan" }))} />
        <Write line dock enter="send" label="A new leaf" placeholder="A new leaf" value={line} onChange={setLine} onSend={add} send="Add" />
      </Page>
    </>
  );
}
`;

// a place that scrolls instead (wide): no pages, but the hour's sky at its head all the same
const WIDE = `import { Page, Empty } from "parachute";
export default function Wide() { return <Page title="Wide place" wide><Empty title="Nothing yet" /></Page>; }
`;

const made: string[] = [];
let appletId = "";
let wideId = "";
test.beforeAll(async () => {
  for (let i = 0; i < 30; i++) made.push(((await api(hubState(), "POST", "notes", { path: `${FOLDER}Leaf ${String(i).padStart(2, "0")}`, content: "a leaf" })) as { id: string }).id);
  const note = await record(hubState(), "create", {
    path: `Applets/Leaves ${stamp}`, extension: "tsx", tags: ["applet"], body: CODE,
    fields: { needs: 7, applet: { contract: 2, id: `leaves-${stamp}`, name: "Leaves", glyph: "❦", access: [{ vault: "here", allow: [{ path: FOLDER, verbs: ["read", "create"] }] }] } },
  });
  appletId = note.id;
  made.push(note.id);
  const wide = await record(hubState(), "create", {
    path: `Applets/Wide ${stamp}`, extension: "tsx", tags: ["applet"], body: WIDE,
    fields: { needs: 7, applet: { contract: 2, id: `wide-${stamp}`, name: "Wide place", glyph: "❦", access: [] } },
  });
  wideId = wide.id;
  made.push(wide.id);
});
test.afterAll(async () => {
  const rows = (await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent(FOLDER)}&limit=100`)) as { id: string }[];
  for (const id of [...rows.map((r) => r.id), ...made]) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
});

async function openLeaves(page: Page) {
  await page.goto(`/v/${VAULT}/a/${appletId}`);
  const start = page.getByRole("button", { name: "Open Leaves" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Leaves"]');
  await expect(app.getByText("Leaf 00")).toBeVisible({ timeout: 20_000 });
  const inner = (await (await page.locator('iframe[title="Leaves"]').elementHandle())!.contentFrame())!;
  await expect(app.locator(".pa-at")).toHaveText(/^1(–2)? of \d+$/);
  return { app, inner };
}
/** The book's scroll, and the page width it turns by. */
const book = (inner: Frame) => inner.evaluate(() => { const b = document.querySelector<HTMLElement>(".pa-book")!; return { left: b.scrollLeft, page: b.querySelector<HTMLElement>(".pa-leaf")!.offsetWidth, count: Number(/of (\d+)/.exec(document.querySelector(".pa-at")!.textContent ?? "")?.[1] ?? 1) }; });

test("a long place is a run of pages: the arrows glide a page, the keys turn at once, nothing scrolls down", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  const b0 = await book(inner);
  expect(b0.count).toBeGreaterThan(1);
  expect(b0.left).toBe(0);
  // nothing scrolls the other way: the page is the screen
  expect(await inner.evaluate(() => [document.scrollingElement!.scrollHeight <= innerHeight + 1, getComputedStyle(document.body).overflow])).toEqual([true, "hidden"]);
  // the arrow: a glide on the theme's turn (mid-way it is between the pages), then on the next page
  await app.getByRole("button", { name: "Next page" }).click();
  const mid = await inner.evaluate(() => new Promise<number>((r) => setTimeout(() => r(document.querySelector<HTMLElement>(".pa-book")!.scrollLeft), 90)));
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(b0.page);
  await expect.poll(async () => (await book(inner)).left).toBe(b0.page);
  await expect(app.locator(".pa-at")).toHaveText(`2 of ${b0.count}`);
  // the keyboard: at once, never a glide
  await inner.locator("body").press("ArrowRight");
  expect((await book(inner)).left).toBe(2 * b0.page);
  await inner.locator("body").press("ArrowLeft");
  await inner.locator("body").press("ArrowLeft");
  expect((await book(inner)).left).toBe(0);
  await expect(app.locator(".pa-at")).toHaveText(`1 of ${b0.count}`);
  // the first page carries the sky; a later page a running head with the place's name
  expect(await inner.evaluate(() => getComputedStyle(document.querySelector(".pa-sky")!).backgroundImage)).toContain("linear-gradient");
  expect(await inner.evaluate(() => document.querySelectorAll(".pa-runhead")[0]?.textContent)).toBe("Leaves");
});

test("writing never turns the page: the line sits under the pages, and a line added leaves you where you are", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  const { page: w } = await book(inner);
  await app.getByRole("button", { name: "Next page" }).click();
  await expect.poll(async () => (await book(inner)).left).toBe(w);
  const field = app.getByLabel("A new leaf");
  // under the pages, outside them
  expect(await field.evaluate((f) => !!f.closest(".pa-dock") && !f.closest(".pa-book"))).toBe(true);
  for (const leaf of ["acorn", "bud"]) {
    await field.fill(`${leaf} ${stamp}`);
    await app.getByRole("button", { name: "Add" }).click();
    await expect(app.getByText(`zz ${leaf} ${stamp}`)).toBeAttached();
    expect((await book(inner)).left, "still on page 2").toBe(w);
    await expect(field).toBeVisible();
  }
});

test("a line that grows as you write shrinks the pages, and the count follows: the last of the place stays reachable", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  /** the count shown, and the pages the place really takes (the column its end falls in) */
  const geo = () => inner.evaluate(() => {
    const flow = document.querySelector<HTMLElement>(".pa-flow")!, end = flow.querySelector<HTMLElement>(":scope > .pa-end")!;
    const w = document.querySelector<HTMLElement>(".pa-leaf")!.offsetWidth;
    return { shown: Number(/of (\d+)/.exec(document.querySelector(".pa-at")!.textContent ?? "")?.[1] ?? 0), need: Math.floor((end.getBoundingClientRect().left - flow.getBoundingClientRect().left) / w) + 1, h: document.querySelector<HTMLElement>(".pa-book")!.clientHeight };
  });
  const g0 = await geo();
  expect(g0.shown).toBe(g0.need);
  await app.getByLabel("A new leaf").fill("a long line that wraps ".repeat(30));
  // the line grew and the book shrank by it: the place takes more pages than before
  await expect.poll(async () => (await geo()).h).toBeLessThan(g0.h - 30);
  await expect.poll(async () => (await geo()).need).toBeGreaterThan(g0.need);
  await expect.poll(async () => { const g = await geo(); return g.shown === g.need; }).toBe(true);
});

test("a place that opens on its first page does, each time it is shown again", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  await app.getByRole("button", { name: "Next page" }).click();
  await expect.poll(async () => (await book(inner)).left).toBeGreaterThan(0);
  // away to Settings (by its menu: "/" may be this very applet, where a vault starts on it), and back: the applet kept
  // running, shown again on its first page
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: /menu$/ }).getByRole("link", { name: "Settings" }).click();
  await expect(page.locator('iframe[title="Leaves"]')).toBeHidden();
  await page.goBack();
  await expect(app.getByText("Leaf 00")).toBeVisible();
  await expect.poll(async () => (await book(inner)).left).toBe(0);
});

test("a place that scrolls (wide) has the hour's sky at its head too, fading into the paper", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/${wideId}`);
  const start = page.getByRole("button", { name: "Open Wide place" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Wide place"]');
  await expect(app.getByRole("heading", { name: "Wide place" })).toBeVisible({ timeout: 20_000 });
  const inner = (await (await page.locator('iframe[title="Wide place"]').elementHandle())!.contentFrame())!;
  expect(await inner.evaluate(() => [!!document.querySelector(".pa-book"), getComputedStyle(document.body).backgroundImage])).toEqual([false, expect.stringContaining("linear-gradient")]);
});

async function onDaylight(browser: Browser) {
  const ctx = await browser.newContext({ storageState: "e2e/.signed-in.json", viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("parachute.screen.v1", "daylight"); } catch { /* frames have none */ } });
  return { ctx, page: await ctx.newPage() };
}

test("on the Daylight a turn is a cut and a swipe turns once: the book never follows the finger", async ({ browser }) => {
  const { ctx, page } = await onDaylight(browser);
  try {
    const { app, inner } = await openLeaves(page);
    const { page: w } = await book(inner);
    // the arrow: there at once, no glide
    await app.getByRole("button", { name: "Next page" }).click();
    expect((await book(inner)).left).toBe(w);
    // a finger's swipe to the left: the book stays put while it moves, then turns once
    const swipe = (dx: number) => inner.evaluate((dx) => {
      const b = document.querySelector<HTMLElement>(".pa-book")!;
      const at = (type: string, x: number) => b.dispatchEvent(new PointerEvent(type, { pointerType: "touch", clientX: x, clientY: 300, bubbles: true, isPrimary: true }));
      const lefts: number[] = [];
      at("pointerdown", 300);
      for (let i = 1; i <= 8; i++) { at("pointermove", 300 + (dx * i) / 8); lefts.push(b.scrollLeft); }
      at("pointerup", 300 + dx);
      return lefts;
    }, dx);
    const lefts = await swipe(-120);
    // no step between pages: each frame is a whole page
    for (const l of lefts) expect(l % w).toBe(0);
    expect((await book(inner)).left).toBe(2 * w);
    // a short one turns nothing
    await swipe(-30);
    expect((await book(inner)).left).toBe(2 * w);
    // the touch scroll of the device can't move it either
    expect(await inner.evaluate(() => getComputedStyle(document.querySelector(".pa-book")!).overflowX)).toBe("hidden");
  } finally { await ctx.close(); }
});

test("the bar's places are tabs: the one you are in is the page's colour, joined to it; on a Mac they stand down the right edge", async ({ page }) => {
  await openLeaves(page);
  const bar = page.getByRole("navigation", { name: "Bar" });
  // the list of applets: its tab is the one you are in
  await bar.getByRole("link", { name: /Applets/ }).click();
  const current = bar.locator('[aria-current="page"]');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect.poll(() => current.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(bg);
  // the desk the tabs hang from is not the page
  expect(await bar.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(bg);
  // a phone: along the foot
  const foot = (await bar.boundingBox())!;
  expect(foot.y + foot.height).toBeGreaterThan(page.viewportSize()!.height - 2);
  // a Mac: down the right edge, the page beside them; the applet an open book whose last spread shows its last leaf
  await page.setViewportSize({ width: 1440, height: 900 });
  const side = (await bar.boundingBox())!;
  expect(side.x + side.width).toBeGreaterThan(1438);
  expect(side.height).toBeGreaterThan(600);
  expect(side.width).toBeLessThan(200);
  // and the list of applets fills the page beside them (an iframe left at width auto is 300px wide)
  const list = (await page.locator("iframe.app-frame").boundingBox())!;
  expect(list.x).toBeLessThan(2);
  expect(Math.abs(list.x + list.width - side.x)).toBeLessThan(2);
});

test("on a Mac the place is an open book, two pages a turn; the last turn shows the last of it, whatever the count", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { app, inner } = await openLeaves(page);
  await expect(app.locator(".pa-at")).toHaveText(/^1–2 of \d+$/);
  const { count } = await book(inner);
  // a click on the page, then the arrow key, as a person on a Mac turns
  await app.locator(".pa-title").click();
  for (let i = 0; i < count; i++) await page.keyboard.press("ArrowRight");
  // the last leaf is on the spread the book shows
  const shown = await inner.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".pa-book")!.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".pa-list li")];
    const last = rows[rows.length - 1].getBoundingClientRect();
    return { ok: last.left >= b.left - 1 && last.right <= b.right + 1, b: [b.left, b.right], last: [last.left, last.right], scroll: document.querySelector<HTMLElement>(".pa-book")!.scrollLeft, at: document.querySelector(".pa-at")!.textContent };
  });
  expect(shown.ok, JSON.stringify(shown)).toBe(true);
  // and it shows a whole spread, the one the line names (never half of one, with a page repeated)
  const { left, page: w } = await book(inner);
  expect(left % (2 * w)).toBe(0);
  expect(left / (2 * w)).toBe(Math.ceil(count / 2) - 1);
});
