// How the kit feels (docs/DESIGN-RULES.md), in a real browser against a real hub: an applet written on the kit and
// nothing else arrives within 250 ms, readable on its first frame (never from blank, never held back by a delay),
// without moving what is already there; under the device's
// reduce-motion setting nothing moves at all, and a drawer or a toast still goes the moment it is put away (no waiting
// on an end of motion that never comes); a drawer and a toast follow the finger and go when let go far enough.
import { devices, expect, test, type Frame, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const stamp = Date.now().toString(36);
const FOLDER = `Feel ${stamp}/`;
const CODE = `import { useEffect, useState } from "react";
import { Button, Drawer, Field, List, Loading, Page, ready, toast, vault } from "parachute";

export default function Feel() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => vault.queryRecords({ pathPrefix: ${JSON.stringify(FOLDER)} }).then(setRows);
  useEffect(() => { ready().then(load); }, []);
  const add = async (t) => { await vault.createRecord({ path: ${JSON.stringify(FOLDER)} + t, body: "" }); await load(); toast("Added " + t); };
  return (
    <Page title="Feel" aside={<Button onClick={() => setOpen(true)}>More</Button>}>
      <Field label="Add a thing" placeholder="A name" action="Add" onAction={add} />
      {rows === null ? <Loading /> : <List label="Things" rows={rows.map((r) => ({ key: r.id, title: r.path.slice(${FOLDER.length}) }))} />}
      <Drawer open={open} onClose={() => setOpen(false)} title="More about it">
        <p>What is inside a drawer.</p>
        <Button onClick={() => setOpen(false)}>Done</Button>
      </Drawer>
    </Page>
  );
}
`;

const made: string[] = [];
let appletId = "";
test.beforeAll(async () => {
  for (const t of ["Oak", "Ash", "Rowan"]) made.push(((await api(hubState(), "POST", "notes", { path: `${FOLDER}${t}`, content: t })) as { id: string }).id);
  const note = await record(hubState(), "create", {
    path: `Applets/Feel ${stamp}`, extension: "tsx", tags: ["applet"], body: CODE,
    fields: { needs: 4, applet: { contract: 2, id: `feel-${stamp}`, name: "Feel", glyph: "❀", access: [{ vault: "here", allow: [{ path: FOLDER, verbs: ["read", "create"] }] }] } },
  });
  appletId = note.id;
  made.push(note.id);
});
test.afterAll(async () => {
  const rows = (await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent(FOLDER)}&limit=50`)) as { id: string }[];
  for (const id of [...rows.map((r) => r.id), ...made]) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
});

/** The applet open and its things shown; its frame, as Playwright reaches it and as a Frame to evaluate in. */
async function openFeel(page: Page) {
  await page.goto(`/v/${VAULT}/a/${appletId}`);
  const start = page.getByRole("button", { name: "Open Feel" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Feel"]');
  await expect(app.getByRole("button", { name: /Rowan/ }).or(app.getByText("Rowan"))).toBeVisible({ timeout: 20_000 });
  const inner = (await (await page.locator('iframe[title="Feel"]').elementHandle())!.contentFrame())!;
  return { app, inner };
}

/** Every animation the document has run or is running: what it is on, its name, its delay and duration. */
const animations = (inner: Frame) => inner.evaluate(() => document.getAnimations().map((a) => {
  const t = a.effect!.getTiming();
  const on = (a.effect as KeyframeEffect).target as Element | null;
  return { on: on?.className ?? "", name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "", delay: Number(t.delay ?? 0), duration: Number(t.duration ?? 0) };
}));

test("flowing: the page arrives within 250 ms on the theme's times, and moves nothing already there", async ({ page }) => {
  const { app, inner } = await openFeel(page);
  const anims = await animations(inner);
  // it did arrive (the title and the list), and nothing a page shows on arrival takes longer than 250 ms in all
  expect(anims.some((a) => /pa-page-head/.test(a.on) && a.name === "pa-in" && a.duration > 0)).toBe(true);
  for (const a of anims.filter((x) => !/pa-loading/.test(x.on))) expect(a.delay + a.duration, `${a.on} ${a.name}`).toBeLessThanOrEqual(250);
  // the theme's times reach the applet's frame
  expect(await inner.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim())).not.toBe("0ms");
  // nothing already on the screen was moved by what arrived (the Layout Instability API, in the applet's own frame):
  // the title and the field are there before the list; an arrival on margins instead of transform moves them (seen: 0.004)
  await page.waitForTimeout(600);
  const shifted = await inner.evaluate(() => new Promise<number>((res) => {
    let sum = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) sum += e.value; })
      .observe({ type: "layout-shift", buffered: true });
    setTimeout(() => res(sum), 100);
  }));
  expect(shifted).toBe(0);
  // a press gives under the finger (and comes back)
  const more = app.getByRole("button", { name: "More" });
  expect(await more.evaluate((b) => getComputedStyle(b).transitionProperty)).toContain("transform");
});

test("readable on the first frame: what arrives is never blank, and never waits for its turn", async ({ page }) => {
  // In every frame (the applet's too), note each kit part the moment it is put in the page and again on the next
  // frame: its opacity then is what the first painted frame shows (an animation held back by a delay shows its first
  // keyframe, so a delay on content shows here as what it starts from).
  await page.addInitScript(() => {
    const SEL = ".pa-page-head, .pa-list, .pa-card, .pa-table, .pa-fields, .pa-note, .pa-empty, .pa-days, .pa-problem, .pa-list li";
    const seen: { on: string; opacity: number; at: string }[] = [];
    (window as unknown as { __first: typeof seen }).__first = seen;
    const sample = (el: Element, at: string) => seen.push({ on: (el as HTMLElement).className, opacity: Number(getComputedStyle(el).opacity), at });
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        for (const el of [n, ...n.querySelectorAll("*")]) if (el.matches(SEL)) { sample(el, "inserted"); requestAnimationFrame(() => sample(el, "frame 1")); }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const { inner } = await openFeel(page);
  const first = await inner.evaluate(() => (window as unknown as { __first: { on: string; opacity: number; at: string }[] }).__first);
  // the title and the list were both seen arriving, and each was readable (opacity >= 0.8) from the first frame
  for (const part of ["pa-page-head", "pa-list"]) expect(first.some((f) => f.on.split(" ").includes(part)), `${part} seen arriving`).toBe(true);
  for (const f of first) expect(f.opacity, `${f.on} at ${f.at}`).toBeGreaterThanOrEqual(0.8);
  // and nothing in the page holds a part back: no delay on the parts' arrival, "Reading…" (a wait of its own) apart
  for (const a of (await animations(inner)).filter((x) => !/pa-loading/.test(x.on))) expect(a.delay, `${a.on} ${a.name}`).toBe(0);
});

test("still: under reduce-motion nothing moves, and a drawer and a toast still go at once", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.signed-in.json", reducedMotion: "reduce", ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  try {
    const { app, inner } = await openFeel(page);
    expect(await inner.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim())).toBe("0ms");
    for (const a of await animations(inner)) expect(a.duration, `${a.on} ${a.name}`).toBe(0);
    // the drawer: open, Escape, gone, and focus back on what opened it
    const more = app.getByRole("button", { name: "More" });
    await more.click();
    const drawer = app.getByRole("dialog", { name: "More about it" });
    await expect(drawer).toBeVisible();
    for (const a of await animations(inner)) expect(a.duration, `${a.on} ${a.name}`).toBe(0);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0, { timeout: 500 });
    await expect(more).toBeFocused();
    // a toast comes and goes; a newer one takes its place at once
    await app.getByLabel("Add a thing").fill(`Elm ${stamp}`);
    await app.getByRole("button", { name: "Add" }).click();
    const toast = app.locator(".pa-toast");
    await expect(toast).toHaveText(`Added Elm ${stamp}`);
    await app.getByLabel("Add a thing").fill(`Yew ${stamp}`);
    await app.getByRole("button", { name: "Add" }).click();
    await expect(app.locator(".pa-toast", { hasText: `Added Yew ${stamp}` })).toBeVisible();
    // the one it replaced is gone at once (well inside the 1 s a frame out of sight would wait)
    await expect(toast).toHaveCount(1, { timeout: 300 });
  } finally { await ctx.close(); }
});

/** Drag from an element's middle by `dy` px over `steps` moves (a finger's pace: ~16 ms a move). */
async function drag(page: Page, box: { x: number; y: number; width: number; height: number }, dy: number, steps = 12) {
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x, y + (dy * i) / steps); await page.waitForTimeout(16); }
  await page.mouse.up();
}

test("a drawer follows the finger: let go near, it settles back; far, it goes", async ({ page }) => {
  const { app } = await openFeel(page);
  await app.getByRole("button", { name: "More" }).click();
  const drawer = app.getByRole("dialog", { name: "More about it" });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400);
  const grip = app.locator(".pa-drawer-grip");
  // mid-drag it is where the finger is, 1:1
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + i * 5); await page.waitForTimeout(16); }
  expect(Math.abs(parseFloat(await drawer.evaluate((d) => (d as HTMLElement).style.getPropertyValue("--pa-drag"))) - 40)).toBeLessThan(2);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(drawer).toBeVisible();
  // settled back, it holds nothing of the drag, so a later close fades the shade as it should
  expect(await app.locator(".pa-drawer-scrim").evaluate((s) => (s as HTMLElement).style.getPropertyValue("--pa-scrim"))).toBe("");
  // a little, slowly: back where it was
  await drag(page, (await grip.boundingBox())!, 20, 20);
  await page.waitForTimeout(400);
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((d) => getComputedStyle(d).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  // most of the way: gone
  const h = (await drawer.boundingBox())!.height;
  await drag(page, (await grip.boundingBox())!, h * 0.6);
  await expect(drawer).toHaveCount(0, { timeout: 1500 });
  // a tap outside puts it away too
  await app.getByRole("button", { name: "More" }).click();
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400);
  await app.locator(".pa-drawer-scrim").click({ position: { x: 10, y: 10 } });
  await expect(drawer).toHaveCount(0, { timeout: 1500 });
});

test("a finger drags the drawer from anywhere on it while its content fits", async ({ page }) => {
  const { app } = await openFeel(page);
  await app.getByRole("button", { name: "More" }).click();
  const drawer = app.getByRole("dialog", { name: "More about it" });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400);
  const words = (await app.getByText("What is inside a drawer.").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = words.x + 20, y = words.y + words.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 15 }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(drawer).toHaveCount(0, { timeout: 1500 });
});

test("a toast holds while the app is away, and goes on its own once it is back; a tap puts one away", async ({ page }) => {
  const { app, inner } = await openFeel(page);
  // the app out of sight when the toast comes
  await inner.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await app.getByLabel("Add a thing").fill(`Pine ${stamp}`);
  await app.getByRole("button", { name: "Add" }).click();
  const toast = app.locator(".pa-toast");
  await expect(toast).toHaveText(`Added Pine ${stamp}`);
  await page.waitForTimeout(4200);
  await expect(toast).toHaveCount(1);
  await inner.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(toast).toHaveCount(0, { timeout: 4500 });
  // a tap: gone at once
  await app.getByLabel("Add a thing").fill(`Larch ${stamp}`);
  await app.getByRole("button", { name: "Add" }).click();
  await expect(toast).toHaveText(`Added Larch ${stamp}`);
  await page.waitForTimeout(400);
  await toast.click();
  await expect(toast).toHaveCount(0, { timeout: 1000 });
});

test("a toast goes when swiped down, before its time", async ({ page }) => {
  const { app } = await openFeel(page);
  await app.getByLabel("Add a thing").fill(`Hazel ${stamp}`);
  await app.getByRole("button", { name: "Add" }).click();
  const toast = app.locator(".pa-toast");
  await expect(toast).toHaveText(`Added Hazel ${stamp}`);
  await page.waitForTimeout(400);
  await drag(page, (await toast.boundingBox())!, 70, 6);
  await expect(toast).toHaveCount(0, { timeout: 1000 });
  // the row it added came in (a row that arrives after the list was drawn)
  await expect(app.locator("li.pa-fresh", { hasText: `Hazel ${stamp}` })).toHaveCount(1);
});

test("the app's own sheets fade in holding still, over the app's bar, and are still under reduce-motion", async ({ browser, page }) => {
  // the applet's menu (⋯ on the bar): one of the shell's sheets, which carry the app's own asks
  const sheetMotion = async (p: Page) => {
    await p.locator("header.bar").getByRole("button", { name: "Menu" }).click();
    const sheet = p.getByRole("dialog", { name: "Feel menu" });
    const button = sheet.getByRole("button").first();
    const first = (await button.boundingBox())!;
    const scrim = p.locator(".sheet-scrim").first();
    const fade = await scrim.evaluate((el) => { const c = getComputedStyle(el); return { name: c.animationName, duration: c.animationDuration }; });
    await p.waitForTimeout(450);
    // its buttons are where they were drawn first: a tap never meets a button still on its way
    expect(await button.boundingBox()).toEqual(first);
    // the shade covers the app's own bar too: what a frame draws can't look like it
    const bar = (await p.locator("header.bar").boundingBox())!;
    expect(await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? "", [bar.x + bar.width / 2, bar.y + bar.height / 2])).toContain("sheet-scrim");
    await p.keyboard.press("Escape").catch(() => {});
    return fade;
  };
  await openFeel(page);
  expect(await sheetMotion(page)).toEqual({ name: "shell-fade", duration: "0.3s" });
  const ctx = await browser.newContext({ storageState: "e2e/.signed-in.json", reducedMotion: "reduce", ...devices["Pixel 7"] });
  try {
    const still = await ctx.newPage();
    await openFeel(still);
    expect(await sheetMotion(still)).toEqual({ name: "shell-fade", duration: "0s" });
  } finally { await ctx.close(); }
});
