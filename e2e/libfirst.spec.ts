// Opening Library the first time (T-476, Aaron 11-24): his path, on the real hub of e2e/hub.ts. A device signed in to
// the person's own Parachute with their key reads its vaults; a vault made there later (`library`, as Uni made his),
// with Library and Languages put in it as his apply.sh puts them (scripts/install-applets.ts), is offered at the end of
// the list: Open library. A tap, the hub's consent, Library's card, Allow, Add a book: the shell's own picker opens.
// On a phone (Chromium) and at a Mac's width in WebKit (the Mac app's engine). The phone itself: e2e/android/libfirst.ts.
// Set LIBFIRST_SHOTS=<dir> for a screenshot of every screen on the way.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { approveUntilBack, signInWithKey, ui, vaultRow } from "./helpers";
import { cli, hubState, mintToken, VAULT } from "./hub";

const SHOTS = process.env.LIBFIRST_SHOTS || "";
const LIB = "library";
/** A vault a device opened as someone else's before this build (Aaron's `library` on his phone). */
const ALREADY = "books";
let n = 0, where = "";
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(join(SHOTS, where), { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, where, `${String(++n).padStart(2, "0")}-${name}.png`) });
}
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");


/** Signed in with the key to the person's own Parachute (they run it); then `vault` made there, with Library and
 *  Languages put in as his apply.sh puts them; a minute on, the list offers it at its end: its Open line (`said`: what
 *  the line says after the vault's name). `admin`: what the key's own listing finds on the phone and the Mac, that the
 *  person is the hub's admin (vault/newVaults.ts `noteAdmin`; the web build has no key, so it is kept here as the app
 *  keeps it: e2e/android/libfirst.ts walks the key's own listing). */
async function offered(page: Page, vault: string, admin: boolean, said: string) {
  const h = hubState();
  await page.clock.install();
  await signInWithKey(page, h, VAULT, "Mine");
  if (admin) await page.evaluate((hub) => { const k = "parachute.newvaults.v1"; const v = JSON.parse(localStorage.getItem(k) ?? "{}"); localStorage.setItem(k, JSON.stringify({ ...v, admin: [...(v.admin ?? []), hub] })); }, h.origin);
  cli(h, ["vault", "create", vault, "--json", "--no-mirror"]);
  const dir = mkdtempSync(join(tmpdir(), "libfirst-"));
  try {
    writeFileSync(join(dir, "token"), mintToken(`vault:${vault}:write`), { mode: 0o600 });
    execFileSync("node", [join(import.meta.dirname, "..", "scripts", "install-applets.ts"), "--hub", h.origin, "--vault", vault, "--token-file", join(dir, "token"), "--applet", "library", "--applet", "languages", "--apply"], { stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  await page.clock.fastForward("01:05");
  await page.goto("/");
  const open = ui(page).getByRole("button", { name: `Open ${vault}${said}`, exact: true });
  await expect(open).toBeVisible({ timeout: 20_000 });
  return open;
}

/** Library on the list, and its card. */
async function libraryCard(page: Page) {
  const library = ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Library/ });
  await expect(library).toBeVisible({ timeout: 20_000 });
  await library.click();
  const card = page.getByRole("region", { name: /asking for access/ });
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}

/** Allow on the card, and the hub's pages after it (how many): back on the applet, which runs. */
async function allow(page: Page, app: string) {
  const h = hubState();
  const at = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Allow" }).click();
  const hub = await page.waitForURL((u) => u.origin === h.origin, { timeout: 5000 }).then(() => true, () => false);
  const asked = hub ? await approveUntilBack(page, h.origin, app, undefined, at) : 0;
  await expect(frame(page).getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });
  return asked;
}

test.afterAll(() => { for (const v of [LIB, ALREADY]) { try { cli(hubState(), ["vault", "remove", v, "--yes"]); } catch { /* gone already */ } } });

test("a vault made later, opened from the list: its applet asks on one card, and Add a book opens the picker", async ({ page }, info) => {
  test.setTimeout(240_000);
  const h = hubState();
  where = info.project.name;
  // the line says it opens as theirs
  const open = await offered(page, LIB, true, " · yours");
  await open.scrollIntoViewIfNeeded();
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
});

test("a vault this device already opened as someone else's: Mine in Settings, Library asks once more, and Add a book opens the picker", async ({ page }, info) => {
  test.setTimeout(240_000);
  const h = hubState();
  where = `${info.project.name}-already`;
  const open = await offered(page, ALREADY, true, " · yours");
  const app = new URL(page.url()).origin;
  // as a build before this one kept it: someone else's
  await page.evaluate(({ hub, vault }) => { const k = "parachute.whose.v1"; const v = JSON.parse(localStorage.getItem(k) ?? "{}"); localStorage.setItem(k, JSON.stringify({ whose: { ...(v.whose ?? {}), [`${hub} ${vault}`]: "theirs" }, ask: v.ask ?? [] })); }, { hub: h.origin, vault: ALREADY });
  await page.reload();
  // its line says so: it opens as someone else's
  const marked = ui(page).getByRole("button", { name: `Open ${ALREADY} · someone else's`, exact: true });
  await expect(marked).toBeVisible({ timeout: 20_000 });
  await expect(open).toHaveCount(0);
  await marked.click();
  await page.waitForURL((u) => u.origin === h.origin || u.pathname === "/oauth/callback");
  await approveUntilBack(page, h.origin, app);
  await expect(await libraryCard(page)).toContainText(/someone else's vault/);
  await allow(page, app);
  await frame(page).getByRole("button", { name: "Add a book" }).click();
  await expect(frame(page).getByText(/Could not open the picker: not_granted/)).toBeVisible();
  await shot(page, "before-not-granted");

  // what Aaron does once: Settings, the vault, Whose: Mine, and its card's own button
  await page.goto("/settings");
  const row = await vaultRow(page, ALREADY);
  await row.getByRole("combobox", { name: `Whose ${ALREADY} is` }).selectOption("mine");
  const sheet = page.getByRole("dialog", { name: `Is ${ALREADY} yours?` });
  await shot(page, "whose-mine");
  await sheet.getByRole("button", { name: `${ALREADY} is mine` }).click();
  await expect(sheet).toHaveCount(0);
  // Library asks once more (it now asks for the picker); the hub already lets Parachute change notes there
  await page.goto("/");
  const card = await libraryCard(page);
  await expect(card).toContainText(`From your vault ${ALREADY}`);
  await expect(card).toContainText(/files you pick/);
  await shot(page, "card-again");
  expect(await allow(page, app)).toBe(0);
  await frame(page).getByRole("button", { name: "Add a book" }).click();
  await expect(page.getByRole("dialog", { name: /Library asks for a file/ })).toBeVisible();
  await shot(page, "picker");
});
