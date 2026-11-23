// A place and the tabs (docs/LOOK.md, "Structure"), in a real browser against a real hub: a place written on the kit's
// Page scrolls, as any phone app's list does (no pages to turn, no "2 of 3"); what you write in is pinned at its foot
// and stays in reach as the place scrolls; a place that says so opens at its top each time it is shown; the bar's
// places are tabs, the one you are in joined to the page.
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  // while it reads, a page of its own; then another
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

// a wide place (two columns on a Mac): the hour's sky at its head, as every place
const WIDE = `import { Page, Empty } from "parachute";
export default function Wide() { return <Page title="Wide place" wide><Empty title="Nothing yet" /></Page>; }
`;

// the same place, but one that doesn't say where it opens: it is where the person left it, even after the app closes
const ACORNS = CODE.replace(' start="first"', "").replace("function Leaves", "function Acorns").replace(/title="Leaves"/g, 'title="Acorns"');

// a talk written against the kit's Pages (as Rooms' room was on 11-22): its own scroller between a head and a box
const TALK = `import { useRef, useState } from "react";
import { Button, Page, Pages } from "parachute";
export default function Talk() {
  const [n, setN] = useState(40);
  const h = useRef(null);
  return <Page scroll title="Talk"><div style={{ display: "flex", flexDirection: "column", height: "70dvh" }}>
    <Pages start="last" name="Talk" handle={h}>{Array.from({ length: n }, (_, i) => <p key={i} data-i={i}>Line {String(i).padStart(2, "0")} of the talk</p>)}</Pages>
    <div><Button onClick={() => setN((x) => x + 1)}>One more</Button><Button onClick={() => h.current.toElement(document.querySelector("[data-i='5']"))}>To five</Button></div>
  </div></Page>;
}
`;

const made: string[] = [];
let talkId = "";
let appletId = "";
let acornsId = "";
let wideId = "";
test.beforeAll(async () => {
  for (let i = 0; i < 30; i++) made.push(((await api(hubState(), "POST", "notes", { path: `${FOLDER}Leaf ${String(i).padStart(2, "0")}`, content: "a leaf" })) as { id: string }).id);
  const note = await record(hubState(), "create", {
    path: `Applets/Leaves ${stamp}`, extension: "tsx", tags: ["applet"], body: CODE,
    fields: { needs: 7, applet: { contract: 2, id: `leaves-${stamp}`, name: "Leaves", glyph: "❦", access: [{ vault: "here", allow: [{ path: FOLDER, verbs: ["read", "create"] }] }] } },
  });
  appletId = note.id;
  made.push(note.id);
  const acorns = await record(hubState(), "create", {
    path: `Applets/Acorns ${stamp}`, extension: "tsx", tags: ["applet"], body: ACORNS,
    fields: { needs: 7, applet: { contract: 2, id: `acorns-${stamp}`, name: "Acorns", glyph: "❦", access: [{ vault: "here", allow: [{ path: FOLDER, verbs: ["read", "create"] }] }] } },
  });
  acornsId = acorns.id;
  made.push(acorns.id);
  const talk = await record(hubState(), "create", {
    path: `Applets/Talk ${stamp}`, extension: "tsx", tags: ["applet"], body: TALK,
    fields: { needs: 7, applet: { contract: 2, id: `talk-${stamp}`, name: "Talk", glyph: "❦", access: [] } },
  });
  talkId = talk.id;
  made.push(talk.id);
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

async function openLeaves(page: Page, name = "Leaves", id = appletId) {
  await page.goto(`/v/${VAULT}/a/${id}`);
  const start = page.getByRole("button", { name: `Open ${name}` });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator(`iframe[title="${name}"]`);
  await expect(app.getByText("Leaf 00")).toBeVisible({ timeout: 20_000 });
  const inner = (await (await page.locator(`iframe[title="${name}"]`).elementHandle())!.contentFrame())!;
  return { app, inner };
}
/** Wholly on the screen as it is now (the page's own viewport: the frame's box on it). */
async function onScreen(page: Page, l: Locator) {
  const b = await l.boundingBox(), v = page.viewportSize()!;
  return !!b && b.y >= 0 && b.y + b.height <= v.height + 0.5 && b.x >= 0 && b.x + b.width <= v.width + 0.5;
}

test("a long place scrolls down in one column: nothing turns sideways, and there is no page line", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  // longer than the screen, and the screen's own scroll (a finger's) reaches its end
  const geo = () => inner.evaluate(() => ({ y: scrollY, h: document.documentElement.scrollHeight, vh: innerHeight, wide: document.documentElement.scrollWidth - innerWidth }));
  expect((await geo()).h).toBeGreaterThan((await geo()).vh * 1.5);
  expect((await geo()).wide).toBeLessThanOrEqual(0);
  await expect(app.locator(".pa-pageline, .pa-at, .pa-book")).toHaveCount(0);
  await expect(app.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
  const last = app.getByText("Leaf 29");
  expect(await onScreen(page, last)).toBe(false);
  await page.mouse.move(200, 400);
  for (let i = 0; i < 12 && !(await onScreen(page, last)); i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(100); }
  expect(await onScreen(page, last)).toBe(true);
  expect((await geo()).y).toBeGreaterThan(0);
});

test("what you write in is pinned at the foot: in reach at the top of a place and at its end, and a line added leaves you where you are", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  const box = app.getByRole("textbox", { name: "A new leaf" });
  expect(await onScreen(page, box)).toBe(true);
  // its foot: the box's bottom near the screen's (over the bar), the rows scrolling under it
  const atFoot = async () => { const b = (await box.boundingBox())!, f = (await page.locator('iframe[title="Leaves"]').boundingBox())!; return f.y + f.height - (b.y + b.height); };
  expect(await atFoot()).toBeLessThan(40);
  await inner.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => onScreen(page, app.getByText("Leaf 29"))).toBe(true);
  expect(await onScreen(page, box)).toBe(true);
  // the last row clears the pinned line: the page ends above it
  expect((await app.getByText("Leaf 29").boundingBox())!.y + (await app.getByText("Leaf 29").boundingBox())!.height).toBeLessThanOrEqual((await app.locator(".pa-dock").boundingBox())!.y);
  expect(await atFoot()).toBeLessThan(40);
  // up again a little, then add a line: the place stays where it is
  await inner.evaluate(() => scrollTo(0, 300));
  await box.fill("a rowan leaf");
  await app.getByRole("button", { name: "Add" }).click();
  await expect(app.getByText("zz a rowan leaf")).toHaveCount(1);
  await expect(box).toHaveValue("");
  expect(await inner.evaluate(() => scrollY)).toBe(300);
  expect(await onScreen(page, box)).toBe(true);
});

test("a place that opens at its top does, each time it is shown again", async ({ page }) => {
  const { app, inner } = await openLeaves(page);
  await inner.evaluate(() => scrollTo(0, 600));
  await expect.poll(() => inner.evaluate(() => scrollY)).toBe(600);
  // away to Settings (by its menu: "/" may be this very applet, where a vault starts on it), and back: the applet kept
  // running, shown again at its top
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: /menu$/ }).getByRole("link", { name: "Settings" }).click();
  await expect(page.locator('iframe[title="Leaves"]')).toBeHidden();
  await page.goBack();
  await expect(app.getByText("Leaf 00")).toBeVisible();
  await expect.poll(() => inner.evaluate(() => scrollY)).toBe(0);
  expect(await onScreen(page, app.getByRole("heading", { level: 1, name: "Leaves" }))).toBe(true);
});

test("after the app closes, a place that opens at its top (Home) still does; one that doesn't is where it was left", async ({ page, context }) => {
  for (const [name, id, back] of [["Acorns", acornsId, 600], ["Leaves", appletId, 0]] as const) {
    const { inner } = await openLeaves(page, name, id);
    await inner.evaluate(() => scrollTo(0, 600));
    await page.waitForTimeout(600); // the kit keeps where it was within 250 ms
    // the app closed and opened again: a new page of the same profile
    const again = await context.newPage();
    const { app, inner: inner2 } = await openLeaves(again, name, id);
    await expect(app.getByText("Leaf 29")).toBeAttached();
    await again.waitForTimeout(800);
    expect(await inner2.evaluate(() => scrollY), name).toBe(back);
    await again.close();
  }
});

test("a talk on the kit's Pages scrolls on its own: it opens at the newest, follows what arrives at the foot, stays put when scrolled up", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/${talkId}`);
  const start = page.getByRole("button", { name: "Open Talk" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Talk"]');
  await expect(app.getByText("Line 39 of the talk")).toBeAttached({ timeout: 20_000 });
  const talk = app.locator(".pa-pages");
  const fromFoot = () => talk.evaluate((t) => Math.round(t.scrollHeight - t.scrollTop - t.clientHeight));
  expect(await talk.evaluate((t) => t.scrollHeight > t.clientHeight * 2)).toBe(true);
  await expect.poll(fromFoot).toBeLessThan(2);
  expect(await onScreen(page, app.getByText("Line 39 of the talk"))).toBe(true);
  // a line arrives while at the foot: still at the foot, the new line in view
  await app.getByRole("button", { name: "One more" }).click();
  await expect(app.getByText("Line 40 of the talk")).toBeAttached();
  await expect.poll(fromFoot).toBeLessThan(2);
  // scrolled up to read: a new line doesn't move you
  await talk.evaluate((t) => { t.scrollTop = 200; });
  await app.getByRole("button", { name: "One more" }).click();
  await expect(app.getByText("Line 41 of the talk")).toBeAttached();
  await page.waitForTimeout(200);
  expect(await talk.evaluate((t) => t.scrollTop)).toBe(200);
  // a line asked for from code (a message a notification opened) is brought into view
  await app.getByRole("button", { name: "To five" }).click();
  await expect.poll(() => onScreen(page, app.getByText("Line 05 of the talk"))).toBe(true);
  await expect(app.locator(".pa-at, .pa-book")).toHaveCount(0);
});

test("a place has the hour's sky at its head, fading into the paper", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/${wideId}`);
  const start = page.getByRole("button", { name: "Open Wide place" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Wide place"]');
  await expect(app.getByRole("heading", { name: "Wide place" })).toBeVisible({ timeout: 20_000 });
  const inner = (await (await page.locator('iframe[title="Wide place"]').elementHandle())!.contentFrame())!;
  expect(await inner.evaluate(() => getComputedStyle(document.body).backgroundImage)).toContain("linear-gradient");
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
  // a Mac: down the right edge, the page beside them
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
