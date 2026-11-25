// Still means still (docs/LOOK.md "Still", docs/DESIGN-RULES.md 11): on the Daylight screen choice and under the device's
// reduce-motion setting, no animation runs anywhere, in the shell, in the frame or in an applet, through a day's moves
// (a place opened from the bar, a press, a drawer, a toast, a drag); a finger drags nothing, and a drag far enough does at
// once what letting go would; and an applet's own motion asks the kit's still() first. The same moves flowing do move,
// so the check would see motion if there were any.
import { devices, expect, test, type Browser, type Page } from "./test";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const stamp = Date.now().toString(36);
const FOLDER = `Still ${stamp}/`;
const CODE = `import { useEffect, useRef, useState } from "react";
import { Button, Drawer, List, Loading, Page, ready, still, toast, vault } from "parachute";

export default function Calm() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const mark = useRef(null);
  useEffect(() => { ready().then(() => vault.queryRecords({ pathPrefix: ${JSON.stringify(FOLDER)} }).then(setRows)); }, []);
  // its own motion, in its own code: only when the kit says things may move
  const wave = () => { if (!still()) mark.current.animate([{ transform: "translateX(0)" }, { transform: "translateX(40px)" }], { duration: 400 }); toast("Waved"); };
  return (
    <Page title="Calm" aside={<Button onClick={() => setOpen(true)}>More</Button>}>
      <p ref={mark} style={{ display: "inline-block" }}>~</p>
      <Button onClick={wave}>Wave</Button>
      {rows === null ? <Loading /> : <List label="Things" rows={rows.map((r) => ({ key: r.id, title: r.path.slice(${FOLDER.length}) }))} />}
      <Drawer open={open} onClose={() => setOpen(false)} title="More about it">
        <p>What is inside a drawer.</p>
      </Drawer>
    </Page>
  );
}
`;

const made: string[] = [];
let appletId = "";
test.beforeAll(async () => {
  made.push(((await api(hubState(), "POST", "notes", { path: `${FOLDER}Oak`, content: "Oak" })) as { id: string }).id);
  const note = await record(hubState(), "create", {
    path: `Applets/Calm ${stamp}`, extension: "tsx", tags: ["applet"], body: CODE,
    fields: { needs: 7, applet: { contract: 2, id: `calm-${stamp}`, name: "Calm", glyph: "❀", access: [{ vault: "here", allow: [{ path: FOLDER, verbs: ["read"] }] }] } },
  });
  appletId = note.id;
  made.push(note.id);
});
test.afterAll(async () => { for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); });

/** Watches every document from its first moment (the shell, the frame, each applet's, and any that comes later): any
 *  animation that runs with a time above 0 is written down, on every frame drawn. */
const WATCH = () => {
  const w = window as unknown as { __moved?: string[] };
  w.__moved = [];
  const look = () => {
    for (const a of document.getAnimations()) {
      const d = Number(a.effect?.getTiming().duration ?? 0);
      if (d > 0 && a.playState === "running") {
        const on = (a.effect as KeyframeEffect).target as Element | null;
        w.__moved!.push(`${on?.tagName.toLowerCase()}.${on?.className} ${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animate()"} ${d}ms`);
      }
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};
/** What moved in any document since the last call (and starts again from nothing). */
async function moved(page: Page): Promise<string[]> {
  const all: string[] = [];
  for (const f of page.frames()) all.push(...await f.evaluate(() => { const w = window as unknown as { __moved?: string[] }; const m = w.__moved ?? []; w.__moved = []; return m; }).catch(() => [] as string[]));
  return [...new Set(all)];
}

async function openCalm(page: Page) {
  await page.goto(`/v/${VAULT}/a/${appletId}`);
  const start = page.getByRole("button", { name: "Open Calm" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Calm"]');
  await expect(app.getByText("Oak")).toBeVisible({ timeout: 20_000 });
  return app;
}

/** A day's moves, from opening the applet, with what moved after each (watched from every document's first moment). */
async function aDay(page: Page) {
  const seen: Record<string, string[]> = {};
  const step = async (what: string, act: () => Promise<unknown>) => { await moved(page); await act(); await page.waitForTimeout(450); seen[what] = await moved(page); };
  let app!: Awaited<ReturnType<typeof openCalm>>;
  await step("opening the applet", async () => { app = await openCalm(page); });
  // to the list and back by the bar: the places
  await step("the list", () => page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: /Applets/ }).click());
  await step("back to the applet", () => page.goBack());
  await expect(app.getByText("Oak")).toBeVisible();
  await step("a press and the applet's own motion", () => app.getByRole("button", { name: "Wave" }).click());
  await step("a drawer", () => app.getByRole("button", { name: "More" }).click());
  const drawer = app.getByRole("dialog", { name: "More about it" });
  await expect(drawer).toBeVisible();
  await step("the drawer put away", () => page.keyboard.press("Escape"));
  await expect(drawer).toHaveCount(0, { timeout: 1000 });
  await step("Settings", () => page.goto("/settings"));
  return seen;
}

async function stillPage(browser: Browser, how: "daylight" | "reduce") {
  const ctx = await browser.newContext({ storageState: "e2e/.signed-in.json", ...devices["Pixel 7"], ...(how === "reduce" ? { reducedMotion: "reduce" as const } : {}) });
  await ctx.addInitScript(WATCH);
  if (how === "daylight") await ctx.addInitScript(() => { try { localStorage.setItem("parachute.screen.v1", "daylight"); } catch { /* the frames have none */ } });
  return { ctx, page: await ctx.newPage() };
}

for (const how of ["daylight", "reduce"] as const) {
  test(`${how === "daylight" ? "Daylight on this screen" : "the device's reduce-motion"}: no animation runs anywhere through a day's moves`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await stillPage(browser, how);
    try {
      const seen = await aDay(page);
      expect(Object.keys(seen)).toHaveLength(7);
      expect(Object.entries(seen).filter(([, m]) => m.length)).toEqual([]);
    } finally { await ctx.close(); }
  });
}

test("flowing, the same moves do move: the applet arriving, a press with the applet's own motion, the drawer (so the check above sees motion when there is any)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(WATCH);
  const seen = await aDay(page);
  expect(seen["opening the applet"].length, "the page arriving").toBeGreaterThan(0);
  expect(seen["a press and the applet's own motion"].some((m) => m.includes("animate()"))).toBe(true);
  expect(seen["a drawer"].length).toBeGreaterThan(0);
  expect(seen["the drawer put away"].length).toBeGreaterThan(0);
});

test("under still a finger drags nothing: a short drag leaves the drawer where it is, 48 px closes it at once", async ({ browser }) => {
  const { ctx, page } = await stillPage(browser, "daylight");
  try {
    const app = await openCalm(page);
    await app.getByRole("button", { name: "More" }).click();
    const drawer = app.getByRole("dialog", { name: "More about it" });
    await expect(drawer).toBeVisible();
    const g = (await app.locator(".pa-drawer-grip").boundingBox())!;
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(x, y + i * 5); await page.waitForTimeout(16); }
    // 30 px down, the finger still on it: the drawer hasn't moved
    expect(await drawer.evaluate((d) => (d as HTMLElement).style.getPropertyValue("--pa-drag"))).toBe("");
    expect(await drawer.evaluate((d) => getComputedStyle(d).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    for (let i = 7; i <= 11; i++) { await page.mouse.move(x, y + i * 5); await page.waitForTimeout(16); }
    // past 48 px: closed, before the finger is lifted
    await expect(drawer).toHaveCount(0, { timeout: 300 });
    await page.mouse.up();
  } finally { await ctx.close(); }
});

test("under still a toast doesn't follow the finger either: 30 px leaves it where it is, 48 px puts it away at once", async ({ browser }) => {
  const { ctx, page } = await stillPage(browser, "daylight");
  try {
    const app = await openCalm(page);
    await app.getByRole("button", { name: "Wave" }).click();
    const toast = app.locator(".pa-toast", { hasText: "Waved" });
    await expect(toast).toBeVisible();
    const b = (await toast.boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(x, y + i * 5); await page.waitForTimeout(16); }
    expect(await toast.evaluate((t) => (t as HTMLElement).style.getPropertyValue("--pa-swipe"))).toBe("");
    await expect(toast).toBeVisible();
    for (let i = 7; i <= 11; i++) { await page.mouse.move(x, y + i * 5); await page.waitForTimeout(16); }
    await expect(toast).toHaveCount(0, { timeout: 1000 });
    await page.mouse.up();
  } finally { await ctx.close(); }
});
