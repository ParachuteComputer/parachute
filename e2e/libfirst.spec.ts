// Opening Library the first time (T-476, Aaron 11-24): his path, on the real hub of e2e/hub.ts. A device signed in to
// the person's own Parachute with their key reads its vaults; a vault made there later (`library`, as Uni made his),
// with Library and Languages put in it as his apply.sh puts them (scripts/install-applets.ts), is offered at the end of
// the list: Open library. A tap, the hub's consent, Library's card, Allow, Add a book: the shell's own picker opens.
// Set LIBFIRST_SHOTS=<dir> for a screenshot of every screen on the way.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { approveUntilBack, signInWithKey, ui } from "./helpers";
import { cli, hubState, mintToken, VAULT } from "./hub";

const SHOTS = process.env.LIBFIRST_SHOTS || "";
const LIB = "library";
let n = 0;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-${name}.png`) });
}
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

test.afterAll(() => { try { cli(hubState(), ["vault", "remove", LIB, "--yes"]); } catch { /* gone already */ } });

test("a vault made later, opened from the list: its applet asks on one card, and Add a book opens the picker", async ({ browser }) => {
  test.setTimeout(240_000);
  const h = hubState();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.clock.install();
  // signed in with the key, the Parachute his own: the vaults there now are his
  await signInWithKey(page, h, VAULT, "Mine");
  // later, on the hub: the library vault, and Library and Languages in it as his apply.sh puts them
  cli(h, ["vault", "create", LIB, "--json", "--no-mirror"]);
  const dir = mkdtempSync(join(tmpdir(), "libfirst-"));
  try {
    writeFileSync(join(dir, "token"), mintToken(`vault:${LIB}:write`), { mode: 0o600 });
    execFileSync("node", [join(import.meta.dirname, "..", "scripts", "install-applets.ts"), "--hub", h.origin, "--vault", LIB, "--token-file", join(dir, "token"), "--applet", "library", "--applet", "languages", "--apply"], { stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // a minute on, the list again: it asks the hub, and library is offered at its end
  await page.clock.fastForward("01:05");
  await page.goto("/");
  const open = ui(page).getByRole("button", { name: `Open ${LIB}`, exact: true });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await shot(page, "list-not-open-here");
  const app = new URL(page.url()).origin;
  await open.click();
  await page.waitForURL((u) => u.origin === h.origin || u.pathname === "/oauth/callback");
  // every screen until it is back: the hub's, and the app's
  const asked = await approveUntilBack(page, h.origin, app, async (p) => { await shot(p, "app-which-are-yours"); }, "/", async (p) => { await shot(p, "hub-consent"); });
  await shot(page, "back-on-the-list");
  const library = ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Library/ });
  await expect(library).toBeVisible({ timeout: 20_000 });
  await library.click();
  const card = page.getByRole("region", { name: /asking for access/ });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await shot(page, "library-card");
  // the person's own vault: no warning about strangers, and the picker it asks for is on the card
  await expect(card).toContainText(/From your vault library/);
  await expect(card).not.toContainText(/someone else's|Not made by you/);
  await expect(card).toContainText(/files you pick/);
  const at = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Allow" }).click();
  // the hub's consent to change notes there (core asks again for write: the app holds no more than what is allowed needs)
  await page.waitForURL((u) => u.origin === h.origin);
  const more = await approveUntilBack(page, h.origin, app, undefined, at, async (p) => { await shot(p, "hub-consent-write"); });
  await expect(frame(page).getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "library-open");
  await frame(page).getByRole("button", { name: "Add a book" }).click();
  // the picker, or the applet's toast that it couldn't open
  await expect.poll(async () => (await page.getByRole("dialog", { name: /Library asks for a file/ }).count()) + (await frame(page).getByText(/Could not open the picker/).count())).toBeGreaterThan(0);
  await shot(page, "add-a-book");
  await expect(page.getByRole("dialog", { name: /Library asks for a file/ })).toBeVisible();
  // a book, picked: it goes up onto a job in Jobs/Library/ (write, as the hub let it), waiting for an AI
  const books = mkdtempSync(join(tmpdir(), "libfirst-book-"));
  try {
    const epub = join(books, "A Small Garden.epub");
    execFileSync("python3", ["-I", join(import.meta.dirname, "..", "tools", "library-import", "make_test_epub.py"), epub]);
    await page.locator("input[data-shell-pick]").setInputFiles(epub);
    await expect(frame(page).getByRole("region", { name: "Being added" })).toContainText(/Waiting for an AI/, { timeout: 30_000 });
    await shot(page, "book-on-its-way");
  } finally { rmSync(books, { recursive: true, force: true }); }
  // on the way: the hub once to read the vault, Library's one card, the hub once to let it change notes; no card again
  expect(asked).toBe(1);
  expect(more).toBe(1);
  await expect(page.getByRole("region", { name: /asking for access/ })).toHaveCount(0);
  await ctx.close();
});
