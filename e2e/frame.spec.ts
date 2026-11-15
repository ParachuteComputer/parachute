// The frame from the home vault, against a real hub: "Make this mine" copies the built-in frame into the vault as one
// record and runs it; a change to it (an agent's MCP update) shows the card again; the last allowed copy runs offline;
// a frame written by an agent asks first; a newer built-in frame is offered, never written over theirs; a frame that
// stops gives way to the built-in one; and a hostile frame from the vault is as sealed as the built-in one.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
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
  await page.goto(`/v/${VAULT}`);
  await expect(frameEl(page)).toHaveAttribute("data-frame", "vault");
  await expect(ui(page).getByRole("list", { name: "Notes" })).toBeVisible();
});

test("a change to the frame (one MCP update) shows the card again; the version allowed runs, and runs offline", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Make this mine" }).click();
  await expect(status(page)).toHaveText("Your frame runs: Parachute/Frame.");
  const [rec] = await frameNotes();
  const changed = rec.content.replace('<Route path="/" element={<Home />} />', '<Route path="/" element={<><h2>My own frame</h2><Home /></>} />');
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
  await page.goto(`/v/${VAULT}`);
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
  await expect(ui(page).getByRole("list", { name: "Vaults" })).toBeVisible();
  await page.goto("/settings");
  await expect(status(page)).toHaveText(/your frame stopped \(.*boom/);
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
