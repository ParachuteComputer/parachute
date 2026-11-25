// Opening Library the first time, on the phone (T-476, Aaron 11-24): a person with their key signs in to their own
// Parachute; later a vault is made there (`library`, as Uni made his) with Library and Languages put in as his apply.sh
// puts them (scripts/install-applets.ts). The list offers it at its end; Open library, the hub's consent, Library's
// card, Allow, Add a book: the shell's sheet, then Android's own file picker, and the book is on its way. Every screen
// on the way is a screenshot; the walk fails where the person would be stopped.
//   scripts/android-drive.sh <debug.apk> libfirst <folder>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameLocator, Page } from "@playwright/test";
import { cli, hubState, mintToken } from "../hub";
import { phone, wait } from "./phone";

const LIB = "library";
const ph = await phone(process.argv[2]);
const { hub, nsec } = ph.world;
const fail = async (why: string): Promise<never> => { await ph.shot("stopped"); console.error(`FAILED: ${why}`); process.exit(1); };
const visible = (l: ReturnType<Page["locator"]>) => l.first().isVisible().catch(() => false);
/** Wait until `test` holds (a second at a time), else fail with `why`. */
async function until(why: string, test: () => Promise<boolean>, s = 60) {
  for (let i = 0; i < s; i++) { if (await test().catch(() => false)) return; await wait(1000); }
  await fail(why);
}
const p = () => ph.page();
const ui = (): FrameLocator => p().frameLocator("iframe.app-frame");
const applet = (): FrameLocator => p().frameLocator("iframe.applet-frame:visible");
const onHub = () => p().url().startsWith(hub);
let hubScreens = 0;
/** The hub's pages, as long as it asks: each Approve is a screenshot and counted. */
async function throughHub(label: string) {
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    if (onHub()) {
      const ok = p().getByRole("button", { name: "Approve" });
      if (await visible(ok)) { hubScreens++; await ph.shot(`${label}-hub-approve`); await ok.click(); continue; }
    } else if (!p().url().includes("/oauth/") && await visible(p().locator("nav[aria-label=Bar]"))) return;
  }
  await fail(`stuck on the way back from the hub at ${p().url()}`);
}

console.log("app at", p().url());
// nothing waits for ever: a step that can't happen fails the walk
for (const c of ph.browser.contexts()) { c.setDefaultTimeout(30_000); for (const pg of c.pages()) pg.setDefaultTimeout(30_000); }
setTimeout(() => { console.error("FAILED: the walk took over 15 minutes"); process.exit(1); }, 15 * 60_000).unref();
// a phone has a screen lock: the key signs behind it (keyring levels), and Android's own unlock asks for it
const PIN = "1357";
console.log(await ph.adb(`shell locksettings set-pin ${PIN}`));
// 1. the key, pasted
await until("the first screen didn't come", () => visible(p().getByRole("button", { name: "Make a new key" })), 180);
await ph.shot("first-screen");
await p().getByText("Advanced: paste a secret key").click();
await p().getByPlaceholder("nsec1…").fill(nsec);
await p().getByRole("button", { name: "Keep this key" }).click();
await until("the key wasn't kept", () => visible(p().getByRole("button", { name: "Sign in with your key" })), 60);

// 2. signed in to the person's own Parachute with it: its vaults are theirs
await p().getByLabel("Your Parachute's address").fill(hub);
await p().getByRole("radio", { name: "Mine" }).check();
await p().getByRole("button", { name: "Sign in with your key" }).click();
for (let i = 0; i < 90; i++) {
  await wait(1000);
  if (onHub()) { const ok = p().getByRole("button", { name: "Approve" }); if (await visible(ok)) await ok.click(); continue; }
  const cont = p().getByRole("button", { name: "Continue" });
  if (await visible(cont)) { await cont.click(); continue; }
  if (await visible(p().locator("nav[aria-label=Bar]")) && !p().url().includes("/oauth/")) break;
}
await until("not signed in", () => visible(p().locator("nav[aria-label=Bar]")), 60);
console.log("signed in; at", p().url());

// 3. later, on the hub: the library vault, with Library and Languages put in as his apply.sh puts them
const h = hubState();
cli(h, ["vault", "create", LIB, "--json", "--no-mirror"]);
const dir = mkdtempSync(join(tmpdir(), "libfirst-"));
try {
  writeFileSync(join(dir, "token"), mintToken(`vault:${LIB}:write`), { mode: 0o600 });
  execFileSync("node", [join(import.meta.dirname, "..", "..", "scripts", "install-applets.ts"), "--hub", h.origin, "--vault", LIB, "--token-file", join(dir, "token"), "--applet", "library", "--applet", "languages", "--apply"], { stdio: "pipe" });
} finally { rmSync(dir, { recursive: true, force: true }); }
// a book to add, in the phone's Downloads
execFileSync("python3", ["-I", join(import.meta.dirname, "..", "..", "tools", "library-import", "make_test_epub.py"), join(process.env.DRIVE_WORK!, "book.epub")]);
console.log(await ph.adb(`push /work/book.epub '/sdcard/Download/A Small Garden.epub' && $ADB shell content call --uri content://media --method scan_volume --arg external_primary`));

// 4. the list asks the hub again a minute on: library is offered at its end
const bar = () => p().getByRole("navigation", { name: "Bar" });
// the key's own listing found the person the hub's admin: the line says it opens as theirs
const open = ui().getByRole("button", { name: `Open ${LIB} · yours`, exact: true });
for (let i = 0; i < 3 && !(await visible(open as never)); i++) {
  await wait(62_000);
  await bar().getByRole("link", { name: /Settings/ }).click();
  await wait(2000);
  await bar().getByRole("link", { name: /Applets/ }).click();
  for (let j = 0; j < 15 && !(await visible(open as never)); j++) await wait(1000);
}
await until("library isn't offered on the list", () => visible(open as never), 5);
await open.scrollIntoViewIfNeeded();
await ph.shot("list-not-open-here");
await open.click();
await throughHub("open-library");

// 5. Library: its card, once
const lib = ui().getByRole("list", { name: "Applets" }).getByRole("link", { name: /Library/ });
await until("Library isn't on the list", () => visible(lib as never), 60);
await lib.scrollIntoViewIfNeeded();
await ph.shot("list-with-library");
await lib.click();
const card = p().getByRole("region", { name: /asking for access/ });
await until("Library's card didn't come", () => visible(card), 60);
await ph.shot("library-card");
const said = await card.innerText();
console.log("CARD:", said.replace(/\n+/g, " | ").slice(0, 1500));
await p().getByRole("button", { name: "Allow" }).click();
// the phone's own unlock, when the key signs the approval: its PIN, typed as a person types it
let unlocks = 0;
for (let i = 0; i < 8; i++) {
  await wait(1500);
  if (/BiometricPrompt|ConfirmDeviceCredential|com\.android\.systemui.*[Bb]iometric|AuthContainerView/.test(await ph.adb("shell dumpsys window | grep -E 'mCurrentFocus|mFocusedWindow'"))) {
    unlocks++; await ph.shot("system-unlock");
    await ph.adb(`shell input text ${PIN} && $ADB shell input keyevent 66`);
    break;
  }
}
console.log(`system unlocks: ${unlocks}`);
// whatever comes after Allow (the hub, the system's own unlock): each a screenshot
for (let i = 0; i < 60; i++) {
  await wait(1000);
  if (onHub()) { await throughHub("allow"); break; }
  if (await visible(applet().getByRole("heading", { name: "Library" }) as never)) break;
  if (i % 5 === 4) await ph.shot(`after-allow-${i}`);
}
await until("Library didn't open", () => visible(applet().getByRole("heading", { name: "Library" }) as never), 60);
await ph.shot("library-open");

// 6. Add a book: the shell's sheet, then Android's picker
await applet().getByRole("button", { name: "Add a book" }).click();
await wait(1500);
await ph.shot("add-a-book");
const sheet = p().getByRole("dialog", { name: /Library asks for a file/ });
if (!(await visible(sheet))) {
  const toast = await applet().locator("body").innerText().catch(() => "");
  await fail(`Add a book didn't open the picker${/Could not open the picker[^\n]*/.exec(toast)?.[0] ? `: "${/Could not open the picker[^\n]*/.exec(toast)![0]}"` : ""}`);
}
await sheet.getByRole("button", { name: /Choose a file/ }).click();
await wait(4000);
await ph.shot("android-picker");
// Android's own picker: the book, by its name on the screen, tapped as a finger (the screen is read again until it shows)
async function tapText(text: string): Promise<boolean> {
  const where = async () => {
    const xml = await ph.adb("shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml");
    const at = xml.indexOf(`text="${text}"`);
    return at < 0 ? null : /bounds="(\[\d+,\d+\]\[\d+,\d+\])"/.exec(xml.slice(at))?.[1] ?? null;
  };
  for (let i = 0; i < 10; i++) {
    // the picker settles its layout a moment after it shows (its chips come and go): tap only where it stays
    const first = await where();
    await wait(1500);
    const now = await where();
    if (first && now === first) {
      const [x1, y1, x2, y2] = (now.match(/\d+/g) ?? []).map(Number);
      await ph.adb(`shell input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
      await wait(2500);
      // gone: the picker answered the app
      if (!/documentsui/.test(await ph.adb("shell dumpsys window | grep -E 'mCurrentFocus'"))) return true;
    }
  }
  return false;
}
if (!(await tapText("A Small Garden.epub"))) {
  await ph.adb("shell input keyevent KEYCODE_BACK");
  await fail("the book isn't in Android's picker");
}
console.log("picked in Android's picker");
await until("the book isn't on its way", async () => /Waiting for an AI/.test(await applet().getByRole("region", { name: "Being added" }).innerText()), 60);
await ph.shot("book-on-its-way");
console.log(`hub screens: ${hubScreens}, system unlocks: ${unlocks}`);
console.log("PASSED: Library opened the first time, and a book picked in Android's picker is on its way");
process.exit(0);
